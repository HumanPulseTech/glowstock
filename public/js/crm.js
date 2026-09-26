(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { data: null, customer: null, service: null };
  const money = cents => cents == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  const message = (text, error = false) => { $('message').textContent = text; $('message').className = error ? 'message error' : 'message'; };
  async function api(url, options = {}) { const r = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const d = await r.json(); if (!r.ok) throw Error(d.error || 'Action impossible.'); return d; }
  function render() {
    if (!state.data) return;
    const list = $('customer_list'); list.replaceChildren();
    for (const customer of state.data.customers) { const b = document.createElement('button'); b.textContent = customer.name; b.setAttribute('aria-current', String(state.customer?.id === customer.id)); b.onclick = () => selectCustomer(customer); list.append(b); }
    const services = $('service_list'); services.replaceChildren();
    for (const service of state.data.services) { const b = document.createElement('button'); b.textContent = `${service.name} · ${money(service.price_cents)}`; b.onclick = () => selectService(service); services.append(b); }
    const products = $('service_products'); products.replaceChildren();
    for (const product of state.data.products) { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = product.id; input.checked = Boolean(state.service?.productIds?.includes(product.id)); label.append(input, document.createTextNode(product.nom)); products.append(label); }
    const appointments = $('appointment_list'); appointments.replaceChildren();
    for (const item of state.data.appointments || []) {
      const row = document.createElement('div'); row.className = 'crm-card';
      const title = document.createElement('p'); title.className = 'crm-muted'; title.textContent = `${item.day} · ${item.time} · ${item.client_name} · ${item.service_name || 'Prestation à compléter'}`; row.append(title);
      const customer = document.createElement('select'); customer.innerHTML = '<option value="">Cliente non rattachée</option>'; for (const c of state.data.customers) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; o.selected = Number(item.customer_id) === c.id; customer.append(o); }
      const service = document.createElement('select'); service.innerHTML = '<option value="">Prestation non rattachée</option>'; for (const s of state.data.services) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; o.selected = Number(item.service_id) === Number(s.id); service.append(o); }
      const save = document.createElement('button'); save.className = 'button secondary'; save.type = 'button'; save.textContent = 'Rattacher'; save.onclick = async () => { try { await api(`/api/crm/appointments/${item.id}/link`, { method: 'POST', body: JSON.stringify({ customerId: customer.value || null, serviceId: service.value || null }) }); await load(); message('Rendez-vous rattaché.'); } catch (e) { message(e.message, true); } };
      row.append(customer, service, save); appointments.append(row);
    }
  }
  async function load() { try { const data = await api('/api/crm/data'); data.appointments = (await api('/api/crm/appointments')).rows; state.data = data; render(); message(`${data.customers.length} cliente(s), ${data.services.length} prestation(s) chargée(s).`); } catch (e) { message(e.message, true); } }
  async function selectCustomer(customer) { state.customer = customer; $('customer_form').hidden = true; $('customer_title').textContent = customer.name; try { const h = await api(`/api/crm/customers/${customer.id}/history`); $('customer_summary').textContent = `${h.appointments.length} rendez-vous · ${h.tickets === null ? 'Aucun ticket réel disponible' : `${h.tickets.length} ticket(s) simulé(s)`}`; const history = $('customer_history'); history.replaceChildren(); const total = document.createElement('p'); total.className = 'crm-total'; total.textContent = h.simulatedAverageCents == null ? 'Ticket moyen : —' : `Ticket moyen simulé : ${money(h.simulatedAverageCents)}`; history.append(total); for (const item of h.appointments) { const p = document.createElement('p'); p.className = 'crm-muted'; p.textContent = `${item.day} · ${item.time} · ${item.service_name || 'Prestation'}`; history.append(p); } render(); } catch (e) { message(e.message, true); } }
  function selectService(service) { state.service = service; $('service_title').textContent = service.name; const form = $('service_form'); form.elements.name.value = service.name; form.elements.price.value = (service.price_cents / 100).toFixed(2).replace('.', ','); form.elements.duration.value = service.duration_minutes; form.elements.taxMode.value = service.tax_mode; form.elements.taxBps.value = service.tax_bps; form.elements.description.value = service.description || ''; render(); }
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { document.querySelectorAll('[data-tab]').forEach(item => item.setAttribute('aria-selected', String(item === button))); document.querySelectorAll('.crm-view').forEach(view => view.classList.toggle('active', view.id === button.dataset.tab)); });
  $('new_customer').onclick = () => { state.customer = null; $('customer_form').hidden = false; $('customer_form').reset(); $('customer_title').textContent = 'Nouvelle cliente'; };
  $('new_service').onclick = () => { state.service = null; $('service_form').reset(); $('service_form').elements.duration.value = 60; $('service_title').textContent = 'Nouvelle prestation'; render(); };
  $('customer_form').onsubmit = async event => { event.preventDefault(); try { const data = Object.fromEntries(new FormData(event.currentTarget)); await api('/api/crm/customers', { method: 'POST', body: JSON.stringify(data) }); await load(); message('Fiche cliente enregistrée.'); } catch (e) { message(e.message, true); } };
  $('service_form').onsubmit = async event => { event.preventDefault(); try { const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); data.id = state.service?.id; data.version = state.service?.version; data.taxBps = Number(data.taxBps); data.productIds = [...$('service_products').querySelectorAll('input:checked')].map(input => Number(input.value)); await api('/api/crm/services', { method: 'POST', body: JSON.stringify(data) }); await load(); message('Prestation enregistrée.'); } catch (e) { $('service_error').textContent = e.message; } };
  $('customer_search').oninput = event => { const query = event.target.value.toLocaleLowerCase('fr'); document.querySelectorAll('#customer_list button').forEach(item => { item.hidden = !item.textContent.toLocaleLowerCase('fr').includes(query); }); };
  load();
})();
