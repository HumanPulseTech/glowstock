const ticketSocket = window.glowstockSocket || (window.glowstockSocket = io());

const ticketEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const ticketDate = (value) => {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); } catch (_) { return '—'; }
};
const ticketMoney = (value) => `${Number(value || 0).toFixed(2).replace('.', ',')} €`;
const ticketTime = (value) => {
  const minutes = Math.max(0, Number(value || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h ${rest ? `${rest} min` : ''}`.trim() : `${rest} min`;
};

const ticketState = { data: null, selectedId: null };
function ensureReclamationDecisionStyles() {
  if (document.getElementById('ticket_reclamation_styles')) return;
  const style = document.createElement('style');
  style.id = 'ticket_reclamation_styles';
  style.textContent = '.ticket-reclamation-decision{margin:18px 0;padding:15px;border:1px solid #ead7b0;border-radius:13px;background:#fffaf0}.ticket-reclamation-decision h4{margin:0 0 6px}.ticket-reclamation-decision p{margin:0 0 10px;color:var(--muted);line-height:1.45}.ticket-reclamation-decision-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ticket-reclamation-decision label{display:grid;gap:5px;color:var(--muted);font-size:12px;font-weight:700}.ticket-reclamation-decision select,.ticket-reclamation-decision textarea{width:100%;border:1px solid var(--border);border-radius:9px;padding:9px 10px;background:var(--surface);color:var(--text);font:inherit}.ticket-reclamation-decision textarea{min-height:80px;margin-top:10px;resize:vertical}.ticket-reclamation-decision button{margin-top:9px;border:0;border-radius:10px;padding:10px 13px;background:#b8863b;color:#fff;font:inherit;font-weight:800;cursor:pointer}.ticket-reclamation-decision button:disabled{opacity:.6;cursor:wait}@media(max-width:640px){.ticket-reclamation-decision-grid{grid-template-columns:1fr}}';
  document.head.appendChild(style);
}

function renderReclamationDecision(data, ticket) {
  const current = document.getElementById('ticket_reclamation_decision');
  if (current) current.remove();
  const updateForm = document.getElementById('ticket_update_form');
  if (updateForm) updateForm.hidden = ticket?.statut === 'reclamation';
  if (!ticket || ticket.statut !== 'reclamation' || !data.isFounder) return;
  ensureReclamationDecisionStyles();
  const panel = document.createElement('section');
  panel.id = 'ticket_reclamation_decision';
  panel.className = 'ticket-reclamation-decision';
  const statusOptions = Object.entries(data.statuses || {}).filter(([value]) => value !== 'reclamation').map(([value, label]) => `<option value="${ticketEscape(value)}">${ticketEscape(label)}</option>`).join('');
  panel.innerHTML = `<h4>Décision du fondateur</h4><p>Cette cliente a utilisé son unique droit de réclamation. Choisis la suite à donner et laisse une explication.</p><div class="ticket-reclamation-decision-grid"><label>Décision<select id="ticket_reclamation_choice"><option value="reouvrir">Réouvrir le ticket</option><option value="maintenir">Maintenir la décision finale</option><option value="modifier">Modifier la décision</option></select></label><label id="ticket_reclamation_status_label" hidden>Nouvel état<select id="ticket_reclamation_status">${statusOptions}</select></label></div><textarea id="ticket_reclamation_note" maxlength="5000" required placeholder="Décision expliquée à la cliente…"></textarea><button type="button" id="ticket_reclamation_submit">Enregistrer la décision</button>`;
  document.getElementById('ticket_update_form')?.before(panel);
  const choice = panel.querySelector('#ticket_reclamation_choice');
  const statusLabel = panel.querySelector('#ticket_reclamation_status_label');
  choice.addEventListener('change', () => { statusLabel.hidden = choice.value !== 'modifier'; });
  panel.querySelector('#ticket_reclamation_submit').addEventListener('click', () => {
    const note = panel.querySelector('#ticket_reclamation_note').value.trim();
    if (!note) return alert('Ajoute une explication à la décision.');
    const button = panel.querySelector('#ticket_reclamation_submit');
    button.disabled = true;
    ticketSocket.emit('decide ticket reclamation', { ticketId: ticket.id, decision: choice.value, status: panel.querySelector('#ticket_reclamation_status').value, note });
  });
}
const actionLabels = { creation: 'Ticket créé', mise_a_jour: 'Mise à jour', note: 'Information ajoutée' };

Object.assign(actionLabels, { reclamation: 'Réclamation envoyée', reclamation_decision: 'Décision du fondateur' });

function requestTicketData(ticketId = ticketState.selectedId) {
  ticketSocket.emit('ticket data', {
    ticketId: ticketId || '',
    status: document.getElementById('ticket_filter_status')?.value || ''
  });
}

function setSelectOptions(id, options, selected = '', placeholder = null) {
  const select = document.getElementById(id);
  if (!select) return;
  const first = placeholder === null ? '' : `<option value="">${ticketEscape(placeholder)}</option>`;
  select.innerHTML = first + options.map((option) => `<option value="${ticketEscape(option.value)}"${String(option.value) === String(selected ?? '') ? ' selected' : ''}>${ticketEscape(option.label)}</option>`).join('');
}

function currentTeams(data) {
  const teams = data.teams || [];
  return data.canSeeAll || !data.currentTeam ? teams : teams.filter((team) => team.slug === data.currentTeam);
}

function ensureCreateCategorySelect() {
  let select = document.getElementById('ticket_create_category');
  const teamSelect = document.getElementById('ticket_create_team');
  if (select || !teamSelect) return select;
  select = document.createElement('select');
  select.id = 'ticket_create_category';
  select.required = true;
  select.setAttribute('aria-label', 'Type de ticket');
  select.title = 'Type de ticket';
  select.innerHTML = '<option value="bug">Bug</option><option value="abonnement">Problème d’abonnement</option>';
  teamSelect.parentNode.insertBefore(select, teamSelect);
  return select;
}

function renderTicketFilters(data) {
  const statusOptions = Object.entries(data.statuses || {}).map(([value, label]) => ({ value, label }));
  setSelectOptions('ticket_filter_status', statusOptions, data.filter?.status || '', 'Tous');
  const teams = currentTeams(data).map((team) => ({ value: team.slug, label: team.nom }));
  ensureCreateCategorySelect();
  setSelectOptions('ticket_create_team', teams, data.currentTeam || teams[0]?.value || '', null);
  setSelectOptions('ticket_update_status', statusOptions, data.ticket?.statut || 'non_traite', null);
  setSelectOptions('ticket_update_team', teams, data.ticket?.equipe || data.currentTeam || teams[0]?.value || '', null);
  renderAssigneeOptions(data, data.ticket?.assigne_id || '');
}

function renderAssigneeOptions(data, selected = '') {
  const team = document.getElementById('ticket_update_team')?.value || data.ticket?.equipe || '';
  const assignees = (data.assignees || []).filter((item) => item.ticket_team === team || item.ticket_team === 'fondateur');
  setSelectOptions('ticket_update_assignee', assignees.map((item) => ({ value: item.id, label: `${item.nom || item.email} · ${item.email}` })), selected, 'Non attribué');
}

function renderTicketList(data) {
  const target = document.getElementById('admin_tickets');
  if (!target) return;
  const rows = (data.tickets || []).map((ticket) => {
    const active = Number(ticket.id) === Number(ticketState.selectedId) ? ' active' : '';
    const status = data.statuses?.[ticket.statut] || ticket.statut;
    const team = data.teams?.find((item) => item.slug === ticket.equipe)?.nom || ticket.equipe;
    return `<button type="button" class="ticket-item${active}" data-ticket-id="${ticketEscape(ticket.id)}"><strong>#${ticketEscape(ticket.id)} · ${ticketEscape(ticket.titre)}</strong><span class="ticket-item-meta"><span>${ticketEscape(team)}</span><span class="ticket-status">${ticketEscape(status)}</span></span><small>${ticketEscape(ticket.assigne_nom ? `En cours par ${ticket.assigne_nom}` : 'Non attribué')} · ${ticketDate(ticket.updated_at)}</small></button>`;
  });
  target.innerHTML = rows.length ? rows.join('') : '<div class="empty">Aucun ticket pour ce filtre.</div>';
  target.querySelectorAll('[data-ticket-id]').forEach((button) => button.addEventListener('click', () => {
    ticketState.selectedId = button.dataset.ticketId;
    requestTicketData(ticketState.selectedId);
  }));
}

function renderTicketDetail(data) {
  const empty = document.getElementById('ticket_detail_empty');
  const content = document.getElementById('ticket_detail_content');
  if (!empty || !content) return;
  const ticket = data.ticket;
  if (!ticket) {
    empty.hidden = false;
    content.hidden = true;
    document.getElementById('ticket_reclamation_decision')?.remove();
    if (document.getElementById('ticket_update_form')) document.getElementById('ticket_update_form').hidden = false;
    return;
  }
  empty.hidden = true;
  content.hidden = false;
  const team = data.teams?.find((item) => item.slug === ticket.equipe)?.nom || ticket.equipe;
  const status = data.statuses?.[ticket.statut] || ticket.statut;
  document.getElementById('ticket_breadcrumb').textContent = `Administration › Tickets › ${team} › #${ticket.id}`;
  document.getElementById('ticket_detail_title').textContent = `#${ticket.id} · ${ticket.titre}`;
  document.getElementById('ticket_detail_subtitle').textContent = `${status} · ${ticket.assigne_nom ? `En cours de traitement par ${ticket.assigne_nom}` : 'Pas encore attribué'} · Déclaré par ${ticket.demandeur_nom || ticket.demandeur_email || 'Compte supprimé'}`;
  document.getElementById('ticket_detail_description').textContent = ticket.description || 'Aucune description.';
  document.getElementById('ticket_detail_cost').textContent = ticketMoney(ticket.cout_total);
  document.getElementById('ticket_detail_time').textContent = ticketTime(ticket.temps_total_minutes);
  document.getElementById('ticket_detail_created').textContent = ticketDate(ticket.created_at);
  document.getElementById('ticket_update_cost').value = Number(ticket.cout_total || 0).toFixed(2);
  document.getElementById('ticket_update_minutes').value = Number(ticket.temps_total_minutes || 0);
  document.getElementById('ticket_update_note').value = '';
  renderTicketFilters(data);
  renderReclamationDecision(data, ticket);

  const history = document.getElementById('ticket_history');
  const updates = data.updates || [];
  history.innerHTML = updates.length ? updates.map((update) => {
    const updateStatus = update.statut ? (data.statuses?.[update.statut] || update.statut) : '';
    const updateTeam = update.equipe ? (data.teams?.find((item) => item.slug === update.equipe)?.nom || update.equipe) : '';
    const details = [updateStatus, updateTeam, update.assigne_nom ? `Attribué à ${update.assigne_nom}` : '', Number(update.cout_delta || 0) ? `Coût ${Number(update.cout_delta) > 0 ? '+' : ''}${ticketMoney(update.cout_delta)}` : '', Number(update.temps_delta_minutes || 0) ? `Temps ${Number(update.temps_delta_minutes) > 0 ? '+' : ''}${ticketTime(Math.abs(update.temps_delta_minutes))}` : ''].filter(Boolean).join(' · ');
    return `<article class="ticket-update"><strong>${ticketEscape(actionLabels[update.action] || update.action)}</strong><small> · ${ticketEscape(update.auteur_nom || update.auteur_email || 'Compte supprimé')} · ${ticketEscape(ticketDate(update.created_at))}</small>${details ? `<small> · ${ticketEscape(details)}</small>` : ''}${update.contenu ? `<p>${ticketEscape(update.contenu)}</p>` : ''}</article>`;
  }).join('') : '<div class="empty">Aucun historique.</div>';
}

ticketSocket.on('ticket data response', (data) => {
  ticketState.data = data;
  if (data.ticket) ticketState.selectedId = data.ticket.id;
  renderTicketFilters(data);
  renderTicketList(data);
  renderTicketDetail(data);
});

ticketSocket.on('ticket created', (result) => {
  ticketState.selectedId = result?.ticketId || null;
  requestTicketData(ticketState.selectedId);
  document.getElementById('ticket_create_form')?.reset();
});
ticketSocket.on('ticket updated', () => requestTicketData(ticketState.selectedId));
ticketSocket.on('ticket error', (message) => alert(message));
ticketSocket.on('ticket reclamation decided', () => requestTicketData(ticketState.selectedId));
ticketSocket.on('ticket reclamation error', (message) => alert(message));

document.querySelector('[data-tab="tickets"]')?.addEventListener('click', () => requestTicketData());
document.getElementById('ticket_filter_status')?.addEventListener('change', () => {
  ticketState.selectedId = null;
  requestTicketData();
});
document.getElementById('ticket_filter_reset')?.addEventListener('click', () => {
  document.getElementById('ticket_filter_status').value = '';
  ticketState.selectedId = null;
  requestTicketData();
});
document.getElementById('ticket_update_team')?.addEventListener('change', () => renderAssigneeOptions(ticketState.data || {}, ''));
document.getElementById('ticket_create_form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  ticketSocket.emit('create ticket', {
    title: document.getElementById('ticket_create_title').value,
    category: document.getElementById('ticket_create_category')?.value || 'bug',
    team: document.getElementById('ticket_create_team').value,
    description: document.getElementById('ticket_create_description').value
  });
});
document.getElementById('ticket_update_form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!ticketState.selectedId) return alert('Sélectionne un ticket.');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  ticketSocket.emit('update ticket', {
    ticketId: ticketState.selectedId,
    status: document.getElementById('ticket_update_status').value,
    team: document.getElementById('ticket_update_team').value,
    assigneeId: document.getElementById('ticket_update_assignee').value,
    cost: document.getElementById('ticket_update_cost').value,
    minutes: document.getElementById('ticket_update_minutes').value,
    note: document.getElementById('ticket_update_note').value
  });
  setTimeout(() => { if (button) button.disabled = false; }, 2500);
});

requestTicketData();
