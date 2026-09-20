(() => {
  const socket = window.glowstockSocket || (window.glowstockSocket = io());
  const calendar = document.getElementById('planning_calendar');
  const message = document.getElementById('planning_message');
  const entryModal = document.getElementById('planning_entry_modal');
  const settingsModal = document.getElementById('planning_settings_modal');
  const entryForm = document.getElementById('planning_entry_form');
  const settingsForm = document.getElementById('planning_settings_form');
  const entryError = document.getElementById('planning_entry_error');
  const settingsError = document.getElementById('planning_settings_error');
  const state = { weekStart: mondayFor(today()), hours: [], entries: [], canManagePlanning: false };
  const SLOT_MINUTES = 30;
  const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  function today() { return new Date().toISOString().slice(0, 10); }
  function parseDate(value) { const [year, month, day] = String(value).split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)); }
  function dateValue(date) { return date.toISOString().slice(0, 10); }
  function addDays(value, amount) { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + amount); return dateValue(date); }
  function mondayFor(value) { const date = parseDate(value); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return dateValue(date); }
  function minutes(time) { const [hour, minute] = String(time || '').slice(0, 5).split(':').map(Number); return hour * 60 + minute; }
  function timeValue(total) { const clamped = Math.max(0, Math.min(24 * 60 - 1, total)); return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`; }
  function formatDate(value, options) { return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options }).format(parseDate(value)); }
  function isoWeek(value) { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7)); const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); return Math.ceil((((date - yearStart) / 86400000) + 1) / 7); }
  function setError(element, text = '') { element.hidden = !text; element.textContent = text; }
  function setMessage(text = '', isError = false) { message.textContent = text; message.classList.toggle('is-error', isError); }
  function openModal(modal) { modal.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(modal) { modal.hidden = true; if (entryModal.hidden && settingsModal.hidden) document.body.style.overflow = ''; }
  function hourForDay(index) { return state.hours[index] || { dayOfWeek: index, isOpen: false, opensAt: null, closesAt: null }; }
  function visibleRange() {
    const opened = state.hours.filter((day) => day.isOpen);
    const starts = opened.map((day) => minutes(day.opensAt));
    const ends = opened.map((day) => minutes(day.closesAt));
    const earliest = starts.length ? Math.min(...starts) : 9 * 60;
    const latest = ends.length ? Math.max(...ends) : 19 * 60;
    return { start: Math.max(6 * 60, Math.floor(earliest / 60) * 60), end: Math.min(22 * 60, Math.ceil(latest / 60) * 60) };
  }
  function clearCalendar() { calendar.replaceChildren(); }

  function renderCalendar() {
    clearCalendar();
    const { start, end } = visibleRange();
    const slotCount = Math.max(1, Math.ceil((end - start) / SLOT_MINUTES));
    const grid = document.createElement('div');
    grid.className = 'planning-grid';
    grid.style.setProperty('--slot-count', String(slotCount));
    const corner = document.createElement('div'); corner.className = 'planning-corner'; grid.appendChild(corner);
    const currentDate = today();
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(state.weekStart, index);
      const head = document.createElement('div'); head.className = 'planning-day-head'; if (date === currentDate) head.classList.add('is-today');
      const name = document.createElement('strong'); name.textContent = DAY_NAMES[index];
      const number = document.createElement('span'); number.textContent = formatDate(date, { day: 'numeric', month: 'short' });
      head.append(name, number); grid.appendChild(head);
    }
    const timeColumn = document.createElement('div'); timeColumn.className = 'planning-time-column';
    for (let total = start, slot = 0; slot < slotCount; total += SLOT_MINUTES, slot += 1) {
      if (total % 60) continue;
      const label = document.createElement('div'); label.className = 'planning-time'; label.style.top = `${slot * 42}px`; label.textContent = timeValue(total); timeColumn.appendChild(label);
    }
    grid.appendChild(timeColumn);
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(state.weekStart, index); const hours = hourForDay(index);
      const column = document.createElement('div'); column.className = 'planning-day-column'; column.style.gridColumn = String(index + 2); if (!hours.isOpen) column.classList.add('is-closed');
      for (let total = start, slot = 0; slot < slotCount; total += SLOT_MINUTES, slot += 1) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'planning-slot'; button.setAttribute('aria-label', `${DAY_NAMES[index]} ${formatDate(date, { day: 'numeric', month: 'long' })}, ${timeValue(total)}`);
        const allowed = hours.isOpen && total >= minutes(hours.opensAt) && total + SLOT_MINUTES <= minutes(hours.closesAt) && state.canManagePlanning;
        button.disabled = !allowed;
        if (allowed) button.addEventListener('click', () => openEntry({ appointmentDate: date, startTime: timeValue(total), endTime: timeValue(Math.min(total + 60, minutes(hours.closesAt))) }));
        column.appendChild(button);
      }
      state.entries.filter((entry) => entry.appointmentDate === date).forEach((entry) => {
        const startOffset = minutes(entry.startTime) - start;
        const duration = minutes(entry.endTime) - minutes(entry.startTime);
        if (startOffset < 0 || startOffset >= slotCount * SLOT_MINUTES) return;
        const event = document.createElement('button'); event.type = 'button'; event.className = 'planning-event';
        event.style.top = `${Math.max(0, startOffset / SLOT_MINUTES) * 42 + 2}px`; event.style.height = `${Math.max(38, (duration / SLOT_MINUTES) * 42 - 4)}px`;
        const client = document.createElement('strong'); client.textContent = entry.clientName;
        const detail = document.createElement('small'); detail.textContent = entry.serviceName || `${entry.startTime} – ${entry.endTime}`;
        event.append(client, detail); event.title = `${entry.clientName} · ${entry.startTime} – ${entry.endTime}`;
        if (state.canManagePlanning) event.addEventListener('click', () => openEntry(entry)); else event.disabled = true;
        column.appendChild(event);
      });
      grid.appendChild(column);
    }
    calendar.appendChild(grid); calendar.setAttribute('aria-busy', 'false');
  }

  function renderHours() {
    const container = document.getElementById('planning_hours'); container.replaceChildren();
    state.hours.forEach((day, index) => {
      const row = document.createElement('div'); row.className = 'planning-hour-row'; if (!day.isOpen) row.classList.add('is-closed'); row.dataset.day = String(index);
      const title = document.createElement('strong'); title.textContent = DAY_NAMES[index];
      const toggle = document.createElement('label'); toggle.className = 'planning-toggle';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = day.isOpen; checkbox.dataset.hoursOpen = String(index);
      toggle.append(checkbox, document.createTextNode('Ouvert'));
      const opens = document.createElement('input'); opens.type = 'time'; opens.step = '1800'; opens.value = day.opensAt || '09:00'; opens.dataset.hoursStart = String(index); opens.disabled = !day.isOpen;
      const closes = document.createElement('input'); closes.type = 'time'; closes.step = '1800'; closes.value = day.closesAt || '19:00'; closes.dataset.hoursEnd = String(index); closes.disabled = !day.isOpen;
      checkbox.addEventListener('change', () => { row.classList.toggle('is-closed', !checkbox.checked); opens.disabled = !checkbox.checked; closes.disabled = !checkbox.checked; });
      row.append(title, toggle, opens, closes); container.appendChild(row);
    });
  }

  function openEntry(entry) {
    if (!state.canManagePlanning) return;
    entryForm.reset(); setError(entryError);
    document.getElementById('planning_entry_id').value = entry.id || '';
    document.getElementById('planning_entry_date').value = entry.appointmentDate;
    document.getElementById('planning_entry_start').value = entry.startTime;
    document.getElementById('planning_entry_end').value = entry.endTime;
    document.getElementById('planning_entry_client').value = entry.clientName || '';
    document.getElementById('planning_entry_service').value = entry.serviceName || '';
    document.getElementById('planning_entry_notes').value = entry.notes || '';
    document.getElementById('planning_entry_title').textContent = entry.id ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous';
    document.getElementById('planning_entry_delete').hidden = !entry.id;
    openModal(entryModal); document.getElementById('planning_entry_client').focus();
  }
  function requestWeek() { calendar.setAttribute('aria-busy', 'true'); socket.emit('planning data', { weekStart: state.weekStart }); }
  function renderHeading() { const end = addDays(state.weekStart, 6); document.getElementById('planning_week_number').textContent = `Semaine ${isoWeek(state.weekStart)}`; document.getElementById('planning_week_label').textContent = `Du ${formatDate(state.weekStart, { day: 'numeric', month: 'long' })} au ${formatDate(end, { day: 'numeric', month: 'long', year: 'numeric' })}`; }

  socket.on('planning data', (data = {}) => {
    state.weekStart = mondayFor(data.weekStart || state.weekStart); state.hours = Array.isArray(data.hours) ? data.hours : []; state.entries = Array.isArray(data.entries) ? data.entries : []; state.canManagePlanning = data.canManagePlanning === true;
    document.getElementById('planning_settings_button').hidden = !state.canManagePlanning; renderHeading(); renderCalendar(); setMessage(state.canManagePlanning ? '' : 'Ton rôle peut consulter le planning, mais pas le modifier.');
  });
  socket.on('planning error', (text) => { calendar.setAttribute('aria-busy', 'false'); setMessage(text || 'Impossible de charger le planning.', true); });
  socket.on('planning entry saved', () => { closeModal(entryModal); requestWeek(); });
  socket.on('planning entry deleted', () => { closeModal(entryModal); requestWeek(); });
  socket.on('planning entry error', (text) => setError(entryError, text || 'Impossible d’enregistrer ce rendez-vous.'));
  socket.on('planning settings saved', () => { closeModal(settingsModal); requestWeek(); });
  socket.on('planning settings error', (text) => setError(settingsError, text || 'Impossible d’enregistrer les horaires.'));
  socket.on('auth error', () => window.location.assign('/connexion/'));
  socket.on('subscription blocked', (level) => window.location.assign(`/abonnement-expire/?mode=${level === 'limited' ? 'limite' : 'expire'}`));

  document.getElementById('planning_previous').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, -7); requestWeek(); });
  document.getElementById('planning_next').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, 7); requestWeek(); });
  document.getElementById('planning_today').addEventListener('click', () => { state.weekStart = mondayFor(today()); requestWeek(); });
  document.getElementById('planning_settings_button').addEventListener('click', () => { renderHours(); setError(settingsError); openModal(settingsModal); });
  document.querySelectorAll('[data-close-entry]').forEach((button) => button.addEventListener('click', () => closeModal(entryModal)));
  document.querySelectorAll('[data-close-settings]').forEach((button) => button.addEventListener('click', () => closeModal(settingsModal)));
  [entryModal, settingsModal].forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeModal(entryModal); closeModal(settingsModal); } });
  entryForm.addEventListener('submit', (event) => {
    event.preventDefault(); setError(entryError);
    const submit = document.getElementById('planning_entry_submit'); submit.disabled = true;
    socket.emit('save planning entry', { id: document.getElementById('planning_entry_id').value, appointmentDate: document.getElementById('planning_entry_date').value, startTime: document.getElementById('planning_entry_start').value, endTime: document.getElementById('planning_entry_end').value, clientName: document.getElementById('planning_entry_client').value, serviceName: document.getElementById('planning_entry_service').value, notes: document.getElementById('planning_entry_notes').value });
    setTimeout(() => { submit.disabled = false; }, 800);
  });
  document.getElementById('planning_entry_delete').addEventListener('click', () => { if (window.confirm('Supprimer ce rendez-vous ?')) socket.emit('delete planning entry', { id: document.getElementById('planning_entry_id').value }); });
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault(); setError(settingsError);
    const hours = state.hours.map((day, index) => ({ dayOfWeek: index, isOpen: document.querySelector(`[data-hours-open="${index}"]`).checked, opensAt: document.querySelector(`[data-hours-start="${index}"]`).value, closesAt: document.querySelector(`[data-hours-end="${index}"]`).value }));
    socket.emit('save planning hours', { hours });
  });
  requestWeek();
})();
