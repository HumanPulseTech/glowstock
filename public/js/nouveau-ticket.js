const supportSocket = window.glowstockSocket || (window.glowstockSocket = io());
const supportForm = document.getElementById('support_ticket_form');
const supportButton = supportForm?.querySelector('button[type="submit"]');
const supportMessage = document.getElementById('support_ticket_message');
const myTicketList = document.getElementById('my_ticket_list');
const myTicketDetail = document.getElementById('my_ticket_detail');
const ticketState = { data: null, selectedId: null };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const ticketDate = (value) => {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
};
const categoryLabel = (data, category) => data?.categories?.[category] || (category === 'abonnement' ? 'Problème d’abonnement' : 'Bug');
const updateActionLabel = (action) => ({ creation: 'Ticket créé', mise_a_jour: 'Mise à jour', note: 'Information ajoutée', status: 'État mis à jour', assignment: 'Attribution mise à jour', team: 'Équipe mise à jour' }[action] || action || 'Mise à jour');

const formatUpdateAction = (action) => ({ reclamation: 'Réclamation envoyée', reclamation_decision: 'Décision du fondateur' }[action] || updateActionLabel(action));

function showSupportMessage(message, isError = false) {
  if (!supportMessage) return;
  supportMessage.textContent = message;
  supportMessage.classList.toggle('error', isError);
}

function requestMyTickets(ticketId = ticketState.selectedId) {
  supportSocket.emit('ticket data', { ticketId: ticketId || '' });
}

function renderMyTickets(data) {
  if (!myTicketList) return;
  const tickets = data.tickets || [];
  if (!tickets.length) {
    myTicketList.innerHTML = '<p class="support-message">Tu n’as encore créé aucun ticket.</p>';
    return;
  }
  myTicketList.innerHTML = tickets.map((ticket) => {
    const active = Number(ticket.id) === Number(ticketState.selectedId) ? ' active' : '';
    const status = data.statuses?.[ticket.statut] || ticket.statut;
    return `<button type="button" class="my-ticket-item${active}" data-my-ticket-id="${escapeHtml(ticket.id)}"><strong>#${escapeHtml(ticket.id)} · ${escapeHtml(ticket.titre)}</strong><span class="my-ticket-item-meta"><span>${escapeHtml(categoryLabel(data, ticket.categorie))}</span><span class="my-ticket-status">${escapeHtml(status)}</span></span><small>${escapeHtml(ticket.assigne_nom ? `En cours de traitement par ${ticket.assigne_nom}` : 'En attente de prise en charge')} · ${escapeHtml(ticketDate(ticket.updated_at))}</small></button>`;
  }).join('');
  myTicketList.querySelectorAll('[data-my-ticket-id]').forEach((button) => button.addEventListener('click', () => {
    ticketState.selectedId = button.dataset.myTicketId;
    requestMyTickets(ticketState.selectedId);
  }));
}

function renderMyTicketDetail(data) {
  if (!myTicketDetail) return;
  const ticket = data.ticket;
  if (!ticket) {
    myTicketDetail.hidden = true;
    return;
  }
  myTicketDetail.hidden = false;
  const status = data.statuses?.[ticket.statut] || ticket.statut;
  const team = data.teams?.find((item) => item.slug === ticket.equipe)?.nom || ticket.equipe;
  document.getElementById('my_ticket_breadcrumb').textContent = `Mes tickets › ${categoryLabel(data, ticket.categorie)} › #${ticket.id}`;
  document.getElementById('my_ticket_detail_title').textContent = `#${ticket.id} · ${ticket.titre}`;
  document.getElementById('my_ticket_detail_subtitle').textContent = `${categoryLabel(data, ticket.categorie)} · ${status} · ${team}${ticket.assigne_nom ? ` · En cours de traitement par ${ticket.assigne_nom}` : ''}`;
  document.getElementById('my_ticket_detail_description').textContent = ticket.description || 'Aucune description.';
  const previousReclamation = document.getElementById('my_ticket_reclamation');
  if (previousReclamation) previousReclamation.remove();
  if (ticket.statut === 'termine' && !ticket.reclamation_utilisee_at) {
    const panel = document.createElement('section');
    panel.id = 'my_ticket_reclamation';
    panel.className = 'my-ticket-reclamation';
    panel.innerHTML = '<h4>Insatisfaite de la décision&nbsp;?</h4><p>Tu peux demander une réévaluation une seule fois pour ce ticket fermé. Ta réclamation sera transmise au fondateur.</p><form><textarea maxlength="5000" required placeholder="Explique pourquoi tu contestes la clôture du ticket…"></textarea><button type="submit">Faire une réclamation</button></form>';
    panel.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const button = panel.querySelector('button');
      const message = panel.querySelector('textarea').value;
      if (button) button.disabled = true;
      supportSocket.emit('create ticket reclamation', { ticketId: ticket.id, message });
    });
    document.querySelector('.my-ticket-history')?.before(panel);
  }
  const history = document.getElementById('my_ticket_history');
  const updates = data.updates || [];
  history.innerHTML = updates.length ? updates.map((update) => {
    const action = formatUpdateAction(update.action);
    const details = [update.statut ? (data.statuses?.[update.statut] || update.statut) : '', update.equipe ? (data.teams?.find((item) => item.slug === update.equipe)?.nom || update.equipe) : '', update.assigne_nom ? `Pris en charge par ${update.assigne_nom}` : ''].filter(Boolean).join(' · ');
    return `<article class="my-ticket-update"><strong>${escapeHtml(action)}</strong><small> · ${escapeHtml(update.auteur_nom || update.auteur_email || 'Équipe GlowStock')} · ${escapeHtml(ticketDate(update.created_at))}</small>${details ? `<small> · ${escapeHtml(details)}</small>` : ''}${update.contenu ? `<p>${escapeHtml(update.contenu)}</p>` : ''}</article>`;
  }).join('') : '<p class="support-message">Aucune mise à jour pour le moment.</p>';
}

supportForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (supportButton) supportButton.disabled = true;
  showSupportMessage('Envoi du ticket…');
  let sourcePath = window.location.pathname;
  try { if (document.referrer) sourcePath = new URL(document.referrer).pathname || sourcePath; } catch (_) { /* URL externe ignorée */ }
  supportSocket.emit('create ticket', {
    title: document.getElementById('support_ticket_title').value,
    category: document.getElementById('support_ticket_category').value,
    description: document.getElementById('support_ticket_description').value,
    sourcePath
  });
});

supportSocket.on('ticket data response', (data = {}) => {
  ticketState.data = data;
  if (data.ticket) ticketState.selectedId = data.ticket.id;
  renderMyTickets(data);
  renderMyTicketDetail(data);
});

supportSocket.on('ticket created', (result = {}) => {
  if (supportForm) supportForm.reset();
  if (supportButton) supportButton.disabled = false;
  ticketState.selectedId = result.ticketId || null;
  showSupportMessage(result.ticketId ? `Ticket #${result.ticketId} envoyé à l’équipe Développement.` : 'Ticket envoyé à l’équipe Développement.');
  requestMyTickets(ticketState.selectedId);
});

supportSocket.on('ticket reclamation created', (result = {}) => {
  showSupportMessage(result.ticketId ? `Réclamation du ticket #${result.ticketId} transmise au fondateur.` : 'Réclamation transmise au fondateur.');
  ticketState.selectedId = result.ticketId || ticketState.selectedId;
  requestMyTickets(ticketState.selectedId);
});

supportSocket.on('ticket reclamation error', (message) => {
  showSupportMessage(message || 'Impossible de créer la réclamation.', true);
  const button = document.querySelector('#my_ticket_reclamation button');
  if (button) button.disabled = false;
});

supportSocket.on('ticket updated', () => requestMyTickets(ticketState.selectedId));
supportSocket.on('ticket error', (message) => {
  if (supportButton) supportButton.disabled = false;
  showSupportMessage(message || 'Impossible d’envoyer le ticket.', true);
});
supportSocket.on('auth error', () => window.location.assign('/connexion/'));

requestMyTickets();
