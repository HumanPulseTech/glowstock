const express = require('express');
const { signRequest } = require('../services/caisse/src/signing');
const enabled = () => process.env.CAISSE_ENABLED === 'true';
async function hasCaisseAccess(userId, { hasPermission, getSubscriptionStatus }) {
    // Never trust session.role or a browser flag. Recheck current database rights.
    return Boolean(enabled() && userId
        && await hasPermission(userId, 'access_admin')
        && await hasPermission(userId, 'manage_products')
        && (await getSubscriptionStatus(userId)).level === 'full');
}
function requireCaisseAccess(dependencies) {
    return async (req, res, next) => {
        try {
            if (!enabled()) return res.sendStatus(404);
            if (!req.session?.userId) return res.status(401).json({ error: 'Reconnecte-toi pour ouvrir la caisse.' });
            if (!(await hasCaisseAccess(req.session.userId, dependencies))) return res.status(403).json({ error: 'Pilote caisse réservé à l’administration.' });
            next();
        } catch { res.status(503).json({ error: 'Caisse temporairement indisponible.' }); }
    };
}
function parisClock(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, minuteNow: Number(parts.hour) * 60 + Number(parts.minute) };
}
async function loadContext(getPool, userId) {
    const pool = await getPool(), clock = parisClock();
    const [products, appointments] = await Promise.all([
        pool.query('SELECT id, nom, ref_fournisseur, quantite FROM produits WHERE id_user = ? ORDER BY nom LIMIT 1001', [userId]),
        pool.query("SELECT id, client_name, service_name, TIME_FORMAT(start_time, '%H:%i') AS starts, TIME_FORMAT(end_time, '%H:%i') AS ends FROM planning_entries WHERE id_user = ? AND appointment_date = ? ORDER BY start_time LIMIT 201", [userId, clock.day])
    ]);
    if (products.length > 1000 || appointments.length > 200) throw new Error('CAISSE_PILOT_LIMIT');
    const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    return { ...clock,
        products: products.map(p => ({ id: Number(p.id), name: p.nom, reference: p.ref_fournisseur, quantity: Number(p.quantite) })),
        appointments: appointments.map(a => ({ id: Number(a.id), clientName: a.client_name, serviceName: a.service_name || '', startTime: a.starts,
            endTime: a.ends, startMinute: minute(a.starts), endMinute: minute(a.ends) })) };
}
function createCaisseRouter({ getPool, hasPermission, getSubscriptionStatus, requireSameOrigin, limitRequest }) {
    const router = express.Router();
    const access = { hasPermission, getSubscriptionStatus };
    router.get('/status', async (req, res) => {
        try { res.json({ enabled: await hasCaisseAccess(req.session?.userId, access), mode: 'simulation' }); }
        catch { res.json({ enabled: false }); }
    });
    router.use(requireCaisseAccess(access));
    router.use((req, res, next) => {
        try {
            if (!limitRequest(`caisse:${req.session.userId}`, 120, 60000)) return res.status(429).json({ error: 'Trop de demandes. Réessaie dans un instant.' });
            next();
        } catch { res.status(503).json({ error: 'Caisse temporairement indisponible.' }); }
    });
    router.post('/:command', requireSameOrigin, express.json({ limit: '24kb' }), async (req, res) => {
        if (!['workspace', 'catalog', 'open', 'add', 'line', 'simulate'].includes(req.params.command)) return res.sendStatus(404);
        try {
            const secret = process.env.CAISSE_BRIDGE_SECRET;
            const base = new URL(process.env.CAISSE_SERVICE_URL);
            if (!secret || secret.length < 48 || !['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('CAISSE_CONFIG');
            if (base.protocol !== 'https:' && process.env.CAISSE_ALLOW_PRIVATE_HTTP !== 'true') throw new Error('CAISSE_TLS_REQUIRED');
            const context = await loadContext(getPool, req.session.userId);
            const path = `/v1/${req.params.command}`;
            const body = JSON.stringify({ context, input: req.body });
            const response = await fetch(new URL(path, base), { method: 'POST', body,
                headers: signRequest(secret, path, req.session.userId, req.session.userId, body),
                signal: AbortSignal.timeout(6000), redirect: 'error' });
            if (![200, 400, 404, 409, 501].includes(response.status)) throw new Error('CAISSE_UPSTREAM');
            res.status(response.status).json(await response.json());
        } catch { res.status(503).json({ error: 'La caisse ne répond pas. Recharge le ticket avant de réessayer : la dernière action a peut-être été enregistrée.' }); }
    });
    return router;
}
module.exports = { createCaisseRouter, parisClock, loadContext, enabled, hasCaisseAccess, requireCaisseAccess };
