const { getPool } = require('./db.js');

const FEATURE_DEFINITIONS = [
    { key: 'login', label: 'Connexion', description: 'Accès à la page et au formulaire de connexion.' },
    { key: 'signup', label: 'Inscription', description: 'Accès à la création de nouveaux comptes.' },
    { key: 'dashboard', label: 'Tableau de bord', description: 'Accès à la page d’accueil et aux indicateurs.' },
    { key: 'inventory', label: 'Inventaire', description: 'Consultation du catalogue et des niveaux de stock.' },
    { key: 'products', label: 'Produits', description: 'Création de nouvelles fiches produit.' },
    { key: 'scanner', label: 'Scanner', description: 'Lecture des codes-barres avec la caméra.' },
    { key: 'pao', label: 'PAO', description: 'Suivi et ajout des périodes après ouverture.' },
    { key: 'planning', label: 'Planning', description: 'Organisation des rendez-vous et des horaires d’ouverture.' },
    { key: 'tickets', label: 'Tickets', description: 'Signalement et suivi des incidents.' },
    { key: 'notifications', label: 'Notifications', description: 'Cloche, alertes automatiques et annonces administratives.' }
];

const knownKeys = new Set(FEATURE_DEFINITIONS.map((feature) => feature.key));
let schemaPromise = null;
let cachedFlags = null;
let cacheExpiresAt = 0;

async function ensureSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        let connexion;
        try {
            connexion = await (await getPool()).getConnection();
            await connexion.query(`
                CREATE TABLE IF NOT EXISTS feature_flags (
                    feature_key VARCHAR(50) NOT NULL,
                    enabled TINYINT(1) NOT NULL DEFAULT 1,
                    updated_by_user_id INT(11) NULL,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (feature_key),
                    KEY idx_feature_flags_updated_by (updated_by_user_id),
                    CONSTRAINT fk_feature_flags_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
            `);
            for (const feature of FEATURE_DEFINITIONS) {
                await connexion.query('INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES (?, 1)', [feature.key]);
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

async function getFeatureFlags(forceRefresh = false) {
    await ensureSchema();
    if (!forceRefresh && cachedFlags && Date.now() < cacheExpiresAt) return { ...cachedFlags };

    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        const rows = await connexion.query('SELECT feature_key, enabled FROM feature_flags');
        const flags = Object.fromEntries(FEATURE_DEFINITIONS.map((feature) => [feature.key, true]));
        rows.forEach((row) => {
            if (knownKeys.has(row.feature_key)) flags[row.feature_key] = Boolean(Number(row.enabled));
        });
        cachedFlags = flags;
        cacheExpiresAt = Date.now() + 5000;
        return { ...flags };
    } finally {
        if (connexion) connexion.release();
    }
}

async function isFeatureEnabled(featureKey) {
    if (!knownKeys.has(featureKey)) return false;
    const flags = await getFeatureFlags();
    return flags[featureKey] === true;
}

async function updateFeatureFlag(featureKey, enabled, userId) {
    if (!knownKeys.has(featureKey)) throw new Error('Fonctionnalité inconnue.');
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        await connexion.query(
            `INSERT INTO feature_flags (feature_key, enabled, updated_by_user_id)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by_user_id = VALUES(updated_by_user_id)`,
            [featureKey, enabled ? 1 : 0, userId]
        );
        cachedFlags = null;
        cacheExpiresAt = 0;
        return getFeatureFlags(true);
    } finally {
        if (connexion) connexion.release();
    }
}

module.exports = { FEATURE_DEFINITIONS, getFeatureFlags, isFeatureEnabled, updateFeatureFlag };
