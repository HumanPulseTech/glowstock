const { getPool } = require('../db.js');
const { getStatus } = require('../subscription.js');
const { getPermissions, hasPermission } = require('../permissions.js');
const { FEATURE_DEFINITIONS, getFeatureFlags } = require('../featureFlags.js');
const { listOffers } = require('../marketingOffers.js');
const { ensureSchema: ensureNotificationSchema } = require('../notificationCenter.js');
const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');

const missingColumn = (error, column) => error?.code === 'ER_BAD_FIELD_ERROR' && new RegExp(`\\b${column}\\b`, 'i').test(error?.message || '');
const socketSafe = (value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(socketSafe);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, socketSafe(child)]));
    return value;
};
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;

module.exports = async function adminData(socket, filters = {}) {
    let connexion;
    try {
        const userId = socket.request.session?.userId;
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        connexion = await (await getPool()).getConnection();
        const current = await connexion.query('SELECT id, role FROM users WHERE id = ?', [userId]);
        if (!(await hasPermission(userId, 'access_admin'))) return socket.emit('admin error', 'Accès administrateur requis.');

        await ensureNotificationSchema();
        let articles;
        try {
            articles = await connexion.query(
                'SELECT p.nom, p.ref_fournisseur, p.code_barres, p.marque, p.quantite, p.seuil_alerte, u.email AS compte FROM produits p INNER JOIN users u ON u.id = p.id_user ORDER BY p.updated_at DESC'
            );
        } catch (articleError) {
            // Permet à l’administration de rester consultable avant l’exécution
            // de la migration code-barres en production.
            if (!missingColumn(articleError, 'code_barres')) throw articleError;
            void serverLogger.warn('admin.barcode_migration_missing', 'Colonne code-barres absente pendant le chargement de l’administration.', null, { userId, socketId: socket.id });
            articles = await connexion.query(
                'SELECT p.nom, p.ref_fournisseur, NULL AS code_barres, p.marque, p.quantite, p.seuil_alerte, u.email AS compte FROM produits p INNER JOIN users u ON u.id = p.id_user ORDER BY p.updated_at DESC'
            );
        }
        let comptes;
        try {
            comptes = await connexion.query(
                'SELECT id, nom, email, role, ticket_team, email_verified, abo, date_abo, subscription_amount, subscription_credit, created_at FROM users ORDER BY created_at DESC'
            );
        } catch (accountError) {
            if (!missingColumn(accountError, 'ticket_team')) throw accountError;
            void serverLogger.warn('admin.ticket_team_migration_missing', 'Colonne équipe tickets absente pendant le chargement des comptes.', null, { userId, socketId: socket.id });
            comptes = await connexion.query(
                'SELECT id, nom, email, role, NULL AS ticket_team, email_verified, abo, date_abo, subscription_amount, subscription_credit, created_at FROM users ORDER BY created_at DESC'
            );
        }
        let logs = [];
        try {
            logs = await connexion.query(
                'SELECT l.id, l.type, l.message, l.context, l.created_at, u.email AS compte FROM error_logs l LEFT JOIN users u ON u.id = l.id_user ORDER BY l.created_at DESC LIMIT 200'
            );
        } catch (logQueryError) {
            void serverLogger.warn('admin.error_logs_unavailable', 'Journal des incidents indisponible.', { code: logQueryError?.code || null }, { userId, socketId: socket.id });
        }
        let serverLogs = [];
        try {
            const rawFrom = validDate(filters?.from);
            const rawTo = validDate(filters?.to);
            const from = rawFrom && rawTo && rawFrom > rawTo ? rawTo : rawFrom;
            const to = rawFrom && rawTo && rawFrom > rawTo ? rawFrom : rawTo;
            const conditions = [];
            const params = [];
            if (from) { conditions.push('l.created_at >= ?'); params.push(`${from} 00:00:00`); }
            if (to) { conditions.push('l.created_at <= ?'); params.push(`${to} 23:59:59`); }
            const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
            serverLogs = await connexion.query(
                `SELECT l.id, l.level, l.event, l.message, l.context, l.request_id, l.socket_id, l.created_at, u.email AS compte FROM server_logs l LEFT JOIN users u ON u.id = l.id_user${where} ORDER BY l.created_at DESC LIMIT 300`,
                params
            );
        } catch (serverLogError) {
            void serverLogger.warn('admin.server_logs_unavailable', 'Journal serveur indisponible.', { code: serverLogError?.code || null }, { userId, socketId: socket.id });
        }
        const roles = await connexion.query('SELECT slug, nom, permissions FROM roles ORDER BY nom ASC');
        const featureFlags = await getFeatureFlags();
        const offers = await listOffers();
        let ticketTeams = [];
        try {
            ticketTeams = await connexion.query('SELECT slug, nom FROM ticket_teams ORDER BY id ASC');
        } catch (ticketTeamError) {
            void serverLogger.warn('admin.ticket_teams_unavailable', 'Équipes tickets indisponibles.', { code: ticketTeamError?.code || null }, { userId, socketId: socket.id });
        }
        const abonnements = await Promise.all(comptes.map(async (compte) => ({ ...compte, subscription: getStatus({ ...compte, permissions: await getPermissions(compte.role) }) })));
        const referenceCount = new Set(articles.map((article) => String(article.ref_fournisseur || '').trim()).filter(Boolean)).size;
        socket.emit('admin data response', socketSafe({
            articles,
            comptes,
            logs,
            serverLogs,
            abonnements,
            roles,
            featureFlags,
            featureDefinitions: FEATURE_DEFINITIONS,
            offers,
            summary: { referenceCount },
            ticketTeams,
            currentUserId: current[0].id,
            serverLogFilter: { from: validDate(filters?.from), to: validDate(filters?.to) }
        }));
    } catch (error) {
        const context = { code: error?.code || null, message: error?.message || null };
        const diagnostic = error?.code ? ` (${String(error.code).slice(0, 80)})` : '';
        void serverLogger.error('admin.data_failed', `Erreur lors du chargement des données administrateur.${diagnostic}`, context, { userId: socket.request.session?.userId, socketId: socket.id });
        void logError(socket.request.session?.userId || null, 'administration_chargement', 'Impossible de charger les données administrateur.', context);
        socket.emit('admin error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Une table de configuration manque en base. Vérifie les migrations administrateur.' : 'Impossible de charger les données administrateur.');
    } finally {
        if (connexion) connexion.release();
    }
};
