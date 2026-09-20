const https = require('https');

const REGISTRY_HOST = 'recherche-entreprises.api.gouv.fr';
const CACHE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
const inFlight = new Map();
let schemaPromise = null;

class CompanyLookupError extends Error {
    constructor(message, code = 'COMPANY_LOOKUP_FAILED') {
        super(message);
        this.name = 'CompanyLookupError';
        this.code = code;
    }
}

function normaliseSiret(value) {
    return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function isValidSiret(value) {
    const siret = normaliseSiret(value);
    if (!/^\d{14}$/.test(siret) || /^0{14}$/.test(siret)) return false;

    let sum = 0;
    for (let index = 0; index < siret.length; index += 1) {
        let digit = Number(siret[siret.length - 1 - index]);
        if (index % 2 === 1) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
    }
    return sum % 10 === 0;
}

function firstText(...values) {
    return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function formatAddress(establishment) {
    return firstText(
        establishment?.adresse,
        [
            establishment?.numero_voie,
            establishment?.type_voie,
            establishment?.libelle_voie,
            establishment?.code_postal,
            establishment?.libelle_commune || establishment?.commune
        ].filter(Boolean).join(' ')
    );
}

function companyFromResponse(siret, body) {
    const result = Array.isArray(body?.results) ? body.results[0] : null;
    if (!result) return null;

    const establishments = [
        ...(Array.isArray(result.matching_etablissements) ? result.matching_etablissements : []),
        result.siege
    ].filter(Boolean);
    const establishment = establishments.find((item) => normaliseSiret(item.siret) === siret) || establishments[0] || null;
    const name = firstText(
        establishment?.nom_commercial,
        establishment?.enseigne,
        result.nom_complet,
        result.nom_raison_sociale,
        result.denomination
    );

    if (!name) return null;
    return {
        siret,
        name: name.slice(0, 255),
        address: formatAddress(establishment).slice(0, 500),
        active: establishment?.etat_administratif !== 'C'
    };
}

function requestRegistry(siret) {
    return new Promise((resolve, reject) => {
        const request = https.request({
            hostname: REGISTRY_HOST,
            path: `/search?q=${encodeURIComponent(siret)}&per_page=1`,
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'User-Agent': 'GlowStock/1.0 (company lookup)'
            }
        }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
                if (body.length > 1024 * 1024) {
                    request.destroy(new CompanyLookupError('La réponse de l’annuaire est trop volumineuse.'));
                }
            });
            response.on('end', () => {
                if (response.statusCode === 404) return resolve(null);
                if (response.statusCode === 429) return reject(new CompanyLookupError('Le service des entreprises est temporairement sollicité. Réessaie dans un instant.', 'COMPANY_LOOKUP_RATE_LIMITED'));
                if (response.statusCode < 200 || response.statusCode >= 300) return reject(new CompanyLookupError('Le service des entreprises est temporairement indisponible.'));
                try {
                    resolve(companyFromResponse(siret, JSON.parse(body)));
                } catch (_) {
                    reject(new CompanyLookupError('La réponse du service des entreprises est invalide.'));
                }
            });
        });

        request.setTimeout(5000, () => request.destroy(new CompanyLookupError('La recherche de l’entreprise a expiré.')));
        request.on('error', (error) => {
            reject(error instanceof CompanyLookupError
                ? error
                : new CompanyLookupError('Le service des entreprises est temporairement indisponible.'));
        });
        request.end();
    });
}

async function lookupCompanyBySiret(value) {
    const siret = normaliseSiret(value);
    if (!isValidSiret(siret)) throw new CompanyLookupError('Le SIRET doit contenir 14 chiffres valides.', 'INVALID_SIRET');

    const cached = cache.get(siret);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (inFlight.has(siret)) return inFlight.get(siret);

    const lookup = requestRegistry(siret)
        .then((company) => {
            cache.set(siret, {
                value: company,
                expiresAt: Date.now() + (company ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS)
            });
            return company;
        })
        .finally(() => inFlight.delete(siret));
    inFlight.set(siret, lookup);
    return lookup;
}

async function ensureSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        const { getPool } = require('./db.js');
        let connexion;
        try {
            connexion = await (await getPool()).getConnection();
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS siret VARCHAR(14) NULL AFTER nom');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(255) NULL AFTER siret');
            await connexion.query('CREATE INDEX IF NOT EXISTS idx_users_siret ON users (siret)');
        } catch (error) {
            schemaPromise = null;
            throw error;
        } finally {
            if (connexion) connexion.release();
        }
    })();
    return schemaPromise;
}

module.exports = {
    CompanyLookupError,
    ensureSchema,
    isValidSiret,
    lookupCompanyBySiret,
    normaliseSiret
};
