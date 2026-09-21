const Stripe = require('stripe');
const { getPool } = require('./db.js');
const { ensureSchema: ensureOffersSchema, listOffers } = require('./marketingOffers.js');
const serverLogger = require('./serverLogger.js');

let schemaPromise = null;
let stripeClient = null;

class BillingError extends Error {
    constructor(message, code = 'stripe_error', statusCode = 400) {
        super(message);
        this.name = 'BillingError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

const cleanId = (value) => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
    return '';
};

const asUserId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const centsToEuros = (value) => Math.max(0, Math.round(Number(value) || 0)) / 100;
const toDate = (unixTime) => {
    const time = Number(unixTime);
    if (!Number.isFinite(time) || time <= 0) return null;
    return new Date(time * 1000).toISOString().slice(0, 10);
};

function getPublicUrl() {
    const value = String(process.env.PUBLIC_URL || process.env.APP_URL || '').trim();
    if (!value) return null;
    try {
        const parsed = new URL(value);
        return ['https:', 'http:'].includes(parsed.protocol) ? parsed.origin : null;
    } catch (_) {
        return null;
    }
}

function getSecretKey() {
    const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
    return /^sk_(?:test|live)_[A-Za-z0-9]+$/.test(key) ? key : null;
}

function getWebhookSecret() {
    const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    return /^whsec_[A-Za-z0-9]+$/.test(secret) ? secret : null;
}

function isStripeConfigured() {
    return Boolean(getSecretKey());
}

function getStripe() {
    const key = getSecretKey();
    if (!key) throw new BillingError('Stripe n’est pas encore configuré.', 'stripe_not_configured', 503);
    if (!stripeClient) stripeClient = new Stripe(key);
    return stripeClient;
}

function getCheckoutConfig() {
    const publicUrl = getPublicUrl();
    if (!publicUrl) throw new BillingError('PUBLIC_URL doit contenir l’adresse publique HTTPS de GlowStock.', 'stripe_public_url_missing', 503);
    return { stripe: getStripe(), publicUrl };
}

function getBillingStatus() {
    return {
        configured: isStripeConfigured(),
        checkoutReady: Boolean(isStripeConfigured() && getPublicUrl()),
        webhookReady: Boolean(isStripeConfigured() && getWebhookSecret())
    };
}

async function ensureSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
        let connexion;
        try {
            await ensureOffersSchema();
            connexion = await (await getPool()).getConnection();
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_amount DECIMAL(10,2) NULL AFTER date_abo');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_credit DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subscription_amount');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_offer_id BIGINT UNSIGNED NULL AFTER subscription_credit');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) NULL AFTER pending_offer_id');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255) NULL AFTER stripe_customer_id');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_status VARCHAR(50) NULL AFTER stripe_subscription_id');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255) NULL AFTER stripe_subscription_status');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_current_period_end DATETIME NULL AFTER stripe_price_id');
            await connexion.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_synced_credit DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER stripe_current_period_end');
            await connexion.query(`
                CREATE TABLE IF NOT EXISTS stripe_webhook_events (
                    event_id VARCHAR(255) NOT NULL,
                    event_type VARCHAR(100) NOT NULL,
                    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (event_id),
                    KEY idx_stripe_webhook_events_received (received_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
            `);
        } catch (error) {
            schemaPromise = null;
            throw error;
        } finally {
            if (connexion) connexion.release();
        }
    })();
    return schemaPromise;
}

async function listCheckoutOffers() {
    const offers = await listOffers(true);
    return offers.map((offer) => ({
        id: offer.id,
        name: offer.name,
        description: offer.description,
        price: offer.price,
        billingPeriod: offer.billingPeriod,
        stripeReady: Boolean(offer.stripePriceId)
    }));
}

async function findUser(connexion, { userId = null, customerId = '', subscriptionId = '' } = {}) {
    const normalizedUserId = asUserId(userId);
    if (normalizedUserId) {
        const users = await connexion.query('SELECT * FROM users WHERE id = ? LIMIT 1', [normalizedUserId]);
        return users[0] || null;
    }
    const conditions = [];
    const params = [];
    if (customerId) { conditions.push('stripe_customer_id = ?'); params.push(customerId); }
    if (subscriptionId) { conditions.push('stripe_subscription_id = ?'); params.push(subscriptionId); }
    if (!conditions.length) return null;
    const users = await connexion.query(`SELECT * FROM users WHERE ${conditions.join(' OR ')} LIMIT 1`, params);
    return users[0] || null;
}

function getSubscriptionPeriodEnd(subscription) {
    return subscription?.current_period_end || subscription?.items?.data?.[0]?.current_period_end || null;
}

function getSubscriptionPriceId(subscription) {
    return cleanId(subscription?.items?.data?.[0]?.price) || cleanId(subscription?.plan) || '';
}

function getSubscriptionAmount(subscription) {
    const price = subscription?.items?.data?.[0]?.price || subscription?.plan || null;
    const amount = Number(price?.unit_amount_decimal ?? price?.unit_amount);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) / 100 : null;
}

async function validateStripePrice(stripe, offer) {
    const price = await stripe.prices.retrieve(offer.stripePriceId);
    const expectedAmount = Math.round(Number(offer.price) * 100);
    const actualAmount = Math.round(Number(price?.unit_amount_decimal ?? price?.unit_amount));
    if (!price?.active || price.currency !== 'eur' || price.recurring?.interval !== 'month' || actualAmount !== expectedAmount) {
        throw new BillingError('Le prix Stripe de cette offre doit être actif, mensuel, en euros et identique au prix affiché.', 'stripe_price_mismatch', 503);
    }
}

async function createCheckoutSession(userId, requestedOfferId) {
    const normalizedUserId = asUserId(userId);
    const offerId = asUserId(requestedOfferId);
    if (!normalizedUserId || !offerId) throw new BillingError('Choisis une offre valide.', 'invalid_offer');
    await ensureSchema();
    const { stripe, publicUrl } = getCheckoutConfig();
    const offers = await listOffers(true);
    const offer = offers.find((item) => String(item.id) === String(offerId));
    if (!offer) throw new BillingError('Cette offre n’est plus disponible.', 'offer_unavailable', 404);
    if (!offer.stripePriceId) throw new BillingError('Cette offre n’est pas encore reliée à un prix Stripe.', 'stripe_price_missing', 503);
    await validateStripePrice(stripe, offer);

    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        const user = await findUser(connexion, { userId: normalizedUserId });
        if (!user) throw new BillingError('Compte introuvable.', 'user_not_found', 404);
        const params = {
            mode: 'subscription',
            line_items: [{ price: offer.stripePriceId, quantity: 1 }],
            allow_promotion_codes: true,
            client_reference_id: String(normalizedUserId),
            metadata: { glowstock_user_id: String(normalizedUserId), glowstock_offer_id: String(offer.id) },
            subscription_data: {
                metadata: { glowstock_user_id: String(normalizedUserId), glowstock_offer_id: String(offer.id) }
            },
            success_url: `${publicUrl}/parametres/?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${publicUrl}/parametres/?stripe=cancelled`
        };
        if (user.stripe_customer_id) params.customer = user.stripe_customer_id;
        else params.customer_email = user.email;
        const checkout = await stripe.checkout.sessions.create(params);
        if (!checkout?.url) throw new BillingError('Stripe n’a pas retourné de lien de paiement.', 'stripe_checkout_url_missing', 502);
        return { url: checkout.url };
    } finally {
        if (connexion) connexion.release();
    }
}

async function createPortalSession(userId) {
    const normalizedUserId = asUserId(userId);
    if (!normalizedUserId) throw new BillingError('Session invalide.', 'user_not_found', 401);
    await ensureSchema();
    const { stripe, publicUrl } = getCheckoutConfig();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        const user = await findUser(connexion, { userId: normalizedUserId });
        if (!user?.stripe_customer_id) throw new BillingError('Aucun compte Stripe n’est associé à cet abonnement.', 'stripe_customer_missing', 404);
        const portal = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${publicUrl}/parametres/` });
        if (!portal?.url) throw new BillingError('Stripe n’a pas retourné le portail client.', 'stripe_portal_url_missing', 502);
        return { url: portal.url };
    } finally {
        if (connexion) connexion.release();
    }
}

async function requestSubscriptionCancellation(userId) {
    const normalizedUserId = asUserId(userId);
    if (!normalizedUserId) throw new BillingError('Session invalide.', 'user_not_found', 401);
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        const user = await findUser(connexion, { userId: normalizedUserId });
        if (!user?.stripe_subscription_id) return { managedByStripe: false };
        const stripe = getStripe();
        const subscription = await stripe.subscriptions.update(user.stripe_subscription_id, { cancel_at_period_end: true });
        return { managedByStripe: true, dateAbo: toDate(getSubscriptionPeriodEnd(subscription)) };
    } finally {
        if (connexion) connexion.release();
    }
}

async function syncStripeCustomerCredit(userId, existingConnexion = null) {
    const normalizedUserId = asUserId(userId);
    if (!normalizedUserId) return { synced: false, reason: 'invalid_user' };
    await ensureSchema();
    let connexion = existingConnexion;
    const ownsConnection = !connexion;
    try {
        if (!connexion) connexion = await (await getPool()).getConnection();
        const user = await findUser(connexion, { userId: normalizedUserId });
        if (!user?.stripe_customer_id) return { synced: false, reason: 'customer_missing' };
        if (!isStripeConfigured()) return { synced: false, reason: 'stripe_not_configured' };
        const desiredCredit = money(user.subscription_credit);
        const alreadySynced = money(user.stripe_synced_credit);
        const deltaCents = Math.round((desiredCredit - alreadySynced) * 100);
        if (!deltaCents) return { synced: true, amount: desiredCredit };
        const stripe = getStripe();
        await stripe.customers.createBalanceTransaction(user.stripe_customer_id, {
            amount: -deltaCents,
            currency: 'eur',
            description: 'Avoir GlowStock appliqué aux prochaines factures'
        }, { idempotencyKey: `glowstock-credit-${normalizedUserId}-${Math.round(alreadySynced * 100)}-${Math.round(desiredCredit * 100)}` });
        const result = await connexion.query(
            'UPDATE users SET stripe_synced_credit = ? WHERE id = ? AND stripe_customer_id = ? AND stripe_synced_credit = ?',
            [desiredCredit, normalizedUserId, user.stripe_customer_id, user.stripe_synced_credit]
        );
        if (!result.affectedRows) throw new BillingError('La synchronisation de l’avoir Stripe doit être relancée.', 'stripe_credit_conflict', 409);
        return { synced: true, amount: desiredCredit };
    } finally {
        if (ownsConnection && connexion) connexion.release();
    }
}

async function syncCheckoutCompleted(connexion, session) {
    const userId = asUserId(session?.metadata?.glowstock_user_id || session?.client_reference_id);
    if (!userId) return;
    const customerId = cleanId(session.customer);
    const subscriptionId = cleanId(session.subscription);
    const offerId = asUserId(session?.metadata?.glowstock_offer_id);
    await connexion.query(
        `UPDATE users SET stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id),
         stripe_subscription_id = COALESCE(NULLIF(?, ''), stripe_subscription_id),
         pending_offer_id = CASE WHEN ? IS NULL THEN pending_offer_id ELSE ? END
         WHERE id = ?`,
        [customerId, subscriptionId, offerId, offerId, userId]
    );
    if (customerId) await syncStripeCustomerCredit(userId, connexion);
}

async function syncInvoicePaid(connexion, invoice) {
    const stripe = getStripe();
    const subscriptionId = cleanId(invoice.subscription) || cleanId(invoice?.parent?.subscription_details?.subscription);
    let subscription = null;
    if (subscriptionId) subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription?.metadata?.glowstock_user_id || invoice?.metadata?.glowstock_user_id;
    const customerId = cleanId(invoice.customer) || cleanId(subscription?.customer);
    const user = await findUser(connexion, { userId, customerId, subscriptionId });
    if (!user) return;
    const periodEnd = toDate(getSubscriptionPeriodEnd(subscription));
    if (!periodEnd) throw new BillingError('Stripe n’a pas fourni la fin de période de cet abonnement.', 'stripe_period_end_missing', 502);
    const currentCreditCents = Math.round(Math.max(0, Number(user.subscription_credit) || 0) * 100);
    const syncedCreditCents = Math.round(Math.max(0, Number(user.stripe_synced_credit) || 0) * 100);
    const startCredit = Math.max(0, -Number(invoice.starting_balance || 0));
    const endCredit = Math.max(0, -Number(invoice.ending_balance || 0));
    const creditUsed = Math.max(0, startCredit - endCredit);
    const nextCredit = centsToEuros(Math.max(0, currentCreditCents - creditUsed));
    const nextSyncedCredit = centsToEuros(Math.max(0, syncedCreditCents - creditUsed));
    await connexion.query(
        `UPDATE users SET abo = 1, date_abo = ?, subscription_amount = ?, subscription_credit = ?,
         stripe_synced_credit = ?, stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id),
         stripe_subscription_id = COALESCE(NULLIF(?, ''), stripe_subscription_id), stripe_subscription_status = ?,
         stripe_price_id = ?, stripe_current_period_end = ?, pending_offer_id = NULL, abo_cancel_requested_at = NULL
         WHERE id = ?`,
        [periodEnd, getSubscriptionAmount(subscription), nextCredit, nextSyncedCredit, customerId, subscriptionId, subscription?.status || 'active', getSubscriptionPriceId(subscription) || null, `${periodEnd} 00:00:00`, user.id]
    );
}

async function syncSubscriptionUpdate(connexion, subscription, deleted = false) {
    const subscriptionId = cleanId(subscription);
    const customerId = cleanId(subscription?.customer);
    const user = await findUser(connexion, { userId: subscription?.metadata?.glowstock_user_id, customerId, subscriptionId });
    if (!user) return;
    const status = deleted ? 'canceled' : String(subscription.status || 'unknown');
    const periodEnd = toDate(getSubscriptionPeriodEnd(subscription));
    const endsAccess = deleted || ['canceled', 'unpaid', 'incomplete_expired'].includes(status);
    await connexion.query(
        `UPDATE users SET abo = ?, date_abo = ?, stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id),
         stripe_subscription_id = COALESCE(NULLIF(?, ''), stripe_subscription_id), stripe_subscription_status = ?,
         stripe_price_id = ?, stripe_current_period_end = ?, abo_cancel_requested_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = ?`,
        [endsAccess ? 0 : 1, endsAccess ? null : periodEnd, customerId, subscriptionId, status, getSubscriptionPriceId(subscription) || null, periodEnd ? `${periodEnd} 00:00:00` : null, !endsAccess && subscription?.cancel_at_period_end ? 1 : 0, user.id]
    );
}

async function syncInvoiceFailed(connexion, invoice) {
    const subscriptionId = cleanId(invoice.subscription) || cleanId(invoice?.parent?.subscription_details?.subscription);
    const customerId = cleanId(invoice.customer);
    const user = await findUser(connexion, { customerId, subscriptionId });
    if (!user) return;
    await connexion.query(
        `UPDATE users SET stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id),
         stripe_subscription_id = COALESCE(NULLIF(?, ''), stripe_subscription_id), stripe_subscription_status = 'past_due'
         WHERE id = ?`,
        [customerId, subscriptionId, user.id]
    );
}

async function processWebhookEvent(event) {
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        await connexion.beginTransaction();
        const registered = await connexion.query('INSERT IGNORE INTO stripe_webhook_events (event_id, event_type) VALUES (?, ?)', [event.id, event.type]);
        if (!registered.affectedRows) {
            await connexion.rollback();
            return { duplicate: true };
        }
        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    await syncCheckoutCompleted(connexion, event.data.object);
                    break;
                case 'invoice.paid':
                    await syncInvoicePaid(connexion, event.data.object);
                    break;
                case 'invoice.payment_failed':
                    await syncInvoiceFailed(connexion, event.data.object);
                    break;
                case 'customer.subscription.updated':
                    await syncSubscriptionUpdate(connexion, event.data.object);
                    break;
                case 'customer.subscription.deleted':
                    await syncSubscriptionUpdate(connexion, event.data.object, true);
                    break;
                default:
                    break;
            }
        } catch (error) {
            throw error;
        }
        await connexion.commit();
        return { duplicate: false };
    } catch (error) {
        if (connexion) await connexion.rollback().catch(() => {});
        throw error;
    } finally {
        if (connexion) connexion.release();
    }
}

async function handleWebhook(rawBody, signature) {
    const webhookSecret = getWebhookSecret();
    if (!webhookSecret) throw new BillingError('STRIPE_WEBHOOK_SECRET est manquant.', 'stripe_webhook_not_configured', 503);
    if (!signature) throw new BillingError('Signature Stripe manquante.', 'stripe_signature_missing', 400);
    let event;
    try {
        event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (_) {
        throw new BillingError('Signature Stripe invalide.', 'stripe_signature_invalid', 400);
    }
    const result = await processWebhookEvent(event);
    void serverLogger.info('stripe.webhook.processed', `Webhook Stripe traité : ${event.type}.`, { eventId: event.id, eventType: event.type, duplicate: result.duplicate });
    return result;
}

async function cleanupWebhookEvents(retentionDays = 90) {
    const days = Math.max(1, Math.min(3650, Number(retentionDays) || 90));
    const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 19).replace('T', ' ');
    await ensureSchema();
    let connexion;
    try {
        connexion = await (await getPool()).getConnection();
        await connexion.query('DELETE FROM stripe_webhook_events WHERE received_at < ?', [cutoff]);
    } finally {
        if (connexion) connexion.release();
    }
}

module.exports = {
    BillingError,
    ensureSchema,
    getBillingStatus,
    listCheckoutOffers,
    createCheckoutSession,
    createPortalSession,
    requestSubscriptionCancellation,
    syncStripeCustomerCredit,
    handleWebhook,
    cleanupWebhookEvents
};
