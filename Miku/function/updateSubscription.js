const { getPool } = require('../db.js');
const { hasPermission } = require('../permissions.js');
const { ensureSchema: ensureNotificationSchema, applyDueSubscriptionCredits } = require('../notificationCenter.js');
const { ensureSchema: ensureStripeSchema, syncStripeCustomerCredit } = require('../stripeBilling.js');
const logError = require('./logError.js');

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (value) => {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

module.exports = async function updateSubscription(input, socket) {
  let connexion;
  const adminId = socket.request.session?.userId;
  const targetId = Number(input?.userId);
  const active = input?.active === true;
  const dateAbo = typeof input?.dateAbo === 'string' ? input.dateAbo : '';
  const rawAmount = input?.amount === '' || input?.amount === null || input?.amount === undefined ? null : Number(input.amount);
  const subscriptionAmount = rawAmount === null ? null : Math.round(rawAmount * 100) / 100;
  const rawCredit = input?.credit === '' || input?.credit === null || input?.credit === undefined ? 0 : Number(input.credit);
  const subscriptionCredit = Math.round(rawCredit * 100) / 100;
  try {
    if (!adminId) return socket.emit('auth error', 'Session expirée.');
    const canManage = await hasPermission(adminId, 'manage_subscriptions') || await hasPermission(adminId, 'manage_accounts');
    if (!canManage) return socket.emit('admin error', 'Tu ne peux pas gérer les abonnements.');
    if (!Number.isInteger(targetId) || targetId <= 0) return socket.emit('admin error', 'Compte invalide.');
    if (active && !isRealDate(dateAbo)) return socket.emit('admin error', 'La date d’expiration est invalide.');
    if (subscriptionAmount !== null && (!Number.isFinite(subscriptionAmount) || subscriptionAmount < 0 || subscriptionAmount > 100000)) return socket.emit('admin error', 'Le montant du prélèvement est invalide.');
    if (!Number.isFinite(subscriptionCredit) || subscriptionCredit < 0 || subscriptionCredit > 100000) return socket.emit('admin error', 'Le solde d’avoir est invalide.');

    await ensureNotificationSchema();
    await ensureStripeSchema();
    connexion = await (await getPool()).getConnection();
    const users = await connexion.query('SELECT id FROM users WHERE id = ? LIMIT 1', [targetId]);
    if (!users.length) return socket.emit('admin error', 'Compte introuvable.');
    try {
      if (active) {
        await connexion.query(
          'UPDATE users SET abo = 1, date_abo = ?, subscription_amount = ?, subscription_credit = ?, abo_cancel_requested_at = NULL WHERE id = ?',
          [dateAbo, subscriptionAmount, subscriptionCredit, targetId]
        );
      } else {
        await connexion.query(
          'UPDATE users SET abo = 0, date_abo = NULL, subscription_amount = NULL, subscription_credit = ?, abo_cancel_requested_at = NULL WHERE id = ?',
          [subscriptionCredit, targetId]
        );
      }
    } catch (updateError) {
      if (updateError?.code !== 'ER_BAD_FIELD_ERROR') throw updateError;
      if (active) await connexion.query('UPDATE users SET abo = 1, date_abo = ?, subscription_amount = ?, subscription_credit = ? WHERE id = ?', [dateAbo, subscriptionAmount, subscriptionCredit, targetId]);
      else await connexion.query('UPDATE users SET abo = 0, date_abo = NULL, subscription_amount = NULL, subscription_credit = ? WHERE id = ?', [subscriptionCredit, targetId]);
    }
    if (active) await applyDueSubscriptionCredits(targetId);
    let stripeWarning = '';
    try {
      const creditSync = await syncStripeCustomerCredit(targetId);
      if (!creditSync.synced && creditSync.reason === 'stripe_not_configured') {
        stripeWarning = 'Le compte a été mis à jour, mais l’avoir ne peut pas être synchronisé dans Stripe tant que les clés Stripe ne sont pas configurées.';
      }
    } catch (stripeError) {
      void logError(adminId, 'stripe_avoir', 'Avoir modifié dans GlowStock mais non synchronisé dans Stripe.', {
        targetId,
        code: stripeError?.code || null,
        message: stripeError?.message || null
      });
      stripeWarning = 'Le compte a été mis à jour, mais l’avoir n’a pas été synchronisé dans Stripe. Vérifie Stripe avant la prochaine échéance.';
    }
    void logError(adminId, 'gestion_abonnement', `Abonnement ${active ? 'activé/modifié' : 'désactivé'} pour le compte ${targetId}.`, {
      targetId,
      active,
      dateAbo: active ? dateAbo : null,
      subscriptionAmount: active ? subscriptionAmount : null,
      subscriptionCredit
    });
    socket.emit('subscription updated', { userId: targetId, warning: stripeWarning || null });
    if (stripeWarning) socket.emit('admin error', stripeWarning);
  } catch (error) {
    void logError(adminId || null, 'gestion_abonnement', error?.message || 'Impossible de modifier l’abonnement.', {
      code: error?.code || null,
      targetId
    });
    socket.emit('admin error', 'Impossible de modifier cet abonnement.');
  } finally {
    if (connexion) connexion.release();
  }
};
