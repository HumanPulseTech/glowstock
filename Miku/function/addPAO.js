const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const serverLogger = require('../serverLogger.js');

function addMonths(date, months) {
    const [year, month, day] = date.split('-').map(Number);
    const targetMonth = month - 1 + months;
    const targetYear = year + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

module.exports = async function addPAO(input, socket, done = () => {}) {
    let connexion;
    const operationId = `${socket.id}:${Date.now()}`;
    try {
        const userId = socket.request.session?.userId;
        const produitId = Number(input?.produitId);
        const ref = typeof input?.ref === 'string' ? input.ref.trim().slice(0, 100) : '';
        const dateStart = typeof input?.dateStart === 'string' ? input.dateStart : '';
        const durationMonths = Number(input?.durationMonths);
        void serverLogger.info('pao.add.start', 'Demande d’ajout de PAO reçue.', { operationId, produitId, dateStart, durationMonths }, { userId, socketId: socket.id });
        if (!userId) { socket.emit('auth error', 'Session expirée.'); return done({ ok: false }); }
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) { socket.emit('subscription blocked', subscription.level); return done({ ok: false }); }
        if (!(await hasPermission(userId, 'manage_pao'))) { socket.emit('pao error', 'Ce rôle ne peut pas ajouter de PAO.'); return done({ ok: false }); }
        if (!Number.isInteger(produitId) || !ref || !/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || ![6, 12, 24].includes(durationMonths)) {
            socket.emit('pao error', 'Informations de PAO invalides.');
            require('./logError.js')(userId, 'ajout_pao_validation', 'Informations de PAO invalides.', { produitId, dateStart, durationMonths });
            return done({ ok: false });
        }
        connexion = await (await getPool()).getConnection();
        const produits = await connexion.query('SELECT id FROM produits WHERE id = ? AND id_user = ?', [produitId, userId]);
        if (!produits.length) { socket.emit('pao error', 'Produit introuvable.'); require('./logError.js')(userId, 'ajout_pao_validation', 'Produit introuvable.', { produitId }); return done({ ok: false }); }
        const dateFin = addMonths(dateStart, durationMonths);
        await connexion.query('INSERT INTO PAO (id_produit, dStart, dFin, ref, active) VALUES (?, ?, ?, ?, 1)', [produitId, dateStart, dateFin, ref]);
        void serverLogger.info('pao.add.success', 'PAO enregistrée.', { operationId, produitId, dateStart, dateFin }, { userId, socketId: socket.id });
        socket.emit('pao ajoute');
        done({ ok: true });
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') socket.emit('pao error', 'Cette référence de PAO existe déjà pour ce produit.');
        else { console.error('Erreur ajout PAO', error); socket.emit('pao error', 'Impossible d’enregistrer cette PAO.'); }
        require('./logError.js')(socket.request.session?.userId || null, 'ajout_pao', error.message, { code: error.code, operationId });
        done({ ok: false });
    } finally {
        if (connexion) connexion.release();
    }
};
