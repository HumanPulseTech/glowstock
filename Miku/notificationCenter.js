const { getPool } = require('./db.js');
const data = require('./array.js');

const PAO_ALERT_DAYS = 30;
let schemaPromise = null;

function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

async function ensureSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        let connexion;
        try {
            connexion = await (await getPool()).getConnection();
            await connexion.query(`
                CREATE TABLE IF NOT EXISTS notifications (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    user_id INT(11) NOT NULL,
                    created_by_user_id INT(11) NULL,
                    type VARCHAR(32) NOT NULL,
                    title VARCHAR(160) NOT NULL,
                    message TEXT NOT NULL,
                    link VARCHAR(255) NULL,
                    dedupe_key VARCHAR(191) NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    dismissed_at DATETIME NULL,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_notifications_user_dedupe (user_id, dedupe_key),
                    KEY idx_notifications_user_active (user_id, dismissed_at, created_at),
                    KEY idx_notifications_author (created_by_user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
            `);
            await connexion.query(
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_amount DECIMAL(10,2) NULL AFTER date_abo'
            );
            await connexion.query(
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_credit DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subscription_amount'
            );
            await connexion.query(
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255) NULL AFTER subscription_credit'
            );
        } catch (error) {
            schemaPromise = null;
            throw error;
        } finally {
            if (connexion) connexion.release();
        }
    })();

    return schemaPromise;
}

async function replaceAutomaticNotifications(connexion, userId, type, entries) {
    const keys = entries.map((entry) => entry.dedupeKey);
    if (keys.length) {
        const placeholders = keys.map(() => '?').join(', ');
        await connexion.query(
            `DELETE FROM notifications
             WHERE user_id = ? AND type = ? AND dedupe_key IS NOT NULL AND dedupe_key NOT IN (${placeholders})`,
            [userId, type, ...keys]
        );
    } else {
        await connexion.query('DELETE FROM notifications WHERE user_id = ? AND type = ? AND dedupe_key IS NOT NULL', [userId, type]);
    }

    for (const entry of entries) {
        await connexion.query(
            `INSERT INTO notifications (user_id, type, title, message, link, dedupe_key)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), message = VALUES(message), link = VALUES(link)`,
            [userId, type, entry.title, entry.message, entry.link, entry.dedupeKey]
        );
    }
}

const formatAmount = (amount) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(amount) || 0);
const formatDate = (value) => {
    const [year, month, day] = String(value).split('-');
    return year && month && day ? `${day}/${month}/${year}` : String(value);
};
const addMonths = (dateValue, months) => {
    const [year, month, day] = String(dateValue).split('-').map(Number);
    const target = new Date(Date.UTC(year, month - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
};

async function applyDueSubscriptionCreditsWithConnection(connexion, userId = null) {
    const conditions = [
        'abo = 1',
        'abo_cancel_requested_at IS NULL',
        'date_abo IS NOT NULL',
        'date_abo <= CURDATE()',
        'subscription_amount IS NOT NULL',
        'subscription_amount > 0',
        'subscription_credit >= subscription_amount',
        "COALESCE(stripe_subscription_id, '') = ''"
    ];
    const params = [];
    if (userId !== null) {
        conditions.push('id = ?');
        params.push(userId);
    }
    const subscriptions = await connexion.query(
        `SELECT id, DATE_FORMAT(date_abo, '%Y-%m-%d') AS due_date, subscription_amount, subscription_credit
         FROM users WHERE ${conditions.join(' AND ')}`,
        params
    );

    let applied = 0;
    for (const subscription of subscriptions) {
        const amountCents = Math.round(Number(subscription.subscription_amount) * 100);
        const creditCents = Math.round(Number(subscription.subscription_credit) * 100);
        if (amountCents <= 0 || creditCents < amountCents || !subscription.due_date) continue;
        const coveredPeriods = Math.floor(creditCents / amountCents);
        const remainingCredit = (creditCents - (coveredPeriods * amountCents)) / 100;
        const nextDueDate = addMonths(subscription.due_date, coveredPeriods);
        const update = await connexion.query(
            `UPDATE users SET date_abo = ?, subscription_credit = ?
             WHERE id = ? AND date_abo = ? AND subscription_credit = ?`,
            [nextDueDate, remainingCredit, subscription.id, subscription.due_date, subscription.subscription_credit]
        );
        if (!update.affectedRows) continue;
        const coveredAmount = (coveredPeriods * amountCents) / 100;
        const periodLabel = coveredPeriods > 1 ? `${coveredPeriods} mensualités` : 'une mensualité';
        await connexion.query(
            `INSERT INTO notifications (user_id, type, title, message, link, dedupe_key)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), message = VALUES(message), link = VALUES(link)`,
            [
                subscription.id,
                'subscription_credit',
                'Avoir appliqué',
                `Votre avoir de ${formatAmount(coveredAmount)} a couvert ${periodLabel}. Votre prochaine échéance est le ${formatDate(nextDueDate)}.`,
                '/parametres/',
                `subscription-credit:${subscription.due_date}:${coveredPeriods}`
            ]
        );
        applied += 1;
    }
    return applied;
}

async function applyDueSubscriptionCredits(userId = null) {
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        return await applyDueSubscriptionCreditsWithConnection(connexion, userId);
    } finally {
        if (connexion) connexion.release();
    }
}

async function analyseDueSubscriptionRenewals() {
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        const creditRenewals = await applyDueSubscriptionCreditsWithConnection(connexion);
        const stripeRenewals = await connexion.query(
            `SELECT id, DATE_FORMAT(date_abo, '%Y-%m-%d') AS due_date,
                    subscription_amount, subscription_credit
             FROM users
             WHERE abo = 1
               AND abo_cancel_requested_at IS NULL
               AND date_abo IS NOT NULL
               AND date_abo <= CURDATE()
               AND subscription_amount IS NOT NULL
               AND subscription_amount > 0
               AND COALESCE(stripe_subscription_id, '') <> ''`
        );
        const manualRenewals = await connexion.query(
            `SELECT id, DATE_FORMAT(date_abo, '%Y-%m-%d') AS due_date,
                    subscription_amount, subscription_credit
             FROM users
             WHERE abo = 1
               AND abo_cancel_requested_at IS NULL
               AND date_abo IS NOT NULL
               AND date_abo <= CURDATE()
               AND subscription_amount IS NOT NULL
               AND subscription_amount > 0
               AND COALESCE(subscription_credit, 0) < subscription_amount
               AND COALESCE(stripe_subscription_id, '') = ''`
        );
        return {
            creditRenewals,
            stripeRenewals: stripeRenewals.map((subscription) => ({
                userId: Number(subscription.id),
                dueDate: subscription.due_date,
                amount: Number(subscription.subscription_amount),
                credit: Number(subscription.subscription_credit) || 0
            })),
            manualRenewals: manualRenewals.map((subscription) => ({
                userId: Number(subscription.id),
                dueDate: subscription.due_date,
                amount: Number(subscription.subscription_amount),
                credit: Number(subscription.subscription_credit) || 0
            }))
        };
    } finally {
        if (connexion) connexion.release();
    }
}

async function syncAutomaticNotifications(connexion, userId) {
    const lowStockProducts = await connexion.query(
        `SELECT id, nom, quantite, seuil_alerte
         FROM produits
         WHERE id_user = ? AND suive_alertes = 1 AND quantite <= seuil_alerte`,
        [userId]
    );
    const stockEntries = lowStockProducts.map((product) => ({
        dedupeKey: `stock-low:${product.id}`,
        title: product.quantite === 0 ? 'Produit en rupture' : 'Stock faible',
        message: product.quantite === 0
            ? `« ${product.nom} » est en rupture de stock.`
            : `« ${product.nom} » : ${product.quantite} restant(s), seuil défini à ${product.seuil_alerte}.`,
        link: '/dashboard/inv/'
    }));
    await replaceAutomaticNotifications(connexion, userId, 'stock_low', stockEntries);

    const paos = await connexion.query(
        `SELECT p.id AS product_id, pao.ref, pao.dFin, DATE_FORMAT(pao.dFin, '%d/%m/%Y') AS end_date_label, p.nom,
                CASE WHEN pao.dFin < CURDATE() THEN 'expired' ELSE 'expiring' END AS alert_state
         FROM PAO pao
         INNER JOIN produits p ON p.id = pao.id_produit
         WHERE p.id_user = ?
           AND (pao.dFin < CURDATE() OR (pao.active = 1 AND pao.dFin <= DATE_ADD(CURDATE(), INTERVAL ${PAO_ALERT_DAYS} DAY)))`,
        [userId]
    );
    const expiringEntries = paos.filter((pao) => pao.alert_state === 'expiring').map((pao) => ({
        dedupeKey: `pao-expiring:${pao.product_id}:${pao.ref}`,
        title: 'PAO bientôt à échéance',
        message: `La PAO « ${pao.ref} » de « ${pao.nom} » arrive à échéance le ${pao.end_date_label}.`,
        link: '/dashboard/PAO/'
    }));
    const expiredEntries = paos.filter((pao) => pao.alert_state === 'expired').map((pao) => ({
        dedupeKey: `pao-expired:${pao.product_id}:${pao.ref}`,
        title: 'PAO arrivée à échéance',
        message: `La PAO « ${pao.ref} » de « ${pao.nom} » est arrivée à échéance le ${pao.end_date_label}.`,
        link: '/dashboard/PAO/'
    }));
    await replaceAutomaticNotifications(connexion, userId, 'pao_expiring', expiringEntries);
    await replaceAutomaticNotifications(connexion, userId, 'pao_expired', expiredEntries);

    const paymentReminders = await connexion.query(
        `SELECT subscription_amount, subscription_credit, DATE_FORMAT(date_abo, '%d/%m/%Y') AS payment_date,
                DATE_FORMAT(date_abo, '%Y-%m-%d') AS payment_date_key
         FROM users
         WHERE id = ?
           AND abo = 1
           AND abo_cancel_requested_at IS NULL
           AND date_abo = DATE_ADD(CURDATE(), INTERVAL 2 DAY)
           AND subscription_amount IS NOT NULL
           AND subscription_amount > 0`,
        [userId]
    );
    const paymentEntries = paymentReminders.map((subscription) => {
        const amount = Number(subscription.subscription_amount);
        const credit = Math.max(0, Number(subscription.subscription_credit) || 0);
        const amountDue = Math.max(0, amount - credit);
        const paymentDate = subscription.payment_date;
        return {
            dedupeKey: `subscription-payment:${subscription.payment_date_key}`,
            title: amountDue > 0 ? 'Prélèvement à venir' : 'Avoir à utiliser',
            message: amountDue > 0
                ? `Dans 2 jours, le ${paymentDate}, vous serez prélevé(e) de ${formatAmount(amountDue)} pour votre abonnement GlowStock${credit > 0 ? `, après déduction de votre avoir de ${formatAmount(Math.min(credit, amount))}` : ''}.`
                : `Votre avoir de ${formatAmount(credit)} couvrira votre renouvellement du ${paymentDate}. Aucun prélèvement ne sera effectué.`,
            link: '/parametres/'
        };
    });
    await replaceAutomaticNotifications(connexion, userId, 'subscription_payment', paymentEntries);
}

async function getForUser(userId) {
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        await applyDueSubscriptionCreditsWithConnection(connexion, userId);
        await syncAutomaticNotifications(connexion, userId);
        const notifications = await connexion.query(
            `SELECT id, type, title, message, link, created_at
             FROM notifications
             WHERE user_id = ? AND dismissed_at IS NULL
             ORDER BY created_at DESC, id DESC
             LIMIT 50`,
            [userId]
        );
        const totals = await connexion.query(
            'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND dismissed_at IS NULL',
            [userId]
        );
        return { notifications, count: Number(totals[0]?.total || 0) };
    } finally {
        if (connexion) connexion.release();
    }
}

async function dismissAllForUser(userId) {
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        await connexion.query('UPDATE notifications SET dismissed_at = NOW() WHERE user_id = ? AND dismissed_at IS NULL', [userId]);
    } finally {
        if (connexion) connexion.release();
    }
}

function emitToUser(userId, event, payload) {
    const sockets = data.io?.sockets?.sockets;
    if (!sockets?.values) return;
    for (const socket of sockets.values()) {
        if (Number(socket.request.session?.userId) === Number(userId)) socket.emit(event, payload);
    }
}

async function createAnnouncement({ authorId, audience, recipientId, title, message }) {
    await ensureSchema();
    const safeTitle = cleanText(title, 160);
    const safeMessage = cleanText(message, 5000);
    if (!safeTitle || !safeMessage) throw new Error('Le titre et le message sont obligatoires.');
    if (!['all', 'user'].includes(audience)) throw new Error('Destinataire invalide.');

    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        let recipients;
        if (audience === 'all') {
            recipients = await connexion.query('SELECT id FROM users');
        } else {
            const targetId = Number(recipientId);
            if (!Number.isInteger(targetId) || targetId <= 0) throw new Error('Compte destinataire invalide.');
            recipients = await connexion.query('SELECT id FROM users WHERE id = ?', [targetId]);
            if (!recipients.length) throw new Error('Compte destinataire introuvable.');
        }

        for (const recipient of recipients) {
            await connexion.query(
                'INSERT INTO notifications (user_id, created_by_user_id, type, title, message) VALUES (?, ?, ?, ?, ?)',
                [recipient.id, authorId, 'announcement', safeTitle, safeMessage]
            );
        }
        return recipients.map((recipient) => Number(recipient.id));
    } finally {
        if (connexion) connexion.release();
    }
}

module.exports = { ensureSchema, getForUser, dismissAllForUser, createAnnouncement, emitToUser, applyDueSubscriptionCredits, analyseDueSubscriptionRenewals };
