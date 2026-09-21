// Isolated developer preview. No .env loading, no production DB, loopback only.
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const express = require('express');
const { createApp } = require('../src/app');
const { MemoryStore } = require('../src/store');
const { applyCommand } = require('../src/domain');
const { signRequest } = require('../src/signing');
async function startDemo(port = 0) {
    const root = path.join(__dirname, '../../..'), secret = randomBytes(48).toString('hex'), store = new MemoryStore();
    const context = { day: '2026-09-21', minuteNow: 635, products: [{ id: 1, name: 'Huile cuticules', quantity: 12 }, { id: 2, name: 'Crème mains velours', quantity: 8 }],
        appointments: [{ id: 1, clientName: 'Camille Martin', serviceName: 'Pose complète', startTime: '10:00', endTime: '11:00', startMinute: 600, endMinute: 660 }, { id: 2, clientName: 'Léa Dubois', serviceName: 'Remplissage', startTime: '11:30', endTime: '12:15', startMinute: 690, endMinute: 735 }] };
    for (const [name, amount, productId] of [['Pose complète', 5500, null], ['Remplissage', 4500, null], ['Dépose & soin', 2500, null], ['Nail art', 500, null], ['Huile cuticules', 1200, 1], ['Crème mains velours', 1600, 2]]) {
        await store.run('1', '1', state => applyCommand(state, 'catalog', { kind: productId ? 'product' : 'service', name, unitCents: amount, productId, taxMode: 'vat', taxBps: 2000 }, context));
    }
    const service = createApp({ store, secret }).listen(0, '127.0.0.1'); await new Promise(resolve => service.once('listening', resolve));
    const app = express(); app.use(express.json());
    app.get('/api/caisse/status', (req, res) => res.json({ enabled: true, mode: 'simulation' }));
    app.get('/api/caisse/inventory', (req, res) => res.json({ products: context.products, source: 'account-inventory' }));
    app.post('/api/caisse/:command', async (req, res) => {
        try {
            const route = `/v1/${encodeURIComponent(req.params.command)}`, body = JSON.stringify({ context, input: req.body });
            const upstream = await fetch(`http://127.0.0.1:${service.address().port}${route}`, { method: 'POST', headers: signRequest(secret, route, 1, 1, body), body });
            res.status(upstream.status).json(await upstream.json());
        } catch { res.status(503).json({ error: 'Démo indisponible.' }); }
    });
    app.use(express.static(path.join(root, 'public')));
    app.get('/dashboard/caisse/', (req, res) => res.sendFile(path.join(root, 'template/caisse.html')));
    app.get('/', (req, res) => res.redirect('/dashboard/caisse/'));
    const web = app.listen(port, '127.0.0.1'); await new Promise(resolve => web.once('listening', resolve));
    return { url: `http://127.0.0.1:${web.address().port}/dashboard/caisse/`, close: async () => { await Promise.all([web, service].map(server => new Promise(resolve => server.close(resolve)))); } };
}
if (require.main === module) startDemo(Number(process.env.CAISSE_DEMO_PORT || 8095)).then(demo => console.log(`Démo locale fictive: ${demo.url}`));
module.exports = { startDemo };
