const socket = window.glowstockSocket || (window.glowstockSocket = io());
const message = document.getElementById('message');
const show = (text, error = false) => {
  message.textContent = text;
  message.style.color = error ? '#D97777' : '#798C7E';
};

const subscriptionInfo = document.getElementById('subscription_info');
const subscriptionCard = subscriptionInfo?.closest('.setting-card');
const stripeBilling = document.getElementById('stripe_billing');
const stripeOffers = document.getElementById('stripe_offers');
const stripePortal = document.getElementById('stripe_portal');
const stripeBillingNote = document.getElementById('stripe_billing_note');
const urlParams = new URLSearchParams(window.location.search);
let cancelButton = document.getElementById('cancel_subscription');
let cancelNote = document.getElementById('subscription_cancel_note');
let checkoutStarted = false;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatPrice = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);

// Le bloc est créé ici pour garder la page compatible avec les anciennes versions du template.
if (subscriptionCard && subscriptionInfo && !cancelButton) {
  cancelNote = document.createElement('p');
  cancelNote.className = 'subscription-cancel-note';
  cancelNote.textContent = 'Tu peux annuler ton abonnement à tout moment. Ton accès reste actif jusqu’à la date de fin prévue.';
  cancelButton = document.createElement('button');
  cancelButton.id = 'cancel_subscription';
  cancelButton.type = 'button';
  cancelButton.className = 'cancel-subscription';
  cancelButton.textContent = 'Annuler l’abonnement';
  subscriptionInfo.insertAdjacentElement('afterend', cancelNote);
  cancelNote.insertAdjacentElement('afterend', cancelButton);
}

const formatDate = (value) => String(value || '').slice(0, 10);
const setCancellationState = (scheduled, dateAbo) => {
  if (!cancelButton || !cancelNote) return;
  cancelButton.hidden = !dateAbo;
  cancelButton.disabled = scheduled;
  cancelButton.textContent = scheduled ? 'Annulation programmée' : 'Annuler l’abonnement';
  cancelNote.dataset.state = scheduled ? 'scheduled' : '';
  cancelNote.textContent = scheduled
    ? `Ton abonnement restera actif jusqu’au ${formatDate(dateAbo)}, puis ne sera pas renouvelé.`
    : 'Tu peux annuler ton abonnement à tout moment. Ton accès reste actif jusqu’à la date de fin prévue.';
};

async function startStripeCheckout(offerId) {
  if (checkoutStarted) return;
  checkoutStarted = true;
  if (stripeBillingNote) stripeBillingNote.textContent = 'Ouverture du paiement sécurisé…';
  try {
    const response = await fetch('/api/stripe/checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(data.error || 'Impossible d’ouvrir le paiement sécurisé.');
    window.location.assign(data.url);
  } catch (error) {
    checkoutStarted = false;
    if (stripeBillingNote) stripeBillingNote.textContent = error.message || 'Impossible d’ouvrir le paiement sécurisé.';
    show(error.message || 'Impossible d’ouvrir le paiement sécurisé.', true);
  }
}

async function openStripePortal() {
  if (stripePortal) stripePortal.disabled = true;
  try {
    const response = await fetch('/api/stripe/portal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(data.error || 'Impossible d’ouvrir la gestion de paiement.');
    window.location.assign(data.url);
  } catch (error) {
    if (stripePortal) stripePortal.disabled = false;
    show(error.message || 'Impossible d’ouvrir la gestion de paiement.', true);
  }
}

function renderBilling(billing = {}) {
  if (!stripeBilling || !stripeOffers || !stripeBillingNote) return;
  stripeBilling.hidden = false;
  const offers = Array.isArray(billing.offers) ? billing.offers.filter((offer) => offer.stripeReady) : [];
  const requestedOffer = Number(urlParams.get('checkout_offer'));
  const selectedOffer = Number.isInteger(requestedOffer) && requestedOffer > 0
    ? String(requestedOffer)
    : (billing.pendingOfferId || '');

  stripeOffers.innerHTML = '';
  if (!billing.configured) {
    stripeBillingNote.textContent = 'Le paiement sécurisé sera disponible très prochainement.';
    return;
  }
  if (!billing.checkoutReady) {
    stripeBillingNote.textContent = 'Le paiement est temporairement indisponible. Réessaie plus tard.';
    return;
  }

  if (billing.hasSubscription) {
    stripeBillingNote.textContent = 'Ton abonnement est géré de façon sécurisée par Stripe.';
    if (stripePortal) stripePortal.hidden = !billing.hasCustomer;
    return;
  }

  if (!offers.length) {
    stripeBillingNote.textContent = 'Aucune offre n’est prête pour le paiement en ligne pour le moment.';
    return;
  }

  stripeBillingNote.textContent = 'Choisis l’offre qui te convient. Tu seras redirigée vers le paiement sécurisé Stripe.';
  stripeOffers.innerHTML = offers.map((offer) => `<article class="billing-offer"><strong>${escapeHtml(offer.name)}</strong><span>${formatPrice(offer.price)} ${escapeHtml(offer.billingPeriod || '')}</span><button type="button" data-offer-id="${escapeHtml(offer.id)}">Choisir cette offre</button></article>`).join('');
  stripeOffers.querySelectorAll('button[data-offer-id]').forEach((button) => button.addEventListener('click', () => startStripeCheckout(button.dataset.offerId)));

  const automaticOffer = offers.find((offer) => String(offer.id) === selectedOffer);
  if (automaticOffer && urlParams.has('checkout_offer')) {
    window.history.replaceState({}, '', '/parametres/');
    void startStripeCheckout(automaticOffer.id);
  }
}

if (urlParams.get('stripe') === 'success') show('Paiement validé. Ton abonnement sera confirmé dès la validation sécurisée par Stripe.');
if (urlParams.get('stripe') === 'cancelled') show('Le paiement a été annulé. Aucun prélèvement n’a été effectué.', true);

socket.emit('settings data');
socket.on('settings data response', ({ user, subscription, billing }) => {
  document.getElementById('nom').value = user.nom || '';
  document.getElementById('email').value = user.email || '';
  const details = subscription.level === 'full'
    ? 'Abonnement actif.'
    : `Abonnement ${subscription.level === 'limited' ? 'en période de grâce' : 'expiré'}.`;
  document.getElementById('subscription_info').textContent = details + (user.date_abo ? ` Fin prévue : ${formatDate(user.date_abo)}.` : '');
  setCancellationState(Boolean(user.abo_cancel_requested_at), user.date_abo);
  renderBilling(billing);
});

document.getElementById('profile_form').addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('update profile', { nom: document.getElementById('nom').value });
});
document.getElementById('password_form').addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('update password', {
    current: document.getElementById('current_password').value,
    next: document.getElementById('new_password').value
  });
});
cancelButton?.addEventListener('click', () => {
  if (cancelButton.disabled) return;
  const dateAbo = document.getElementById('subscription_info')?.textContent.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
  if (!window.confirm(`Confirmer l’annulation ? Ton accès restera actif jusqu’au ${dateAbo || 'la fin de la période en cours'}.`)) return;
  cancelButton.disabled = true;
  socket.emit('cancel subscription');
});
stripePortal?.addEventListener('click', openStripePortal);
document.getElementById('logout').addEventListener('click', () => socket.emit('logout'));

socket.on('profile updated', () => show('Profil mis à jour.'));
socket.on('password updated', () => {
  document.getElementById('password_form').reset();
  show('Mot de passe modifié.');
});
socket.on('subscription cancellation requested', ({ dateAbo }) => {
  setCancellationState(true, dateAbo);
  show('Ton abonnement sera annulé à la fin de la période en cours.');
});
socket.on('logged out', () => window.location.assign('/connexion/'));
socket.on('settings error', (error) => {
  if (cancelButton && cancelButton.disabled && cancelButton.textContent === 'Annuler l’abonnement') cancelButton.disabled = false;
  show(error, true);
});
socket.on('auth error', () => window.location.assign('/connexion/'));
