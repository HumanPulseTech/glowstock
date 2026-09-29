const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { callCaisse } = require('./caisse');
const { InputError, priceCents, customerInput, profileInput, consentInput, serviceInput, saveProductPrice } = require('./crm-data');
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
async function crmAccess(req, deps, manage = false) {
    const userId = req.session?.userId;
    if (!userId) throw new InputError('Reconnecte-toi pour accéder aux clientes.', 401);
    if (!(await deps.hasPermission(userId, 'dashboard')) || (await deps.getSubscriptionStatus(userId)).level !== 'full') throw new InputError('Cet abonnement ou rôle ne permet pas d’accéder aux clientes.', 403);
    if (manage && !(await deps.hasPermission(userId, 'manage_products'))) throw new InputError('Ce rôle peut consulter les clientes, pas les modifier.', 403);
    return userId;
}
function mediaMeta(req) {
    const filename = path.basename(String(req.get('x-upload-filename') || '')).replace(/[\u0000-\u001F]/g, '').slice(0, 180);
    const mime = String(req.get('x-upload-mime') || '').toLowerCase();
    const kind = String(req.get('x-customer-media-kind') || 'document');
    if (!filename || /[\\/:*?"<>|]/.test(filename) || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime) || !['before_after_photo', 'document'].includes(kind)) throw new InputError('Fichier ou type de document invalide.');
    if (kind === 'before_after_photo' && !mime.startsWith('image/')) throw new InputError('Une photo avant/après doit être une image.');
    return { filename, mime, kind };
}
function createCrmRouter(deps) {
    const router = express.Router();
    router.use(async (req, res, next) => { try { await crmAccess(req, deps); res.set('Cache-Control', 'no-store'); if (!deps.limitRequest(`crm:${req.session.userId}`, 120, 60000)) return res.sendStatus(429); next(); } catch (error) { next(error); } });
    router.use((req, res, next) => req.method === 'GET' ? next() : deps.requireSameOrigin(req, res, next));
    router.use(express.json({ limit: '24kb' }));
    const wrap = (fn, manage = false) => async (req, res, next) => { try { const userId = await crmAccess(req, deps, manage); await fn(req, res, await deps.getPool(), userId); } catch (e) { next(e); } };
    router.get('/data', wrap(async (req, res, pool, userId) => {
        const [customers, services, products, linkedProducts, profiles, mediaCounts] = await Promise.all([
            pool.query('SELECT id, name, email, phone, address, notes, version FROM crm_customers WHERE id_user = ? ORDER BY name LIMIT 1001', [userId]),
            pool.query('SELECT * FROM crm_services WHERE id_user = ? ORDER BY name LIMIT 501', [userId]),
            pool.query('SELECT id, nom, ref_fournisseur FROM produits WHERE id_user = ? ORDER BY nom LIMIT 1001', [userId]),
            pool.query('SELECT sp.service_id, sp.product_id FROM crm_service_products sp JOIN crm_services s ON s.id = sp.service_id JOIN produits p ON p.id = sp.product_id AND p.id_user = s.id_user WHERE s.id_user = ?', [userId]),
            pool.query('SELECT customer_id, version FROM crm_customer_profiles WHERE id_user=?', [userId]).catch(error => error.code === 'ER_NO_SUCH_TABLE' ? [] : Promise.reject(error)),
            pool.query('SELECT customer_id, COUNT(*) AS total FROM crm_customer_media WHERE id_user=? AND deleted_at IS NULL GROUP BY customer_id', [userId]).catch(error => error.code === 'ER_NO_SUCH_TABLE' ? [] : Promise.reject(error))
        ]);
        if (customers.length > 1000 || services.length > 500 || products.length > 1000) throw new InputError('Limite du pilote atteinte.', 409);
        const profileVersions = new Map(profiles.map(item => [Number(item.customer_id), Number(item.version)]));
        const mediaByCustomer = new Map(mediaCounts.map(item => [Number(item.customer_id), Number(item.total)]));
        res.json({ customers: customers.map(customer => ({ ...customer, profileVersion: profileVersions.get(Number(customer.id)) || 0, mediaCount: mediaByCustomer.get(Number(customer.id)) || 0 })), services: services.map(s => ({ ...s, productIds: linkedProducts.filter(l => Number(l.service_id) === Number(s.id)).map(l => Number(l.product_id)) })), products });
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
    }, true));
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
    }, true));
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
    }, true));
    router.post('/customers/:id/profile', wrap(async (req, res, pool, userId) => {
        const id = idFor(req.params.id), data = profileInput(req.body), expectedVersion = Number(req.body.version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new InputError('Version de fiche invalide.');
        await transaction(pool, async c => {
            await owned(c, 'crm_customers', id, userId);
            if (!expectedVersion) {
                const inserted = await c.query('INSERT IGNORE INTO crm_customer_profiles (customer_id,id_user,preferences,observations,version) VALUES (?,?,?,?,1)', [id, userId, data.preferences, data.observations]);
                if (!inserted.affectedRows) throw new InputError('Cette fiche a changé. Actualisez-la avant de modifier.', 409);
            } else {
                const updated = await c.query('UPDATE crm_customer_profiles SET preferences=?,observations=?,version=version+1 WHERE customer_id=? AND id_user=? AND version=?', [data.preferences, data.observations, id, userId, expectedVersion]);
                if (!updated.affectedRows) throw new InputError('Cette fiche a changé. Actualisez-la avant de modifier.', 409);
            }
        }); res.json({ ok: true });
    }, true));
    router.post('/customers/:id/consents', wrap(async (req, res, pool, userId) => {
        const id = idFor(req.params.id), data = consentInput(req.body);
        await transaction(pool, async c => {
            await owned(c, 'crm_customers', id, userId);
            await c.query('INSERT INTO crm_customer_consents (id,id_user,customer_id,consent_type,action,details,captured_by) VALUES (?,?,?,?,?,?,?)', [crypto.randomUUID(), userId, id, data.type, data.action, data.details || null, userId]);
        }); res.status(201).json({ ok: true });
    }, true));
    router.post('/customers/:id/media', deps.requireSameOrigin, express.raw({ type: 'application/octet-stream', limit: '2mb' }), wrap(async (req, res, pool, userId) => {
        const id = idFor(req.params.id), meta = mediaMeta(req);
        if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length > 2 * 1024 * 1024) throw new InputError('Le fichier doit peser entre 1 octet et 2 Mo.');
        const signature = req.body.subarray(0, 12);
        const valid = (meta.mime === 'image/jpeg' && signature.subarray(0, 3).toString('hex') === 'ffd8ff') || (meta.mime === 'image/png' && signature.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') || (meta.mime === 'image/webp' && signature.subarray(0, 4).toString('ascii') === 'RIFF' && signature.subarray(8, 12).toString('ascii') === 'WEBP') || (meta.mime === 'application/pdf' && signature.subarray(0, 5).toString('ascii') === '%PDF-');
        if (!valid) throw new InputError('Le contenu du fichier ne correspond pas à son type.');
        const mediaId = crypto.randomUUID();
        await transaction(pool, async c => {
            await owned(c, 'crm_customers', id, userId);
            const count = await c.query('SELECT COUNT(*) AS total FROM crm_customer_media WHERE customer_id=? AND id_user=? AND deleted_at IS NULL FOR UPDATE', [id, userId]);
            if (Number(count[0].total) >= 50) throw new InputError('Cette cliente a déjà atteint la limite de 50 fichiers.', 409);
            await c.query('INSERT INTO crm_customer_media (id,id_user,customer_id,kind,filename,mime_type,byte_size,sha256,blob_data,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)', [mediaId, userId, id, meta.kind, meta.filename, meta.mime, req.body.length, crypto.createHash('sha256').update(req.body).digest('hex'), req.body, userId]);
        }); res.status(201).json({ id: mediaId });
    }, true));
    router.get('/customers/:id/media/:mediaId', wrap(async (req, res, pool, userId) => {
        const customerId = idFor(req.params.id), mediaId = String(req.params.mediaId || '');
        if (!/^[a-f0-9-]{36}$/i.test(mediaId)) throw new InputError('Fichier invalide.');
        const rows = await pool.query('SELECT filename,mime_type,byte_size,blob_data FROM crm_customer_media WHERE id=? AND customer_id=? AND id_user=? AND deleted_at IS NULL', [mediaId, customerId, userId]);
        if (!rows.length) throw new InputError('Fichier introuvable.', 404);
        const file = rows[0]; res.set({ 'Content-Type': file.mime_type, 'Content-Length': String(file.byte_size), 'Content-Disposition': `inline; filename="${String(file.filename).replace(/["\\]/g, '')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }); res.send(file.blob_data);
    }));
    router.delete('/customers/:id/media/:mediaId', wrap(async (req, res, pool, userId) => {
        const customerId = idFor(req.params.id), mediaId = String(req.params.mediaId || '');
        if (!/^[a-f0-9-]{36}$/i.test(mediaId)) throw new InputError('Fichier invalide.');
        await transaction(pool, async c => { const result = await c.query('UPDATE crm_customer_media SET blob_data=NULL, deleted_at=NOW() WHERE id=? AND customer_id=? AND id_user=? AND deleted_at IS NULL', [mediaId, customerId, userId]); if (!result.affectedRows) throw new InputError('Fichier introuvable.', 404); }); res.json({ ok: true });
    }, true));
    router.get('/customers/:id/history', wrap(async (req, res, pool, userId) => {
        const id = idFor(req.params.id);
        const customer = await pool.query('SELECT id FROM crm_customers WHERE id=? AND id_user=?', [id, userId]);
        if (!customer.length) throw new InputError('Cliente introuvable.', 404);
        const [appointments, profiles, consents, media, usedProducts] = await Promise.all([
            pool.query("SELECT p.id, DATE_FORMAT(p.appointment_date, '%Y-%m-%d') AS day, TIME_FORMAT(p.start_time, '%H:%i') AS time, p.service_name, s.name AS linked_service_name FROM planning_entries p JOIN crm_appointment_links l ON l.appointment_id=p.id AND l.id_user=p.id_user LEFT JOIN crm_services s ON s.id=l.service_id AND s.id_user=l.id_user WHERE p.id_user=? AND l.customer_id=? ORDER BY p.appointment_date DESC, p.start_time DESC LIMIT 1001", [userId, id]),
            pool.query('SELECT preferences,observations,version FROM crm_customer_profiles WHERE customer_id=? AND id_user=?', [id, userId]).catch(error => error.code === 'ER_NO_SUCH_TABLE' ? [] : Promise.reject(error)),
            pool.query('SELECT consent_type,action,details,created_at FROM crm_customer_consents WHERE customer_id=? AND id_user=? ORDER BY created_at DESC LIMIT 101', [id, userId]).catch(error => error.code === 'ER_NO_SUCH_TABLE' ? [] : Promise.reject(error)),
            pool.query('SELECT id,kind,filename,mime_type,byte_size,created_at FROM crm_customer_media WHERE customer_id=? AND id_user=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 51', [id, userId]).catch(error => error.code === 'ER_NO_SUCH_TABLE' ? [] : Promise.reject(error)),
            pool.query('SELECT DISTINCT pr.nom FROM crm_appointment_links l JOIN crm_service_products sp ON sp.service_id=l.service_id JOIN produits pr ON pr.id=sp.product_id AND pr.id_user=l.id_user WHERE l.customer_id=? AND l.id_user=? ORDER BY pr.nom LIMIT 101', [id, userId]).catch(error => error.code === 'ER_NO_SUCH_TABLE' ? [] : Promise.reject(error))
        ]);
        let tickets = null;
        try {
            const upstream = await callCaisse('workspace', {}, userId, deps.getPool);
            if (upstream.status === 200) tickets = upstream.data.drafts.filter(d => d.customerId === id);
        } catch { /* Unknown is not zero. Preserve appointments when cashier is down. */ }
        const simulated = tickets?.filter(t => t.status === 'simulated') || [];
        res.json({ appointments: appointments.slice(0, 1000), appointmentsTruncated: appointments.length > 1000, profile: profiles[0] || { preferences: '', observations: '', version: 0 }, consents: consents.slice(0, 100), media: media.slice(0, 50), usedProducts: usedProducts.slice(0, 100).map(item => item.nom), tickets,
            averageTicketCents: null, simulatedAverageCents: simulated.length ? Math.round(simulated.reduce((n, t) => n + t.totals.grossCents, 0) / simulated.length) : null });
    }));
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.status(error.status || 503).json({ error: error instanceof InputError ? error.message : error.code === 'ER_NO_SUCH_TABLE' ? 'Appliquez les migrations 021 puis 025 dans la base GlowStock pour activer les fiches clientes.' : 'Impossible d’enregistrer ou de charger ces informations. Réessayez après actualisation.' });
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
