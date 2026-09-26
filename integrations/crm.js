const express = require('express');
const { requireCaisseAccess, callCaisse } = require('./caisse');
const { InputError, priceCents, customerInput, serviceInput, saveProductPrice } = require('./crm-data');
const idFor = value => { const id = Number(value); if (!Number.isSafeInteger(id) || id < 1) throw new InputError('Identifiant invalide.'); return id; };
async function transaction(pool, work) {
    const c = await pool.getConnection();
    try { await c.beginTransaction(); const result = await work(c); await c.commit(); return result; }
    catch (e) { await c.rollback().catch(() => {}); throw e; } finally { c.release(); }
}
async function owned(c, table, id, userId) {
    // table is a constant supplied by this module, never by the request.
    const rows = await c.query(`SELECT id FROM ${table} WHERE id = ? AND id_user = ? FOR UPDATE`, [id, userId]);
    if (!rows.length) throw new InputError('Élément introuvable dans votre compte.', 404);
}
function createCrmRouter(deps) {
    const router = express.Router();
    router.use(requireCaisseAccess(deps));
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); if (!deps.limitRequest(`crm:${req.session.userId}`, 120, 60000)) return res.sendStatus(429); next(); });
    router.use((req, res, next) => req.method === 'GET' ? next() : deps.requireSameOrigin(req, res, next));
    router.use(express.json({ limit: '24kb' }));
    const wrap = fn => async (req, res, next) => { try { await fn(req, res, await deps.getPool(), req.session.userId); } catch (e) { next(e); } };
    router.get('/data', wrap(async (req, res, pool, userId) => {
        const [customers, services, products, linkedProducts] = await Promise.all([
            pool.query('SELECT id, name, email, phone, address, notes, version FROM crm_customers WHERE id_user = ? ORDER BY name LIMIT 1001', [userId]),
            pool.query('SELECT * FROM crm_services WHERE id_user = ? ORDER BY name LIMIT 501', [userId]),
            pool.query('SELECT id, nom, ref_fournisseur FROM produits WHERE id_user = ? ORDER BY nom LIMIT 1001', [userId]),
            pool.query('SELECT sp.service_id, sp.product_id FROM crm_service_products sp JOIN crm_services s ON s.id = sp.service_id JOIN produits p ON p.id = sp.product_id AND p.id_user = s.id_user WHERE s.id_user = ?', [userId])
        ]);
        if (customers.length > 1000 || services.length > 500 || products.length > 1000) throw new InputError('Limite du pilote atteinte.', 409);
        res.json({ customers, services: services.map(s => ({ ...s, productIds: linkedProducts.filter(l => Number(l.service_id) === Number(s.id)).map(l => Number(l.product_id)) })), products });
    }));
    router.post('/customers', wrap(async (req, res, pool, userId) => {
        const data = customerInput(req.body), id = req.body.id == null ? null : idFor(req.body.id);
        const saved = await transaction(pool, async c => {
            if (id) {
                await owned(c, 'crm_customers', id, userId);
                const r = await c.query('UPDATE crm_customers SET name=?, email=?, phone=?, address=?, notes=?, version=version+1 WHERE id=? AND id_user=? AND version=?', [...Object.values(data), id, userId, Number(req.body.version)]);
                if (!r.affectedRows) throw new InputError('Cette fiche a changé. Actualisez-la avant de modifier.', 409);
                return id;
            }
            const r = await c.query('INSERT INTO crm_customers (id_user, name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?, ?)', [userId, ...Object.values(data)]);
            return Number(r.insertId);
        }); res.json({ id: saved });
    }));
    router.post('/services', wrap(async (req, res, pool, userId) => {
        const data = serviceInput(req.body), id = req.body.id == null ? null : idFor(req.body.id);
        const saved = await transaction(pool, async c => {
            for (const productId of data.productIds) await owned(c, 'produits', productId, userId);
            const values = [data.name, data.priceCents, data.taxMode, data.taxBps, data.duration, data.description];
            let serviceId = id;
            if (id) {
                await owned(c, 'crm_services', id, userId);
                const r = await c.query('UPDATE crm_services SET name=?, price_cents=?, tax_mode=?, tax_bps=?, duration_minutes=?, description=?, version=version+1 WHERE id=? AND id_user=? AND version=?', [...values, id, userId, Number(req.body.version)]);
                if (!r.affectedRows) throw new InputError('Cette prestation a changé. Actualisez-la avant de modifier.', 409);
            } else serviceId = Number((await c.query('INSERT INTO crm_services (name, price_cents, tax_mode, tax_bps, duration_minutes, description, id_user) VALUES (?, ?, ?, ?, ?, ?, ?)', [...values, userId])).insertId);
            await c.query('DELETE FROM crm_service_products WHERE service_id = ?', [serviceId]);
            for (const productId of data.productIds) await c.query('INSERT INTO crm_service_products (service_id, product_id) VALUES (?, ?)', [serviceId, productId]);
            return serviceId;
        }); res.json({ id: saved });
    }));
    router.get('/appointments', wrap(async (req, res, pool, userId) => {
        const page = Math.max(0, Number(req.query.page) || 0); if (!Number.isSafeInteger(page) || page > 100000) throw new InputError('Page invalide.');
        const rows = await pool.query("SELECT p.id, DATE_FORMAT(p.appointment_date, '%Y-%m-%d') AS day, TIME_FORMAT(p.start_time, '%H:%i') AS time, p.client_name, p.service_name, l.customer_id, l.service_id FROM planning_entries p LEFT JOIN crm_appointment_links l ON l.appointment_id=p.id AND l.id_user=p.id_user WHERE p.id_user=? ORDER BY p.appointment_date DESC, p.start_time DESC, p.id DESC LIMIT 51 OFFSET ?", [userId, page * 50]);
        res.json({ rows: rows.slice(0, 50), more: rows.length > 50, page });
    }));
    router.post('/appointments/:id/link', wrap(async (req, res, pool, userId) => {
        const id = idFor(req.params.id), customerId = req.body.customerId == null ? null : idFor(req.body.customerId), serviceId = req.body.serviceId == null ? null : idFor(req.body.serviceId);
        await transaction(pool, async c => {
            await owned(c, 'planning_entries', id, userId);
            if (customerId) await owned(c, 'crm_customers', customerId, userId);
            if (serviceId) await owned(c, 'crm_services', serviceId, userId);
            await c.query('INSERT INTO crm_appointment_links (appointment_id, id_user, customer_id, service_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE customer_id=VALUES(customer_id), service_id=VALUES(service_id)', [id, userId, customerId, serviceId]);
        }); res.json({ ok: true });
    }));
    router.get('/customers/:id/history', wrap(async (req, res, pool, userId) => {
        const id = idFor(req.params.id);
        const customer = await pool.query('SELECT id FROM crm_customers WHERE id=? AND id_user=?', [id, userId]);
        if (!customer.length) throw new InputError('Cliente introuvable.', 404);
        const appointments = await pool.query("SELECT p.id, DATE_FORMAT(p.appointment_date, '%Y-%m-%d') AS day, TIME_FORMAT(p.start_time, '%H:%i') AS time, p.service_name FROM planning_entries p JOIN crm_appointment_links l ON l.appointment_id=p.id AND l.id_user=p.id_user WHERE p.id_user=? AND l.customer_id=? ORDER BY p.appointment_date DESC, p.start_time DESC LIMIT 1001", [userId, id]);
        let tickets = null;
        try {
            const upstream = await callCaisse('workspace', {}, userId, deps.getPool);
            if (upstream.status === 200) tickets = upstream.data.drafts.filter(d => d.customerId === id);
        } catch { /* Unknown is not zero. Preserve appointments when cashier is down. */ }
        const simulated = tickets?.filter(t => t.status === 'simulated') || [];
        res.json({ appointments: appointments.slice(0, 1000), appointmentsTruncated: appointments.length > 1000, tickets,
            averageTicketCents: null, simulatedAverageCents: simulated.length ? Math.round(simulated.reduce((n, t) => n + t.totals.grossCents, 0) / simulated.length) : null });
    }));
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.status(error.status || 503).json({ error: error instanceof InputError ? error.message : error.code === 'ER_NO_SUCH_TABLE' ? 'Appliquez la migration 021 dans la base GlowStock pour activer Clientes, Prestations et Prix.' : 'Impossible d’enregistrer ou de charger ces informations. Réessayez après actualisation.' });
    });
    return router;
}
function createProductPriceRouter(deps) {
    const router = express.Router();
    router.post('/:id/price', deps.requireSameOrigin, express.json({ limit: '1kb' }), async (req, res) => {
        try {
            const userId = req.session?.userId;
            if (!userId) return res.sendStatus(401);
            if (!(await deps.hasPermission(userId, 'access_admin')) || !(await deps.hasPermission(userId, 'manage_products')) || (await deps.getSubscriptionStatus(userId)).level !== 'full') return res.sendStatus(403);
            if (!deps.limitRequest(`product-price:${userId}`, 60, 60000)) return res.sendStatus(429);
            const id = idFor(req.params.id), cents = priceCents(req.body.price);
            await transaction(await deps.getPool(), async c => { await owned(c, 'produits', id, userId); await saveProductPrice(c, userId, id, cents); });
            res.json({ priceCents: cents });
        } catch (e) { res.status(e.status || 503).json({ error: e instanceof InputError ? e.message : 'Enregistrement du prix impossible. Vérifiez que la migration 021 a été appliquée.' }); }
    }); return router;
}
module.exports = { createCrmRouter, createProductPriceRouter, transaction, owned };
