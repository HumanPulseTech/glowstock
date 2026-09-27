const express = require('express');
const { verifyRequest } = require('./signing');
const { CaisseError } = require('./errors');
const { applyCommand, view } = require('./domain');
function createApp({ store, secret }) {
    if (!secret || secret.length < 48) throw new Error('CAISSE_BRIDGE_SECRET: minimum 48 caractères aléatoires.');
    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
    app.get('/health', (req, res) => res.json({ ok: true, service: 'caisse', mode: 'simulation' }));
    app.use(express.raw({ type: 'application/json', limit: '768kb' }));
    app.use(async (req, res, next) => {
        try {
            if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
            const identity = verifyRequest(secret, req);
            if (!identity) {
                console.warn('Caisse request rejected', { path: req.originalUrl, reason: 'invalid_signature' });
                return res.sendStatus(401);
            }
            if (!(await store.claimNonce(identity.nonce))) {
                console.warn('Caisse request rejected', { path: req.originalUrl, reason: 'replayed_nonce' });
                return res.sendStatus(401);
            }
            req.identity = identity;
            try {
                req.payload = JSON.parse(req.body.toString('utf8'));
            } catch (error) {
                error.code = 'CAISSE_INVALID_REQUEST_JSON';
                throw error;
            }
            next();
        } catch (error) { next(error); }
    });
    app.post('/v1/:command', async (req, res, next) => {
        try {
            const command = req.params.command;
            if (command === 'checkout') return res.status(501).json({ error: 'Encaissement réel indisponible : pilote non validé fiscalement.' });
            if (!['workspace', 'catalog', 'open', 'add', 'line', 'customer', 'simulate', 'cancel', 'cash-open', 'cash-close', 'audit-verify'].includes(command)) return res.sendStatus(404);
            if (command === 'audit-verify') return res.json(await store.verify(req.identity.tenant));
            const context = req.payload?.context;
            if (!context || !Array.isArray(context.products) || !Array.isArray(context.appointments) || context.products.length > 1000 || context.appointments.length > 200) throw new CaisseError('Contexte invalide.');
            const result = await store.run(req.identity.tenant, req.identity.actor, state => command === 'workspace'
                ? { result: view(state, context) } : applyCommand(state, command, req.payload.input, context));
            res.json(result);
        } catch (error) { next(error); }
    });
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = error instanceof CaisseError ? error.status : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 503;
        console.error('Caisse request failed', {
            method: req.method,
            path: req.originalUrl,
            status,
            code: error && error.code ? error.code : null,
            name: error && error.name ? error.name : null
        });
        res.status(status).json({ error: error instanceof CaisseError ? error.message : 'Service caisse indisponible. Aucun encaissement réel effectué.' });
    });
    return app;
}
module.exports = { createApp };
