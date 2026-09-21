const miku = {}

require('dotenv').config()

const express = require("express");
const fs = require('fs');
const https = require('https');
const { randomUUID } = require('crypto');

const app = express();
const session = require("express-session");
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const port = Number(process.env.PORT || 8087);
const isProduction = process.env.NODE_ENV === 'production';
const fallbackPublicUrl = 'https://glowstock.fr';
function getPublicUrl() {
    try {
        return new URL(String(process.env.PUBLIC_URL || fallbackPublicUrl)).origin.replace(/\/$/, '');
    } catch (_) {
        return fallbackPublicUrl;
    }
}
const publicUrl = getPublicUrl();
const { allowedOrigin, allowedSocketRequest, createLimiter, validateSession } = require('./security/runtime.js');
const limitRequest = createLimiter();
const { refreshSessionActivity } = require('./security/session-activity.js');
const { createSocketGuard } = require('./security/socket-guard.js');
const caisse = require('./integrations/caisse.js');
const trustProxy = process.env.TRUST_PROXY === undefined
    ? isProduction
    : ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY).toLowerCase());

const pfxPath = process.env.DEV_HTTPS_PFX || path.join(__dirname, 'certs', 'glowstock-dev.pfx');
const requestedDevHttps = process.env.DEV_HTTPS === 'true';
if (requestedDevHttps && !fs.existsSync(pfxPath)) {
    throw new Error(`DEV_HTTPS=true mais le certificat est introuvable : ${pfxPath}`);
}
const useDevHttps = requestedDevHttps;
const http = useDevHttps
    ? https.createServer({ pfx: fs.readFileSync(pfxPath), passphrase: process.env.DEV_HTTPS_PFX_PASSWORD || 'glowstock-dev' }, app)
    : require('http').createServer(app);

const serverLogger = require('./Miku/serverLogger.js');
const { createAutoTicket } = require('./Miku/autoTicket.js');
const expectedDisconnectCodes = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED']);
const getErrorCode = (reason) => reason?.code || reason?.cause?.code || null;
const isExpectedDisconnect = (reason) => {
    const code = getErrorCode(reason);
    return expectedDisconnectCodes.has(code) || /(?:ECONNRESET|EPIPE|ECONNABORTED)/i.test(String(reason?.message || reason || ''));
};
process.on('uncaughtExceptionMonitor', (error, origin) => {
    serverLogger.emergency('process.uncaught_exception', error?.message || 'Exception non gérée.', { origin, error });
    void createAutoTicket({ type: 'process.uncaught_exception', message: error?.message || 'Exception non gérée.', context: { origin, error } });
});
process.on('unhandledRejection', (reason) => {
    const message = reason?.message || String(reason || 'Promesse rejetée.');
    const context = { code: getErrorCode(reason), reason };
    // Les déconnexions réseau transitoires restent journalisées sans créer un faux ticket.
    if (isExpectedDisconnect(reason)) {
        void serverLogger.warn('process.unhandled_rejection_disconnect', 'Connexion interrompue avant la fin de l’échange.', context);
        return;
    }
    void serverLogger.error('process.unhandled_rejection', reason?.message || String(reason || 'Promesse rejetée.'), { reason });
    void createAutoTicket({ type: 'process.unhandled_rejection', message: reason?.message || String(reason || 'Promesse rejetée.'), context: { reason } });
});

const data = require('./Miku/array.js');
const { getPool } = require('./Miku/db.js');
const { getSubscriptionStatus } = require('./Miku/subscription.js');
const { hasPermission } = require('./Miku/permissions.js');
const { isFeatureEnabled } = require('./Miku/featureFlags.js');
const { listOffers } = require('./Miku/marketingOffers.js');
const { CompanyLookupError, lookupCompanyBySiret } = require('./Miku/companyRegistry.js');
const { analyseDueSubscriptionRenewals } = require('./Miku/notificationCenter.js');
const {
    BillingError,
    ensureSchema: ensureStripeSchema,
    createCheckoutSession,
    createPortalSession,
    handleWebhook,
    cleanupWebhookEvents
} = require('./Miku/stripeBilling.js');
data.env = process.env

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET doit contenir au moins 32 caractères.');
}

app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (!/\.(?:css|js|svg|png|jpe?g|woff2?|ico)$/i.test(req.path)) res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https://images.unsplash.com data:; style-src 'self' 'unsafe-inline' https://api.fontshare.com; font-src 'self' https://api.fontshare.com; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com; connect-src 'self'; media-src 'self' blob:");
    // Les espaces connectés, les APIs et les pages de compte n'apportent aucune valeur dans les résultats de recherche.
    if (/^\/(?:api(?:\/|$)|connexion(?:\/|$)|ins(?:\/|$)|dashboard(?:\/|$)|admin(?:\/|$)|ticket(?:\/|$)|parametres(?:\/|$)|abonnement-expire(?:\/|$)|verif(?:\/|$)|conditions-utilisation(?:\/|$)|politique-confidentialite(?:\/|$)|mentions-legales(?:\/|$))/.test(req.path)) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    next();
});

const sessionStore = new MySQLStore({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'glowstock', createDatabaseTable: true
});
const sessionMiddleware = session({
    name: isProduction ? '__Host-glowstock.sid' : 'glowstock.sid', secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
    proxy: trustProxy,
    store: sessionStore,
    // Production requires HTTPS and a correctly configured trusted reverse proxy.
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction || useDevHttps, maxAge: 1000 * 60 * 60 * 8 }
});
app.use(sessionMiddleware);

app.use(async (req, res, next) => {
    if (!req.session?.userId || /\.(?:css|js|svg|png|jpe?g|woff2?|ico|apk)$/i.test(req.path)) return next();
    try {
        if (!(await validateSession(req.session, getPool))) return req.session.destroy(error => error ? next(error) : next());
        if (!(await refreshSessionActivity(sessionStore, req.sessionID))) return req.session.destroy(error => error ? next(error) : next());
        next();
    } catch (error) { next(error); }
});

function requireSameOrigin(req, res, next) {
    const origin = isProduction ? publicUrl : (process.env.PUBLIC_URL || `${useDevHttps ? 'https' : 'http'}://localhost:${port}`);
    if (!allowedOrigin(req.get('origin'), origin)) return res.status(403).json({ error: 'Origine refusée.' });
    next();
}
function authEndpoint(feature, handler, input) {
    return async (req, res, next) => {
        try {
            if (!limitRequest(`auth:${feature}:${req.ip}`, 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.' });
            if (!(await isFeatureEnabled(feature))) return res.status(503).json({ error: 'Fonction temporairement indisponible.' });
            await handler(input(req), { request: req, id: req.requestId, emit: (event, result) => {
                if (res.headersSent) return;
                if (event === 'connection ac') res.json({ ok: true, ...result });
                else res.status(400).json({ error: result });
            } });
        } catch (error) { next(error); }
    };
}
app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const isAsset = /\.(?:css|js|map|svg|png|jpe?g|webp|ico|woff2?|ttf)$/i.test(req.path);
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    if (!isAsset) {
        void serverLogger.info('http.request.start', `${req.method} ${req.path}`, {
            method: req.method,
            path: req.path,
            queryKeys: Object.keys(req.query || {}),
            hasSessionCookie: Boolean((req.headers.cookie || '').split(';').some((cookie) => cookie.trim().startsWith('glowstock.sid=')))
        }, { userId: req.session?.userId, requestId });
        res.once('finish', () => {
            const durationMs = Date.now() - startedAt;
            const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
            void serverLogger.log(level, 'http.request.complete', `${req.method} ${req.path} → ${res.statusCode}`, {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs
            }, { userId: req.session?.userId, requestId });
        });
    }
    next();
});

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        void serverLogger.warn('auth.http.session_missing', 'Accès protégé refusé : session HTTP absente.', {
            path: req.path,
            hasSessionCookie: Boolean((req.headers.cookie || '').split(';').some((cookie) => cookie.trim().startsWith('glowstock.sid=')))
        }, { requestId: req.requestId });
        return res.redirect('/connexion/');
    }
    next();
}

// HTTP authentication lets regeneration issue a fresh session cookie.
app.post('/api/auth/login', requireSameOrigin, express.json({ limit: '4kb' }), authEndpoint('login', require('./Miku/function/connect.js'), req => req.body));
app.post('/api/auth/verify', requireSameOrigin, express.json({ limit: '1kb' }), authEndpoint('signup', require('./Miku/function/validMail.js'), req => req.body?.token));
app.use('/api/caisse', caisse.createCaisseRouter({ getPool, hasPermission, getSubscriptionStatus, requireSameOrigin, limitRequest }));

function requireApiAuth(req, res, next) {
    if (!req.session?.userId) return res.status(401).json({ error: 'Session expirée.' });
    next();
}

function requireBillingOrigin(req, res, next) {
    let publicUrl = '';
    try { publicUrl = new URL(String(process.env.PUBLIC_URL || process.env.APP_URL || '')).origin; }
    catch (_) { return res.status(403).json({ error: 'Origine de la demande invalide.' }); }
    const origin = String(req.get('origin') || '').replace(/\/$/, '');
    if (!publicUrl || !origin || origin !== publicUrl) return res.status(403).json({ error: 'Origine de la demande invalide.' });
    next();
}

async function requireAdmin(req, res, next) {
    if (!req.session?.userId) return res.redirect('/connexion/');
    let connexion;
    try {
        if (!(await hasPermission(req.session.userId, 'access_admin'))) return res.status(403).send('Accès administrateur requis.');
        next();
    } catch (error) {
        next(error);
    } finally {
        if (connexion) connexion.release();
    }
}

function requireSubscription(access) {
    return async (req, res, next) => {
        try {
            const status = await getSubscriptionStatus(req.session.userId);
            if (status.level === 'full' || (status.level === 'limited' && access === 'consultation')) return next();
            const mode = status.level === 'limited' ? 'limite' : 'expire';
            return res.redirect(`/abonnement-expire/?mode=${mode}`);
        } catch (error) {
            next(error);
        }
    };
}

function requirePermission(permission) {
    return async (req, res, next) => {
        try { if (await hasPermission(req.session.userId, permission)) return next(); return res.status(403).send('Accès refusé pour ce rôle.'); }
        catch (error) { next(error); }
    };
}

function requireFeature(feature) {
    return async (req, res, next) => {
        try {
            if (await isFeatureEnabled(feature)) return next();
            return res.status(503).send('Cette fonctionnalité est temporairement désactivée par l’administration.');
        } catch (error) {
            next(error);
        }
    };
}

function chargerFonctionsDossier(dossier) {
    fs.readdirSync(dossier).forEach(file => {
        const fullPath = path.join(dossier, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            chargerFonctionsDossier(fullPath); // appel récursif pour sous-dossier
        } else if (file.endsWith('.js')) {
            const nomFonction = path.basename(file, '.js');
            miku[nomFonction] = require(fullPath);
        }
    });
}

chargerFonctionsDossier(path.join(__dirname, 'Miku'));
void serverLogger.info('server.functions.loaded', `${Object.keys(miku).length} fonctions serveur chargées.`, {
    functions: Object.keys(miku).sort()
});

/**
 * @type {Socket}
 */

const io = require('socket.io')(http, {
    maxHttpBufferSize: 256 * 1024,
    allowRequest: (req, done) => {
        const origin = isProduction ? publicUrl : (process.env.PUBLIC_URL || `${useDevHttps ? 'https' : 'http'}://localhost:${port}`);
        done(null, allowedSocketRequest(req.headers, origin));
    }
});

io.engine.use(sessionMiddleware);

function allowAttempt(socket, action, limit = 5, windowMs = 15 * 60 * 1000) {
    return limitRequest(`${action}:${socket.request.session?.userId || socket.handshake.address || 'unknown'}`, limit, windowMs);
}

data.io = io

app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    try {
        await handleWebhook(req.body, req.get('stripe-signature'));
        res.status(200).json({ received: true });
    } catch (error) {
        const status = error instanceof BillingError ? error.statusCode : 500;
        void serverLogger.error('stripe.webhook.failed', 'Échec du traitement d’un webhook Stripe.', {
            code: error?.code || null,
            message: error?.message || null
        }, { requestId: req.requestId });
        res.status(status).json({ error: 'Webhook Stripe refusé.' });
    }
});

app.post('/api/stripe/checkout', express.json({ limit: '10kb' }), requireApiAuth, requireBillingOrigin, async (req, res) => {
    try {
        const checkout = await createCheckoutSession(req.session.userId, req.body?.offerId);
        res.json(checkout);
    } catch (error) {
        const status = error instanceof BillingError ? error.statusCode : 500;
        void serverLogger.error('stripe.checkout.failed', 'Impossible de créer une session de paiement Stripe.', {
            code: error?.code || null,
            message: error?.message || null
        }, { userId: req.session.userId, requestId: req.requestId });
        res.status(status).json({ error: error instanceof BillingError ? error.message : 'Impossible d’ouvrir le paiement sécurisé pour le moment.' });
    }
});

app.post('/api/stripe/portal', express.json({ limit: '2kb' }), requireApiAuth, requireBillingOrigin, async (req, res) => {
    try {
        const portal = await createPortalSession(req.session.userId);
        res.json(portal);
    } catch (error) {
        const status = error instanceof BillingError ? error.statusCode : 500;
        void serverLogger.error('stripe.portal.failed', 'Impossible d’ouvrir le portail Stripe.', {
            code: error?.code || null,
            message: error?.message || null
        }, { userId: req.session.userId, requestId: req.requestId });
        res.status(status).json({ error: error instanceof BillingError ? error.message : 'Impossible d’ouvrir la gestion de paiement pour le moment.' });
    }
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /connexion/',
        'Disallow: /ins/',
        'Disallow: /dashboard/',
        'Disallow: /admin/',
        'Disallow: /ticket/',
        'Disallow: /parametres/',
        'Disallow: /abonnement-expire/',
        'Disallow: /verif/',
        'Disallow: /conditions-utilisation/',
        'Disallow: /politique-confidentialite/',
        'Disallow: /mentions-legales/',
        `Sitemap: ${publicUrl}/sitemap.xml`
    ].join('\n'));
});

app.get('/sitemap.xml', (req, res) => {
    const indexUpdatedAt = fs.statSync(path.join(__dirname, 'template', 'index.html')).mtime.toISOString().slice(0, 10);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${publicUrl}/</loc>\n    <lastmod>${indexUpdatedAt}</lastmod>\n  </url>\n</urlset>`);
});

// Utilise un chemin absolu : les fichiers publics restent accessibles même si le serveur est lancé depuis un autre dossier.
app.get('/telecharger/glowstock.apk', (req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('application/vnd.android.package-archive');
    res.download(path.join(__dirname, 'downloads', 'GlowStock-1.0.1.apk'), 'GlowStock-1.0.1.apk', (error) => {
        if (error && !res.headersSent) next(error);
    });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/offers', async (req, res, next) => {
    try {
        const offers = await listOffers(true);
        res.json({ offers: offers.map(({ stripePriceId, ...offer }) => offer) });
    } catch (error) {
        void serverLogger.error('offers.public_load_failed', 'Impossible de charger les offres publiques.', { code: error?.code || null }, { requestId: req.requestId });
        res.status(503).json({ offers: [] });
    }
});

function allowCompanyLookup(req, limit = 15, windowMs = 15 * 60 * 1000) {
    return limitRequest(`company:${req.ip}`, limit, windowMs);
}

app.get('/api/company-by-siret', async (req, res) => {
    if (!allowCompanyLookup(req)) return res.status(429).json({ error: 'Trop de recherches. Réessaie dans quelques minutes.' });
    try {
        const company = await lookupCompanyBySiret(req.query?.siret);
        if (!company) return res.status(404).json({ error: 'Aucune entreprise trouvée pour ce SIRET.' });
        res.json({ company });
    } catch (error) {
        if (error instanceof CompanyLookupError && error.code === 'INVALID_SIRET') return res.status(400).json({ error: error.message });
        const status = error instanceof CompanyLookupError && error.code === 'COMPANY_LOOKUP_RATE_LIMITED' ? 429 : 503;
        void serverLogger.warn('company.lookup_failed', 'Recherche d’entreprise impossible.', { code: error?.code || null }, { requestId: req.requestId });
        res.status(status).json({ error: error instanceof CompanyLookupError ? error.message : 'Recherche impossible pour le moment.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'template/index.html'));
});

app.get('/connexion/', requireFeature('login'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/connexion.html'));
});

app.get('/dashboard/', requireAuth, requirePermission('dashboard'), requireSubscription('full'), requireFeature('dashboard'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/dashboard.html'));
});

app.get('/dashboard/inv/', requireAuth, requirePermission('inventory'), requireSubscription('consultation'), requireFeature('inventory'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/inventaire.html'));
});

app.get('/ins/', requireFeature('signup'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/ins.html'));
});

const legalPage = (req, res) => res.sendFile(path.join(__dirname, 'template/legal.html'));
app.get('/conditions-utilisation/', legalPage);
app.get('/politique-confidentialite/', legalPage);
app.get('/mentions-legales/', legalPage);

app.get('/dashboard/add_produit/', requireAuth, requirePermission('manage_products'), requireSubscription('full'), requireFeature('products'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/add_produit.html'));
});

app.get('/dashboard/PAO/', requireAuth, requirePermission('pao'), requireSubscription('consultation'), requireFeature('pao'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/pao.html'));
});

app.get('/dashboard/planning/', requireAuth, requirePermission('dashboard'), requireSubscription('full'), requireFeature('planning'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/planning.html'));
});

app.get('/dashboard/caisse/', requireAuth, caisse.requireCaisseAccess({ hasPermission, getSubscriptionStatus }), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/caisse.html'));
});

app.get('/dashboard/webcam/', requireAuth, requirePermission('inventory'), requireSubscription('full'), requireFeature('scanner'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/test.html'))
})

app.get('/dashboard/scanner/', requireAuth, requirePermission('inventory'), requireSubscription('full'), requireFeature('scanner'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/test.html'))
})

app.get('/admin/', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'template/admin.html'));
});

app.get('/ticket/', requireAuth, requireFeature('tickets'), (req, res) => {
    res.sendFile(path.join(__dirname, 'template/nouveau-ticket.html'));
});

app.get('/parametres/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'template/parametres.html'));
});

app.get('/abonnement-expire/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'template/abonnement-expire.html'));
});

app.get('/verif/', (req, res) => {
    res.sendFile(path.join(__dirname, 'template/verif.html'))
})

app.get('/ins/confirme/', (req, res) => {
    res.sendFile(path.join(__dirname, 'template/confirme.html'))
})

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    void serverLogger.error('http.error', 'Échec de la requête HTTP.', { code: error?.code || null }, { requestId: req.requestId });
    res.status(error?.status === 413 ? 413 : error?.status === 400 ? 400 : 500).json({ error: 'La requête ne peut pas être traitée.' });
});

http.listen(port, '0.0.0.0', () => {
    console.log(`[Serveur][Information] Server allumé en ${useDevHttps ? 'HTTPS' : 'HTTP'} sur le port ${port}`);
    void serverLogger.cleanupExpiredLogs(31);
    void cleanupWebhookEvents();
    const logCleanupTimer = setInterval(() => {
        void serverLogger.cleanupExpiredLogs(31);
        void cleanupWebhookEvents();
    }, 24 * 60 * 60 * 1000);
    logCleanupTimer.unref?.();
    void ensureStripeSchema()
        .then(() => serverLogger.info('stripe.schema.ready', 'Schéma Stripe prêt.'))
        .catch((error) => serverLogger.error('stripe.schema.failed', 'Impossible de préparer le schéma Stripe.', { code: error?.code || null, message: error?.message || null }));
    const millisecondsUntilOneAmParis = () => {
        const parisNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
        const nextRun = new Date(parisNow);
        nextRun.setHours(1, 0, 0, 0);
        if (nextRun <= parisNow) nextRun.setDate(nextRun.getDate() + 1);
        return Math.max(1000, nextRun.getTime() - parisNow.getTime());
    };
    const runSubscriptionRenewalAnalysis = async () => {
        try {
            const result = await analyseDueSubscriptionRenewals();
            void serverLogger.info('subscription.renewal.daily_analysis', 'Analyse quotidienne des renouvellements terminée.', {
                creditRenewals: result.creditRenewals,
                stripeRenewals: result.stripeRenewals.length,
                stripeUserIds: result.stripeRenewals.map((renewal) => renewal.userId),
                manualRenewals: result.manualRenewals.length,
                manualRenewalUserIds: result.manualRenewals.map((renewal) => renewal.userId)
            });
        } catch (error) {
            void serverLogger.error('subscription.renewal.analysis_failed', 'Impossible d’analyser les renouvellements.', { code: error?.code || null, message: error?.message || null });
        }
    };
    const scheduleSubscriptionRenewalAnalysis = () => {
        const renewalTimer = setTimeout(async () => {
            await runSubscriptionRenewalAnalysis();
            scheduleSubscriptionRenewalAnalysis();
        }, millisecondsUntilOneAmParis());
        renewalTimer.unref?.();
    };
    scheduleSubscriptionRenewalAnalysis();
    void serverLogger.info('server.started', `Serveur démarré en ${useDevHttps ? 'HTTPS' : 'HTTP'}.`, {
        protocol: useDevHttps ? 'https' : 'http',
        port,
        node: process.version,
        environment: process.env.NODE_ENV || 'development'
    });
});

io.on('connection', (socket) => {
    socket.use(createSocketGuard(socket, { getPool, sessionStore, allowAttempt }));
    console.log(`[Serveur][Connection] ${socket.id}`);
    const socketOptions = () => ({ userId: socket.request.session?.userId, socketId: socket.id });
    void serverLogger.info('socket.connected', 'Nouvelle connexion Socket.IO.', {
        address: socket.handshake.address,
        transport: socket.conn?.transport?.name
    }, socketOptions());
    socket.onAny((event, ...payload) => {
        void serverLogger.info('socket.event.received', `Événement reçu : ${event}.`, {
            event,
            payload: serverLogger.summarizePayload(payload)
        }, socketOptions());
    });
    const originalSocketEmit = socket.emit.bind(socket);
    socket.emit = (event, ...payload) => {
        void serverLogger.info('socket.event.sent', `Événement envoyé : ${event}.`, {
            event,
            payload: serverLogger.summarizePayload(payload)
        }, socketOptions());
        return originalSocketEmit(event, ...payload);
    };
    const runFeature = async (feature, handler) => {
        try {
            if (!(await isFeatureEnabled(feature))) return socket.emit('feature disabled', feature);
            await handler();
        } catch (error) {
            void serverLogger.error('feature.check_failed', 'Impossible de vérifier l’état d’une fonctionnalité.', { feature, code: error?.code || null }, socketOptions());
            socket.emit('server error', 'Erreur temporaire.');
        }
    };
    const runPublicAuthFeature = async (feature, errorEvent, handler) => {
        try {
            if (!(await isFeatureEnabled(feature))) {
                const message = feature === 'login'
                    ? 'La connexion est temporairement indisponible. Réessaie plus tard.'
                    : 'Les inscriptions sont temporairement indisponibles. Réessaie plus tard.';
                return socket.emit(errorEvent, message);
            }
            await handler();
        } catch (error) {
            void serverLogger.error('feature.check_failed', 'Impossible de vérifier l’état d’une fonctionnalité.', { feature, code: error?.code || null }, socketOptions());
            socket.emit(errorEvent, 'Erreur temporaire.');
        }
    };
    socket.on('disconnect', (reason) => {
        void serverLogger.info('socket.disconnected', 'Connexion Socket.IO fermée.', { reason }, socketOptions());
    });


    socket.on("information user", (token) => {
        void runFeature('dashboard', () => miku.verifUser(socket))
    })

    socket.on('activate stock alerts', () => {
        void runFeature('dashboard', () => miku.activateStockAlerts(socket))
    })

    socket.on('inscription', (new_user) => {
        void runPublicAuthFeature('signup', 'ins error', () => {
            if (!allowAttempt(socket, 'signup', 5)) return socket.emit('ins error', 'Trop de tentatives. Réessayez dans quelques minutes.');
            return miku.addUser(new_user, socket.id);
        });
    })


    socket.on('produit a surveiller', (token) => {
        void runFeature('dashboard', () => miku.needListe(socket))
    })

    socket.on('liste inv', (token) => {
        void runFeature('inventory', () => miku.listeInv(socket))
    })

    socket.on('ajout produit', (produit) => {
        void runFeature('products', () => miku.addProduit(produit, socket))
    })

    socket.on('quick restock', (input) => {
        void runFeature('products', () => miku.quickRestock(input, socket))
    })

    socket.on('import inventory count', (input) => {
        void runFeature('products', () => miku.importInventoryCount(input, socket))
    })

    socket.on('liste marques', () => {
        void runFeature('products', () => miku.listeMarques(socket))
    })

    socket.on('scan barcode', (reference) => {
        void runFeature('scanner', () => miku.scanProduct(reference, socket))
    })

    socket.on('liste pao', () => {
        void runFeature('pao', () => miku.listePAO(socket))
    })

    socket.on('planning data', (request) => {
        void runFeature('planning', () => miku.planningData(request, socket))
    })

    socket.on('save planning hours', (hours) => {
        void runFeature('planning', () => miku.savePlanningHours(hours, socket))
    })

    socket.on('save planning entry', (entry) => {
        void runFeature('planning', () => miku.savePlanningEntry(entry, socket))
    })

    socket.on('delete planning entry', (entry) => {
        void runFeature('planning', () => miku.deletePlanningEntry(entry, socket))
    })

    socket.on('notification data', () => {
        void runFeature('notifications', () => miku.notificationData(socket))
    })

    socket.on('clear notifications', () => {
        void runFeature('notifications', () => miku.clearNotifications(socket))
    })

    socket.on('create notification', (notification) => {
        if (!allowAttempt(socket, 'create_notification', 10)) return socket.emit('admin notification error', 'Trop de notifications créées. Réessaie dans quelques minutes.');
        void runFeature('notifications', () => miku.createNotification(notification, socket))
    })

    socket.on('ajout pao', (pao, done) => {
        void runFeature('pao', () => miku.addPAO(pao, socket, typeof done === 'function' ? done : () => {}))
    })

    socket.on('feature flags', () => {
        miku.featureFlagsData(socket)
    })

    socket.on('update feature flag', (feature) => {
        miku.updateFeatureFlag(feature, socket)
    })

    socket.on('save offer', (offer) => {
        miku.saveOffer(offer, socket)
    })

    socket.on('delete offer', (offerId) => {
        miku.deleteOffer(offerId, socket)
    })

    socket.on('admin data', (filters) => {
        miku.adminData(socket, filters)
    })

    socket.on('ticket data', (request) => {
        void runFeature('tickets', () => miku.ticketData(socket, request))
    })

    socket.on('create ticket', (ticket) => {
        void runFeature('tickets', () => miku.createTicket(ticket, socket))
    })

    socket.on('create ticket reclamation', (reclamation) => {
        void runFeature('tickets', () => miku.createTicketReclamation(reclamation, socket))
    })

    socket.on('decide ticket reclamation', (decision) => {
        void runFeature('tickets', () => miku.decideTicketReclamation(decision, socket))
    })

    socket.on('update ticket', (ticket) => {
        void runFeature('tickets', () => miku.updateTicket(ticket, socket))
    })

    socket.on('update ticket team', (change) => {
        void runFeature('tickets', () => miku.updateTicketTeam(change, socket))
    })

    socket.on('client error', (error) => {
        const clean = (value) => String(value || '').replace(/([?&](?:token|password|secret)=)[^&\s]+/gi, '$1[masqué]').slice(0, 500);
        miku.logError(socket.request.session?.userId || null, 'client', clean(error?.message || 'Erreur navigateur'), {
            page: clean(error?.context?.page), source: clean(error?.context?.source), line: Number(error?.context?.line) || null,
            type: clean(error?.context?.type)
        })
    })

    socket.on('subscription status', () => {
        miku.subscriptionStatus(socket)
    })

    socket.on('settings data', () => {
        miku.settingsData(socket)
    })

    socket.on('update profile', (profile) => {
        miku.updateProfile(profile, socket)
    })

    socket.on('update password', (passwords) => {
        miku.updatePassword(passwords, socket)
    })

    socket.on('cancel subscription', () => {
        miku.cancelSubscription(socket)
    })

    socket.on('update role', (change) => {
        miku.updateRole(change, socket)
    })

    socket.on('admin update subscription', (change) => {
        miku.updateSubscription(change, socket)
    })

    socket.on('delete account', (account) => {
        miku.deleteAccount(account, socket)
    })

    socket.on('create role', (role) => {
        miku.createRole(role, socket)
    })

    socket.on('update role definition', (role) => { miku.updateRoleDefinition(role, socket) })
    socket.on('delete role definition', (slug) => { miku.deleteRoleDefinition(slug, socket) })

    socket.on('logout', () => {
        socket.request.session.destroy((error) => {
            if (error) return socket.emit('server error', 'Déconnexion impossible.');
            socket.emit('logged out');
            socket.disconnect(true);
        });
    })
})
