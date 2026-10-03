'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const state = { cards: [], selected: null, ledger: [], hasMore: false, settings: null };
  const euro = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100);
  const date = value => value ? new Intl.DateTimeFormat('fr-FR').format(new Date(`${value}T12:00:00`)) : 'Sans expiration';
  const operationName = type => ({ issued: 'Carte créée', redeemed: 'Utilisation', refunded: 'Remboursement', disabled: 'Carte désactivée', expired: 'Fin de validité' }[type] || type);
  const operationKey = () => crypto.randomUUID();
  const message = (text, error = false) => { const el = $('message'); el.textContent = text; el.classList.toggle('error', error); };
  async function api(path, options = {}) {
    const response = await fetch(`/api/loyalty${path}`, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Cette action est indisponible pour le moment.');
    return data;
  }
  function setBusy(form, value) { const fieldset = form.querySelector('fieldset'); if (fieldset) fieldset.disabled = value; }
  function status(card) { return card.effective_status === 'active' ? 'Active' : card.effective_status === 'expired' ? 'Expirée' : 'Désactivée'; }
  function make(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
  function renderCards() {
    const root = $('cards'); root.replaceChildren(); root.setAttribute('aria-busy', 'false');
    if (!state.cards.length) { root.append(make('p', 'Aucune carte pour le moment. Créez la première carte cadeau.', 'empty')); return; }
    for (const card of state.cards) {
      const button = make('button', null, 'card-choice'); button.type = 'button'; button.setAttribute('aria-current', String(state.selected?.id === card.id));
      const left = make('strong', card.code), amount = make('span', euro(card.balance_cents), 'card-amount'), meta = make('span', `${status(card)} · ${card.expires_at ? `valable jusqu’au ${date(card.expires_at)}` : 'sans expiration'}`, 'card-meta');
      button.append(left, amount, meta); button.addEventListener('click', () => select(card.id)); root.append(button);
    }
  }
  function facts(card) {
    const entries = [['Valeur initiale', euro(card.initial_cents)], ['Solde disponible', euro(card.balance_cents)], ['Validité', card.expires_at ? `Jusqu’au ${date(card.expires_at)} inclus` : 'Sans expiration'], ['Origine', card.issue_kind === 'external_sale' ? 'Vente déjà enregistrée' : card.issue_kind === 'gift' ? 'Carte offerte' : 'Carte existante'], ['Traitement du bon', ({ single_purpose: 'Usage unique', multi_purpose: 'Usages multiples', unspecified: 'À déterminer' }[card.tax_treatment] || 'À déterminer')], ['Référence', card.reference || 'Non renseignée']];
    const root = $('detail-facts'); root.replaceChildren(); for (const [label, value] of entries) { const wrap = document.createElement('div'); wrap.append(make('dt', label), make('dd', value)); root.append(wrap); }
  }
  function renderLedger() {
    const root = $('detail-ledger'); root.replaceChildren();
    if (!state.ledger.length) root.append(make('li', 'Aucun mouvement enregistré.', 'empty'));
    for (const entry of state.ledger) {
      const li = document.createElement('li'), head = make('div', null, 'ledger-heading');
      const amount = Number(entry.amount_delta_cents); const amountText = `${amount > 0 ? '+' : ''}${euro(amount)}`;
      head.append(make('strong', operationName(entry.operation_type)), make('span', amountText, `ledger-amount${amount < 0 ? ' negative' : ''}`));
      li.append(head, make('p', `Solde après opération : ${euro(entry.balance_after_cents)} · ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.created_at))}`, 'ledger-meta'));
      if (entry.reason) li.append(make('p', entry.reason, 'ledger-reason'));
      if (entry.reference) li.append(make('p', `Référence : ${entry.reference}`, 'ledger-meta'));
      root.append(li);
    }
    $('load-history').hidden = !state.hasMore;
  }
  function renderDetail() {
    const card = state.selected; $('detail-empty').hidden = Boolean(card); $('detail-content').hidden = !card;
    if (!card) return;
    $('detail-title').textContent = `Carte ${card.code}`; $('detail-status').textContent = status(card); $('detail-status').classList.toggle('inactive', card.effective_status !== 'active');
    $('detail-balance').textContent = euro(card.balance_cents); $('detail-code').textContent = card.code; $('detail-qr').src = `/api/loyalty/gift-cards/${encodeURIComponent(card.id)}/qr`; $('detail-pdf').href = `/api/loyalty/gift-cards/${encodeURIComponent(card.id)}/pdf`; $('disable-card').disabled = card.effective_status !== 'active';
    facts(card); renderLedger();
  }
  async function select(id, before) {
    $('card-detail').setAttribute('aria-busy', 'true');
    try {
      const result = await api(`/gift-cards/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      state.selected = result.card; state.ledger = before ? [...state.ledger, ...result.ledger] : result.ledger; state.hasMore = result.hasMore;
      const index = state.cards.findIndex(card => card.id === result.card.id); if (index >= 0) state.cards[index] = result.card;
      renderCards(); renderDetail(); if (!before) $('detail-title').focus({ preventScroll: true });
    } catch (error) { message(error.message, true); } finally { $('card-detail').setAttribute('aria-busy', 'false'); }
  }
  async function load() {
    $('cards').setAttribute('aria-busy', 'true');
    try { const data = await api('/data'); state.cards = data.cards || []; state.settings = data.settings; hydrateSettings(); renderCards(); }
    catch (error) { message(error.message, true); $('cards').replaceChildren(make('p', 'Impossible de charger les cartes.', 'empty')); }
    finally { $('cards').setAttribute('aria-busy', 'false'); }
  }
  function hydrateSettings() { const s = state.settings, form = $('settings'); $('settings-fields').disabled = false; if (!s) return; form.elements.pointsPerEuro.value = s.points_per_euro; form.elements.rewardPoints.value = s.reward_points; form.elements.rewardAmount.value = (Number(s.reward_cents) / 100).toFixed(2).replace('.', ','); form.elements.expiresAfterDays.value = s.expires_after_days || ''; form.elements.enabled.checked = Boolean(s.is_enabled); }
  function dialog(id, open) { const el = $(id); if (open && !el.open) el.showModal(); if (!open && el.open) el.close(); }
  $('cards-tab').addEventListener('click', () => { $('cards-tab').setAttribute('aria-pressed', 'true'); $('settings-tab').setAttribute('aria-pressed', 'false'); $('cards-view').hidden = false; $('settings-view').hidden = true; });
  $('settings-tab').addEventListener('click', () => { $('cards-tab').setAttribute('aria-pressed', 'false'); $('settings-tab').setAttribute('aria-pressed', 'true'); $('cards-view').hidden = true; $('settings-view').hidden = false; });
  $('new-card').addEventListener('click', () => dialog('create-dialog', true)); $('close-create').addEventListener('click', () => dialog('create-dialog', false)); $('close-disable').addEventListener('click', () => dialog('disable-dialog', false));
  $('card').elements.issueKind.addEventListener('change', event => { const external = event.target.value === 'external_sale'; $('reference-label').firstChild.textContent = `Référence de l’opération (${external ? 'obligatoire' : 'facultatif'})`; $('card').elements.reference.required = external; });
  $('card').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget, body = Object.fromEntries(new FormData(form)); body.operationKey = form.dataset.operationKey || operationKey(); form.dataset.operationKey = body.operationKey; $('create-error').textContent = ''; setBusy(form, true); try { const result = await api('/gift-cards', { method: 'POST', body: JSON.stringify(body) }); state.cards.unshift(result.card); state.selected = result.card; state.ledger = [result.operation]; state.hasMore = false; renderCards(); renderDetail(); dialog('create-dialog', false); form.reset(); delete form.dataset.operationKey; message(result.replayed ? 'La carte existait déjà : aucune seconde création.' : `Carte ${result.card.code} créée.`); } catch (error) { $('create-error').textContent = error.message; } finally { setBusy(form, false); } });
  $('lookup-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; setBusy(form, true); try { const result = await api('/gift-cards/lookup', { method: 'POST', body: JSON.stringify({ code: form.elements.code.value }) }); state.selected = result.card; state.ledger = result.ledger; state.hasMore = result.hasMore; if (!state.cards.some(card => card.id === result.card.id)) state.cards.unshift(result.card); else state.cards = state.cards.map(card => card.id === result.card.id ? result.card : card); renderCards(); renderDetail(); } catch (error) { message(error.message, true); } finally { setBusy(form, false); } });
  $('refresh-cards').addEventListener('click', load);
  $('detail-qr').addEventListener('error', () => { $('detail-qr').hidden = true; $('qr-error').hidden = false; });
  $('load-history').addEventListener('click', () => { const last = state.ledger.at(-1); if (last) select(state.selected.id, last.id); });
  $('disable-card').addEventListener('click', () => { if (!state.selected) return; $('disable-summary').textContent = `${state.selected.code} · solde conservé : ${euro(state.selected.balance_cents)}`; dialog('disable-dialog', true); });
  $('disable-form').addEventListener('submit', async event => { event.preventDefault(); if (!state.selected) return; const form = event.currentTarget, body = Object.fromEntries(new FormData(form)); body.operationKey = form.dataset.operationKey || operationKey(); form.dataset.operationKey = body.operationKey; $('disable-error').textContent = ''; setBusy(form, true); try { const result = await api(`/gift-cards/${encodeURIComponent(state.selected.id)}/disable`, { method: 'POST', body: JSON.stringify(body) }); state.selected = result.card; state.ledger.unshift(result.operation); state.cards = state.cards.map(card => card.id === result.card.id ? result.card : card); renderCards(); renderDetail(); dialog('disable-dialog', false); form.reset(); delete form.dataset.operationKey; message(result.replayed ? 'La désactivation était déjà enregistrée.' : 'Carte désactivée. Son historique et son solde sont conservés.'); } catch (error) { $('disable-error').textContent = error.message; } finally { setBusy(form, false); } });
  $('settings').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget, body = Object.fromEntries(new FormData(form)); body.enabled = form.elements.enabled.checked; setBusy(form, true); try { await api('/settings', { method: 'POST', body: JSON.stringify(body) }); message('Programme de fidélité enregistré.'); } catch (error) { message(error.message, true); } finally { setBusy(form, false); } });
  load();
})();
