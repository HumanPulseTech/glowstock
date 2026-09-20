const { getPool } = require('./db.js');
const { FEATURE_DEFINITIONS } = require('./featureFlags.js');

let schemaPromise = null;
const OFFER_ACCESS_FEATURES = FEATURE_DEFINITIONS.filter((feature) => !['login', 'signup'].includes(feature.key));
const ACCESS_KEYS = new Set(OFFER_ACCESS_FEATURES.map((feature) => feature.key));

const DEFAULT_OFFER = Object.freeze({
    name: 'Plan Solo',
    description: 'Sans engagement. Annulable à tout moment.',
    price: 39.90,
    originalPrice: 79.90,
    discountLabel: 'Offre de lancement',
    billingPeriod: '/ mois',
    features: [
        'Produits en stock illimités',
        'Alertes seuil & péremptions (PAO)',
        'Recherche par référence fournisseur'
    ],
    includedAccess: OFFER_ACCESS_FEATURES.map((feature) => feature.key),
    stripePriceId: '',
    ctaLabel: 'Commencer l’essai de 14 jours'
});

const cleanText = (value, maxLength) => typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength)
    : '';

const validAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 && amount <= 100000 ? Math.round(amount * 100) / 100 : null;
};

const parseFeatures = (value) => {
    const source = Array.isArray(value) ? value : [];
    return source.map((line) => cleanText(String(line), 200)).filter(Boolean).slice(0, 20);
};

const decodeFeatures = (value) => {
    try { return parseFeatures(JSON.parse(value || '[]')); }
    catch (_) { return []; }
};

const parseIncludedAccess = (value) => {
    const source = Array.isArray(value) ? value : [];
    return [...new Set(source.map((key) => String(key)).filter((key) => ACCESS_KEYS.has(key)))];
};

const decodeIncludedAccess = (value) => {
    try { return parseIncludedAccess(JSON.parse(value || '[]')); }
    catch (_) { return []; }
};

const normalizeOffer = (offer) => ({
    id: String(offer.id),
    name: offer.name,
    description: offer.description || '',
    price: Number(offer.price),
    originalPrice: offer.original_price === null || offer.original_price === undefined ? null : Number(offer.original_price),
    discountLabel: offer.discount_label || '',
    billingPeriod: offer.billing_period || '/ mois',
    features: decodeFeatures(offer.features),
    includedAccess: decodeIncludedAccess(offer.included_access),
    stripePriceId: offer.stripe_price_id || '',
    ctaLabel: offer.cta_label || 'Commencer l’essai',
    active: Boolean(Number(offer.active)),
    sortOrder: Number(offer.sort_order) || 0
});

async function ensureSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
        let connexion;
        try {
            connexion = await (await getPool()).getConnection();
            await connexion.query(`
                CREATE TABLE IF NOT EXISTS marketing_offers (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    name VARCHAR(160) NOT NULL,
                    description VARCHAR(1000) NULL,
                    price DECIMAL(10,2) NOT NULL,
                    original_price DECIMAL(10,2) NULL,
                    discount_label VARCHAR(100) NULL,
                    billing_period VARCHAR(50) NOT NULL DEFAULT '/ mois',
                    features TEXT NOT NULL,
                    included_access TEXT NULL,
                    stripe_price_id VARCHAR(255) NULL,
                    cta_label VARCHAR(100) NOT NULL DEFAULT 'Commencer l’essai de 14 jours',
                    active TINYINT(1) NOT NULL DEFAULT 1,
                    sort_order INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY idx_marketing_offers_active_order (active, sort_order, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
            `);
            await connexion.query('ALTER TABLE marketing_offers ADD COLUMN IF NOT EXISTS included_access TEXT NULL AFTER features');
            await connexion.query('ALTER TABLE marketing_offers ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255) NULL AFTER included_access');
            const count = await connexion.query('SELECT COUNT(*) AS total FROM marketing_offers');
            if (!Number(count[0]?.total)) {
                await connexion.query(
                    `INSERT INTO marketing_offers (name, description, price, original_price, discount_label, billing_period, features, included_access, stripe_price_id, cta_label, active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                    [DEFAULT_OFFER.name, DEFAULT_OFFER.description, DEFAULT_OFFER.price, DEFAULT_OFFER.originalPrice, DEFAULT_OFFER.discountLabel, DEFAULT_OFFER.billingPeriod, JSON.stringify(DEFAULT_OFFER.features), JSON.stringify(DEFAULT_OFFER.includedAccess), DEFAULT_OFFER.stripePriceId || null, DEFAULT_OFFER.ctaLabel]
                );
            }
        } catch (error) {
            schemaPromise = null;
            throw error;
        } finally {
            if (connexion) connexion.release();
        }
    })();
    return schemaPromise;
}

async function listOffers(activeOnly = false) {
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        const condition = activeOnly ? 'WHERE active = 1' : '';
        const offers = await connexion.query(`SELECT id, name, description, price, original_price, discount_label, billing_period, features, included_access, stripe_price_id, cta_label, active, sort_order FROM marketing_offers ${condition} ORDER BY sort_order ASC, id ASC`);
        return offers.map(normalizeOffer);
    } finally {
        if (connexion) connexion.release();
    }
}

function validateOffer(input) {
    const name = cleanText(input?.name, 160);
    const description = cleanText(input?.description, 1000);
    const price = validAmount(input?.price);
    const hasOriginalPrice = !(input?.originalPrice === '' || input?.originalPrice === null || input?.originalPrice === undefined);
    const originalPriceInput = hasOriginalPrice ? validAmount(input.originalPrice) : null;
    const discountLabel = cleanText(input?.discountLabel, 100);
    const billingPeriod = cleanText(input?.billingPeriod, 50) || '/ mois';
    const features = parseFeatures(input?.features);
    const includedAccess = parseIncludedAccess(input?.includedAccess);
    const stripePriceId = cleanText(input?.stripePriceId, 255);
    const ctaLabel = cleanText(input?.ctaLabel, 100) || 'Commencer l’essai de 14 jours';
    const sortOrder = Number.isInteger(Number(input?.sortOrder)) ? Math.max(0, Math.min(100000, Number(input.sortOrder))) : 0;
    if (!name || price === null) throw new Error('Le nom et le prix de l’offre sont obligatoires.');
    if (hasOriginalPrice && (originalPriceInput === null || originalPriceInput <= price)) throw new Error('Le prix avant réduction doit être supérieur au prix actuel.');
    if (!features.length && !includedAccess.length) throw new Error('Ajoute au moins un avantage ou sélectionne un accès inclus.');
    if (stripePriceId && !/^price_[A-Za-z0-9]+$/.test(stripePriceId)) throw new Error('L’identifiant du prix Stripe doit commencer par « price_ ».');
    return { name, description, price, originalPrice: originalPriceInput, discountLabel, billingPeriod, features, includedAccess, stripePriceId, ctaLabel, sortOrder, active: input?.active === true };
}

async function saveOffer(input) {
    const offer = validateOffer(input);
    const id = input?.id === '' || input?.id === null || input?.id === undefined ? null : Number(input.id);
    if (id !== null && (!Number.isInteger(id) || id <= 0)) throw new Error('Offre invalide.');
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        if (id) {
            const existing = await connexion.query('SELECT id FROM marketing_offers WHERE id = ?', [id]);
            if (!existing.length) throw new Error('Offre introuvable.');
            await connexion.query(
                `UPDATE marketing_offers
                 SET name = ?, description = ?, price = ?, original_price = ?, discount_label = ?, billing_period = ?, features = ?, included_access = ?, stripe_price_id = ?, cta_label = ?, active = ?, sort_order = ?
                 WHERE id = ?`,
                [offer.name, offer.description || null, offer.price, offer.originalPrice, offer.discountLabel || null, offer.billingPeriod, JSON.stringify(offer.features), JSON.stringify(offer.includedAccess), offer.stripePriceId || null, offer.ctaLabel, offer.active ? 1 : 0, offer.sortOrder, id]
            );
            return String(id);
        }
        const result = await connexion.query(
            `INSERT INTO marketing_offers (name, description, price, original_price, discount_label, billing_period, features, included_access, stripe_price_id, cta_label, active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [offer.name, offer.description || null, offer.price, offer.originalPrice, offer.discountLabel || null, offer.billingPeriod, JSON.stringify(offer.features), JSON.stringify(offer.includedAccess), offer.stripePriceId || null, offer.ctaLabel, offer.active ? 1 : 0, offer.sortOrder]
        );
        return String(result.insertId);
    } finally {
        if (connexion) connexion.release();
    }
}

async function deleteOffer(id) {
    const offerId = Number(id);
    if (!Number.isInteger(offerId) || offerId <= 0) throw new Error('Offre invalide.');
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        const result = await connexion.query('DELETE FROM marketing_offers WHERE id = ?', [offerId]);
        if (!result.affectedRows) throw new Error('Offre introuvable.');
    } finally {
        if (connexion) connexion.release();
    }
}

module.exports = { ensureSchema, listOffers, saveOffer, deleteOffer };
