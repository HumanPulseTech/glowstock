const socket = window.glowstockSocket || (window.glowstockSocket = io());

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); } catch (_) { return '—'; }
};
const contextPreview = (value) => escapeHtml(String(value || '—').slice(0, 180));
const parsePermissions = (value) => {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch (_) { return []; }
};
const render = (id, rows, empty) => {
  const target = document.getElementById(id);
  if (target) target.innerHTML = rows.length ? rows.join('') : `<tr><td class="empty" colspan="8">${empty}</td></tr>`;
};
const formatPrice = (value) => new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR'
}).format(Number(value) || 0);

function ensureStripePriceInput() {
  let input = document.getElementById('offer_stripe_price_id');
  if (input) return input;
  const ctaInput = document.getElementById('offer_cta_label');
  const ctaLabel = ctaInput?.closest('label');
  if (!ctaLabel) return null;
  const label = document.createElement('label');
  label.textContent = 'Prix Stripe (ID)';
  input = document.createElement('input');
  input.id = 'offer_stripe_price_id';
  input.maxLength = 255;
  input.placeholder = 'price_…';
  label.appendChild(input);
  ctaLabel.insertAdjacentElement('beforebegin', label);
  return input;
}

ensureStripePriceInput();

function resetOfferForm() {
  const form = document.getElementById('offer_form');
  if (!form) return;
  form.reset();
  document.getElementById('offer_id').value = '';
  document.getElementById('offer_active').checked = true;
  document.getElementById('offer_billing_period').value = '/ mois';
  document.getElementById('offer_sort_order').value = '0';
  document.getElementById('offer_stripe_price_id').value = '';
  document.getElementById('offer_cta_label').value = 'Commencer l’essai de 14 jours';
  document.querySelectorAll('input[name="offer_access"]').forEach((input) => { input.checked = false; });
  document.getElementById('offer_submit').textContent = 'Ajouter l’offre';
  document.getElementById('offer_submit').disabled = false;
  document.getElementById('offer_cancel').hidden = true;
  document.getElementById('offer_message').textContent = '';
}

function showOfferForm(offer) {
  document.getElementById('offer_id').value = offer.id;
  document.getElementById('offer_name').value = offer.name || '';
  document.getElementById('offer_active').checked = Boolean(offer.active);
  document.getElementById('offer_description').value = offer.description || '';
  document.getElementById('offer_price').value = offer.price ?? '';
  document.getElementById('offer_original_price').value = offer.originalPrice ?? '';
  document.getElementById('offer_discount_label').value = offer.discountLabel || '';
  document.getElementById('offer_billing_period').value = offer.billingPeriod || '/ mois';
  document.getElementById('offer_sort_order').value = offer.sortOrder ?? 0;
  document.getElementById('offer_stripe_price_id').value = offer.stripePriceId || '';
  document.getElementById('offer_cta_label').value = offer.ctaLabel || 'Commencer l’essai de 14 jours';
  document.getElementById('offer_features').value = Array.isArray(offer.features) ? offer.features.join('\n') : '';
  const includedAccess = Array.isArray(offer.includedAccess) ? offer.includedAccess : [];
  document.querySelectorAll('input[name="offer_access"]').forEach((input) => { input.checked = includedAccess.includes(input.value); });
  document.getElementById('offer_submit').textContent = 'Enregistrer l’offre';
  document.getElementById('offer_cancel').hidden = false;
  document.getElementById('offer_message').textContent = '';
  document.getElementById('offers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncNotificationAudience() {
  const audience = document.getElementById('notification_audience');
  const recipientField = document.getElementById('notification_recipient_field');
  const recipient = document.getElementById('notification_recipient');
  if (!audience || !recipientField || !recipient) return;
  const isPersonal = audience.value === 'user';
  recipientField.hidden = !isPersonal;
  recipient.disabled = !isPersonal;
}

document.getElementById('notification_audience')?.addEventListener('change', syncNotificationAudience);

function requestAdminData() {
  socket.emit('admin data', {
    from: document.getElementById('server_logs_from')?.value || '',
    to: document.getElementById('server_logs_to')?.value || ''
  });
}

document.querySelectorAll('.admin-tabs .admin-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.admin-tabs .admin-tab, .admin-panel').forEach((element) => element.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById(tab.dataset.tab)?.classList.add('active');
}));

document.getElementById('server_logs_filter')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const from = document.getElementById('server_logs_from').value;
  const to = document.getElementById('server_logs_to').value;
  if (from && to && from > to) return alert('La date de début doit précéder la date de fin.');
  requestAdminData();
});
document.getElementById('server_logs_reset')?.addEventListener('click', () => {
  document.getElementById('server_logs_from').value = '';
  document.getElementById('server_logs_to').value = '';
  requestAdminData();
});

socket.on('admin data response', (data) => {
  const referenceCount = document.getElementById('admin_reference_count');
  if (referenceCount) referenceCount.textContent = String(data.summary?.referenceCount ?? '—');
  render('admin_articles', data.articles.map((item) => `<tr><td>${escapeHtml(item.nom)}</td><td>${escapeHtml(item.ref_fournisseur)}</td><td>${escapeHtml(item.code_barres || '—')}</td><td>${escapeHtml(item.marque || '—')}</td><td>${escapeHtml(item.quantite)} / seuil ${escapeHtml(item.seuil_alerte)}</td><td>${escapeHtml(item.compte)}</td></tr>`), 'Aucun article.');

  const notificationRecipient = document.getElementById('notification_recipient');
  if (notificationRecipient) {
    const previousRecipient = notificationRecipient.value;
    notificationRecipient.innerHTML = data.comptes.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nom || item.email)} — ${escapeHtml(item.email)}</option>`).join('');
    if ([...notificationRecipient.options].some((option) => option.value === previousRecipient)) notificationRecipient.value = previousRecipient;
    syncNotificationAudience();
  }

  const featureRows = (data.featureDefinitions || []).map((feature) => {
    const enabled = data.featureFlags?.[feature.key] !== false;
    return `<tr><td><strong>${escapeHtml(feature.label)}</strong></td><td>${escapeHtml(feature.description)}</td><td><label class="feature-switch"><input class="feature-toggle" type="checkbox" data-feature-key="${escapeHtml(feature.key)}" ${enabled ? 'checked' : ''}><span>${enabled ? 'Active' : 'Désactivée'}</span></label></td></tr>`;
  });
  render('admin_features', featureRows, 'Aucune fonctionnalité configurée.');
  document.querySelectorAll('.feature-toggle').forEach((input) => input.addEventListener('change', () => {
    input.disabled = true;
    socket.emit('update feature flag', { key: input.dataset.featureKey, enabled: input.checked });
  }));

  const offers = Array.isArray(data.offers) ? data.offers : [];
  const offerRows = offers.map((offer) => {
    const originalPrice = Number(offer.originalPrice);
    const hasReduction = Number.isFinite(originalPrice) && originalPrice > Number(offer.price);
    const calculatedReduction = hasReduction ? `-${Math.round((1 - (Number(offer.price) / originalPrice)) * 100)} %` : '—';
    const reduction = offer.discountLabel || calculatedReduction;
    const features = Array.isArray(offer.features) && offer.features.length
      ? offer.features.map((feature) => escapeHtml(feature)).join('<br>')
      : '—';
    const includedAccess = Array.isArray(offer.includedAccess) ? offer.includedAccess : [];
    const accessLabels = (data.featureDefinitions || [])
      .filter((feature) => includedAccess.includes(feature.key))
      .map((feature) => escapeHtml(feature.label));
    const access = accessLabels.length ? `<br><small><strong>Accès :</strong> ${accessLabels.join(', ')}</small>` : '';
    const stripeState = offer.stripePriceId ? '<br><small>Stripe relié</small>' : '<br><small>Stripe non relié</small>';
    const price = `${formatPrice(offer.price)}${hasReduction ? ` <small><s>${formatPrice(originalPrice)}</s></small>` : ''}${stripeState}`;
    return `<tr><td><strong>${escapeHtml(offer.name)}</strong><br><small>${escapeHtml(offer.description || '—')}</small></td><td>${price}<br><small>${escapeHtml(offer.billingPeriod || '')}</small></td><td>${escapeHtml(reduction)}</td><td>${features}${access}</td><td>${offer.active ? 'Visible' : 'Masquée'}</td><td><button type="button" class="edit-offer admin-action" data-offer-id="${escapeHtml(offer.id)}">Modifier</button> <button type="button" class="delete-offer admin-action danger" data-offer-id="${escapeHtml(offer.id)}">Supprimer</button></td></tr>`;
  });
  render('admin_offers', offerRows, 'Aucune offre créée.');
  document.querySelectorAll('.edit-offer').forEach((button) => button.addEventListener('click', () => {
    const offer = offers.find((item) => String(item.id) === button.dataset.offerId);
    if (offer) showOfferForm(offer);
  }));
  document.querySelectorAll('.delete-offer').forEach((button) => button.addEventListener('click', () => {
    if (confirm('Supprimer cette offre ? Cette action est irréversible.')) socket.emit('delete offer', button.dataset.offerId);
  }));

  render('admin_comptes', data.comptes.map((item) => {
    const roleOptions = data.roles.map((role) => `<option value="${escapeHtml(role.slug)}"${role.slug === item.role ? ' selected' : ''}>${escapeHtml(role.nom)}</option>`).join('');
    const teamOptions = [{ slug: '', nom: 'Aucune' }, ...(data.ticketTeams || [])].map((team) => `<option value="${escapeHtml(team.slug)}"${team.slug === (item.ticket_team || '') ? ' selected' : ''}>${escapeHtml(team.nom)}</option>`).join('');
    const isCurrent = Number(item.id) === Number(data.currentUserId);
    return `<tr><td>${escapeHtml(item.nom || '—')}</td><td>${escapeHtml(item.email)}</td><td><select class="account-role-select role-select" data-user-id="${escapeHtml(item.id)}" ${isCurrent ? 'disabled title="Tu ne peux pas modifier ton propre rôle."' : ''}>${roleOptions}</select></td><td><select class="ticket-team-select role-select" data-user-id="${escapeHtml(item.id)}" ${isCurrent ? 'disabled title="Tu ne peux pas modifier ta propre équipe."' : ''}>${teamOptions}</select></td><td>${item.email_verified ? 'Oui' : 'Non'}</td><td>${formatDate(item.created_at)}</td><td><button type="button" class="admin-action danger delete-account" data-user-id="${escapeHtml(item.id)}" ${isCurrent ? 'disabled title="Tu ne peux pas supprimer ton propre compte."' : ''}>Supprimer</button></td></tr>`;
  }), 'Aucun compte.');
  document.querySelectorAll('.account-role-select').forEach((select) => select.addEventListener('change', () => socket.emit('update role', { userId: select.dataset.userId, role: select.value })));
  document.querySelectorAll('.ticket-team-select').forEach((select) => select.addEventListener('change', () => socket.emit('update ticket team', { userId: select.dataset.userId, team: select.value })));
  document.querySelectorAll('.delete-account').forEach((button) => button.addEventListener('click', () => {
    if (button.disabled || !confirm('Supprimer ce compte et toutes ses données ? Cette action est irréversible.')) return;
    button.disabled = true;
    socket.emit('delete account', { userId: button.dataset.userId });
  }));

  const roleRows = data.roles.map((role) => {
    const permissions = parsePermissions(role.permissions);
    return `<tr><td>${escapeHtml(role.nom)}</td><td>${escapeHtml(permissions.join(', '))}</td><td><button type="button" class="edit-role admin-action" data-slug="${escapeHtml(role.slug)}">Gérer</button>${['admin', 'user', 'sabo'].includes(role.slug) ? '' : `<button type="button" class="delete-role admin-action danger" data-slug="${escapeHtml(role.slug)}">Supprimer</button>`}</td></tr>`;
  });
  render('admin_roles', roleRows, 'Aucun rôle.');
  document.querySelectorAll('.edit-role').forEach((button) => button.addEventListener('click', () => {
    const role = data.roles.find((item) => item.slug === button.dataset.slug);
    if (!role) return;
    const permissions = parsePermissions(role.permissions);
    document.getElementById('role_slug').value = role.slug;
    document.getElementById('role_nom').value = role.nom;
    document.getElementById('role_title').textContent = `Modifier : ${role.nom}`;
    document.getElementById('role_submit').textContent = 'Enregistrer le rôle';
    document.querySelectorAll('#role_form input[type=checkbox]').forEach((input) => { input.checked = permissions.includes(input.value); });
    document.getElementById('roles').scrollIntoView({ behavior: 'smooth' });
  }));
  document.querySelectorAll('.delete-role').forEach((button) => button.addEventListener('click', () => { if (confirm('Supprimer ce rôle ?')) socket.emit('delete role definition', button.dataset.slug); }));

  render('admin_abonnements', data.abonnements.map((item) => {
    const state = item.subscription.level;
    const status = state === 'full' ? 'Actif' : state === 'limited' ? 'En retard' : 'Expiré';
    const access = state === 'full' ? 'Complet' : state === 'limited' ? 'Consultation' : 'Bloqué';
    const dateAbo = item.date_abo ? String(item.date_abo).slice(0, 10) : '';
    const amount = item.subscription_amount === null || item.subscription_amount === undefined ? '' : Number(item.subscription_amount).toFixed(2);
    const credit = Number(item.subscription_credit) || 0;
    return `<tr><td>${escapeHtml(item.nom || '—')}</td><td>${escapeHtml(item.email)}</td><td>${dateAbo ? escapeHtml(dateAbo) : '—'}</td><td>${status}</td><td>${access}</td><td>${formatPrice(credit)}</td><td><div class="subscription-editor"><label><input type="checkbox" class="subscription-active" data-user-id="${escapeHtml(item.id)}" ${Number(item.abo) === 1 ? 'checked' : ''}> Actif</label><input type="date" class="subscription-date" data-user-id="${escapeHtml(item.id)}" value="${escapeHtml(dateAbo)}"><input type="number" class="subscription-amount" data-user-id="${escapeHtml(item.id)}" value="${escapeHtml(amount)}" min="0" max="100000" step="0.01" placeholder="Prélèvement €" aria-label="Montant du prélèvement"><input type="number" class="subscription-credit" data-user-id="${escapeHtml(item.id)}" value="${escapeHtml(credit.toFixed(2))}" min="0" max="100000" step="0.01" placeholder="Avoir €" aria-label="Solde avoir"><button type="button" class="admin-action save-subscription" data-user-id="${escapeHtml(item.id)}">Enregistrer</button></div></td></tr>`;
  }), 'Aucun abonnement.');
  document.querySelectorAll('.save-subscription').forEach((button) => button.addEventListener('click', () => {
    const userId = button.dataset.userId;
    const active = document.querySelector(`.subscription-active[data-user-id="${userId}"]`);
    const date = document.querySelector(`.subscription-date[data-user-id="${userId}"]`);
    const amount = document.querySelector(`.subscription-amount[data-user-id="${userId}"]`);
    const credit = document.querySelector(`.subscription-credit[data-user-id="${userId}"]`);
    button.disabled = true;
    socket.emit('admin update subscription', { userId, active: Boolean(active?.checked), dateAbo: date?.value || '', amount: amount?.value || '', credit: credit?.value || '' });
    setTimeout(() => { button.disabled = false; }, 2500);
  }));

  render('admin_logs', data.logs.map((item) => `<tr><td>${formatDate(item.created_at)}</td><td>${escapeHtml(item.compte || 'Visiteur')}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.message)}</td></tr>`), 'Aucun incident enregistré.');
  render('admin_server_logs', (data.serverLogs || []).map((item) => `<tr><td>${formatDate(item.created_at)}</td><td>${escapeHtml(item.level)}</td><td>${escapeHtml(item.event)}</td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.compte || 'Système')}</td><td>${escapeHtml(item.request_id || '—')}</td><td title="${escapeHtml(item.context || '')}">${contextPreview(item.context)}</td></tr>`), 'Aucun log serveur.');
});

socket.on('admin error', (message) => alert(message));
socket.on('role updated', requestAdminData);
socket.on('subscription updated', requestAdminData);
socket.on('account deleted', requestAdminData);
socket.on('ticket team updated', requestAdminData);
socket.on('feature flag updated', requestAdminData);
socket.on('offer saved', () => { resetOfferForm(); requestAdminData(); });
socket.on('offer deleted', () => { resetOfferForm(); requestAdminData(); });
socket.on('offer error', (error) => {
  const submit = document.getElementById('offer_submit');
  const message = document.getElementById('offer_message');
  if (submit) submit.disabled = false;
  if (message) message.textContent = error || 'Impossible d’enregistrer cette offre.';
});
socket.on('role created', () => { resetRoleForm(); requestAdminData(); });
socket.on('role definition updated', () => { resetRoleForm(); requestAdminData(); });
socket.on('role definition deleted', () => { resetRoleForm(); requestAdminData(); });
socket.on('auth error', () => window.location.assign('/connexion/'));
socket.on('admin notification created', ({ recipients } = {}) => {
  const message = document.getElementById('notification_create_message');
  const form = document.getElementById('notification_create_form');
  const submit = document.getElementById('notification_submit');
  if (form) form.reset();
  syncNotificationAudience();
  if (submit) submit.disabled = false;
  if (message) message.textContent = `Notification envoyée à ${Number(recipients) || 0} compte(s).`;
});
socket.on('admin notification error', (error) => {
  const message = document.getElementById('notification_create_message');
  const submit = document.getElementById('notification_submit');
  if (submit) submit.disabled = false;
  if (message) message.textContent = error || 'Impossible d’envoyer cette notification.';
});

document.getElementById('role_form').addEventListener('submit', (event) => {
  event.preventDefault();
  const payload = {
    nom: document.getElementById('role_nom').value,
    permissions: [...document.querySelectorAll('#role_form input[type=checkbox]:checked')].map((input) => input.value)
  };
  const slug = document.getElementById('role_slug').value;
  socket.emit(slug ? 'update role definition' : 'create role', { ...payload, slug });
});

function resetRoleForm() {
  document.getElementById('role_form').reset();
  document.getElementById('role_slug').value = '';
  document.getElementById('role_title').textContent = 'Créer un rôle';
  document.getElementById('role_submit').textContent = 'Créer le rôle';
}

document.getElementById('notification_create_form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const audience = document.getElementById('notification_audience').value;
  const recipient = document.getElementById('notification_recipient');
  const message = document.getElementById('notification_create_message');
  const submit = document.getElementById('notification_submit');
  if (audience === 'user' && !recipient?.value) {
    if (message) message.textContent = 'Choisis le compte qui doit recevoir la notification.';
    return;
  }
  if (message) message.textContent = 'Envoi en cours…';
  if (submit) submit.disabled = true;
  socket.emit('create notification', {
    audience,
    recipientId: audience === 'user' ? recipient.value : null,
    title: document.getElementById('notification_title').value,
    message: document.getElementById('notification_message').value
  });
});

document.getElementById('offer_form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const submit = document.getElementById('offer_submit');
  const message = document.getElementById('offer_message');
  if (submit) submit.disabled = true;
  if (message) message.textContent = 'Enregistrement en cours…';
  socket.emit('save offer', {
    id: document.getElementById('offer_id').value,
    name: document.getElementById('offer_name').value,
    active: document.getElementById('offer_active').checked,
    description: document.getElementById('offer_description').value,
    price: document.getElementById('offer_price').value,
    originalPrice: document.getElementById('offer_original_price').value,
    discountLabel: document.getElementById('offer_discount_label').value,
    billingPeriod: document.getElementById('offer_billing_period').value,
    sortOrder: document.getElementById('offer_sort_order').value,
    stripePriceId: document.getElementById('offer_stripe_price_id').value,
    ctaLabel: document.getElementById('offer_cta_label').value,
    features: document.getElementById('offer_features').value.split(/\r?\n/),
    includedAccess: [...document.querySelectorAll('input[name="offer_access"]:checked')].map((input) => input.value)
  });
});

document.getElementById('offer_cancel')?.addEventListener('click', resetOfferForm);

requestAdminData();
