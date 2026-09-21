(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const money = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
    const state = { workspace: null, draft: null, kind: 'all', query: '', busy: false, lineId: null, paymentKey: null, uncertain: false };
    const node = (tag, className, content) => { const element = document.createElement(tag); if (className) element.className = className; if (content !== undefined) element.textContent = content; return element; };
    const button = (text, className, action, label) => { const b = node('button', className, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.disabled = state.busy; b.onclick = action; return b; };
    function message(text = '', error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
    function cents(value) {
        const normalized = value.trim().replace(',', '.');
        if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Saisis un montant valide, par exemple 45,00.');
        const [whole, fraction = ''] = normalized.split('.'); return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    }
    function tax(value) { if (!value) throw new Error('Choisis la TVA ou l’exonération.'); return { taxMode: value === 'exempt' ? 'exempt' : 'vat', taxBps: value === 'exempt' ? 0 : Number(value) }; }
    async function api(command, input = {}) {
        const response = await fetch(`/api/caisse/${command}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(10000) });
        if (response.status === 401) { window.location.assign('/connexion/'); throw new Error('Session expirée.'); }
        const data = await response.json();
        if (!response.ok) { const error = new Error(data.error || 'Action impossible.'); error.status = response.status; throw error; }
        return data;
    }
    async function load() {
        state.workspace = await api('workspace');
        if (state.draft) state.draft = state.workspace.drafts.find(d => d.id === state.draft.id) || null;
        state.uncertain = false;
        $('workspace').setAttribute('aria-busy', 'false');
        if (state.workspace.day) $('today_label').textContent = new Date(`${state.workspace.day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
        render();
    }
    async function action(work, form = null) {
        if (state.busy) return;
        state.busy = true;
        document.querySelectorAll('button').forEach(b => { b.disabled = true; });
        if (form) form.querySelector('.form-error').textContent = '';
        try { await work(); message('Enregistré dans la caisse pilote.'); }
        catch (error) {
            message(error.message, true); if (form) form.querySelector('.form-error').textContent = error.message;
            if (!error.status || error.status === 409 || error.status >= 500) {
                state.uncertain = true;
                try { await load(); } catch { message('Connexion interrompue. Recharge la page avant de poursuivre; le brouillon est conservé côté serveur.', true); }
            }
        } finally { state.busy = false; document.querySelectorAll('button').forEach(b => { b.disabled = false; }); render(); }
    }
    async function openDraft(appointmentId = null) {
        state.draft = await api('open', { appointmentId, key: crypto.randomUUID() });
        $('appointments_dialog').close(); await load();
    }
    async function mutate(command, input) {
        if (!state.draft || state.uncertain) throw new Error('Recharge le ticket avant de continuer.');
        state.draft = await api(command, { ...input, draftId: state.draft.id, version: state.draft.version });
        await load();
    }
    function render() {
        if (!state.workspace) return;
        renderCatalog(); renderTicket(); renderAppointments();
    }
    function renderCatalog() {
        const list = $('catalog'); list.replaceChildren();
        const productsWithoutPrice = state.workspace.products.filter(p => !state.workspace.catalog.some(c => c.productId === p.id)).map(p => ({ id: `product-${p.id}`, productId: p.id, kind: 'product', name: p.name, unitCents: null }));
        const entries = [...state.workspace.catalog, ...productsWithoutPrice].filter(item => (state.kind === 'all' || item.kind === state.kind) && item.name.toLocaleLowerCase('fr').includes(state.query.toLocaleLowerCase('fr')));
        for (const item of entries) {
            const card = button('', 'item-card', () => {
                if (item.unitCents === null) return openCatalog(item.productId);
                if (!state.draft || state.draft.status !== 'draft') { $('appointments_dialog').showModal(); return; }
                void action(() => mutate('add', { catalogId: item.id }));
            }, item.unitCents === null ? `Définir le tarif de ${item.name}` : `Ajouter ${item.name}, ${money(item.unitCents)}`);
            card.append(node('span', 'item-art', item.kind === 'product' ? '◒' : '✧'), node('strong', '', item.name), node('span', 'item-kind', item.kind === 'service' ? 'Prestation' : 'Produit à emporter'), node('span', item.unitCents === null ? 'item-price missing-price' : 'item-price', item.unitCents === null ? 'Définir le tarif' : money(item.unitCents)), node('span', 'add-sign', '+'));
            list.append(card);
        }
        if (!entries.length) list.append(node('p', 'empty', state.query ? 'Aucun résultat. Essayez un autre nom.' : 'Votre catalogue est prêt à accueillir vos prestations. Utilisez + pour créer votre premier tarif.'));
    }
    function renderTicket() {
        const draft = state.draft, editable = draft?.status === 'draft' && !state.uncertain;
        const client = $('client_card'); client.replaceChildren();
        const label = draft?.clientName || 'Choisissez une cliente';
        client.append(node('div', 'avatar', draft ? label.split(/\s+/).slice(0, 2).map(s => s[0]).join('') : '—'));
        const description = node('div'); description.append(node('strong', '', label), node('p', '', draft?.appointmentTime ? `Rendez-vous de ${draft.appointmentTime} · ${draft.status === 'draft' ? 'Ticket en préparation' : 'Simulation terminée'}` : 'Vente sans rendez-vous')); client.append(description);
        $('draft_status').textContent = draft?.status === 'simulated' ? 'Simulation figée' : 'Brouillon';
        const list = $('ticket_lines'); list.replaceChildren();
        for (const line of draft?.lines || []) {
            const row = node('article', 'ticket-line'); const left = node('div');
            left.append(node('strong', 'line-name', line.name), node('p', 'line-kind', `${line.kind === 'service' ? 'Prestation' : 'Produit'} · ${line.unitCents === null ? 'Tarif à confirmer' : money(line.unitCents) + ' / unité'}`));
            if (editable) {
                const controls = node('div', 'line-actions');
                controls.append(button('−', 'qty-btn', () => action(() => mutate('line', { lineId: line.id, quantity: line.quantity - 1 })), `Retirer une unité de ${line.name}`), node('span', 'line-quantity', line.quantity), button('+', 'qty-btn', () => action(() => mutate('line', { lineId: line.id, quantity: line.quantity + 1 })), `Ajouter une unité de ${line.name}`), button(line.unitCents === null ? 'Définir le prix' : 'Prix', 'price-edit', () => openPrice(line)), button('Retirer', 'remove-line', () => action(() => mutate('line', { lineId: line.id, quantity: 0 })))); left.append(controls);
            } else left.append(node('span', 'line-quantity', `Qté ${line.quantity}`));
            row.append(left, node('span', 'line-amount', line.unitCents === null ? 'À définir' : money(line.unitCents * line.quantity))); list.append(row);
        }
        if (!draft?.lines.length) list.append(node('p', 'empty', draft ? 'Touchez une prestation ou un produit à gauche pour commencer.' : 'Choisissez un rendez-vous ou une vente sans rendez-vous.'));
        $('line_count').textContent = (draft?.lines || []).reduce((sum, line) => sum + line.quantity, 0);
        $('tax_total').textContent = draft?.totals.needsPrice ? 'À compléter' : money(draft?.totals.taxCents || 0);
        $('grand_total').textContent = money(draft?.totals.grossCents || 0);
        $('mobile_total').textContent = $('grand_total').textContent;
        $('checkout').disabled = !editable || state.busy || !draft.lines.length || draft.totals.needsPrice;
        $('ticket_note').textContent = draft?.simulation ? `SIMULATION SANS VALEUR FISCALE · monnaie simulée : ${money(draft.simulation.changeCents)}. Aucun stock modifié.` : draft?.totals.needsPrice ? 'Confirmez les prix et la TVA pour continuer.' : 'Brouillon enregistré dans le service caisse.';
    }
    function renderAppointments() {
        const list = $('appointments_list'); list.replaceChildren();
        for (const item of state.workspace.appointments) {
            const used = state.workspace.drafts.find(d => d.appointmentId === item.id);
            const b = button('', 'appointment', () => action(() => openDraft(item.id)));
            b.append(node('strong', '', `${item.startTime} · ${item.clientName}`), node('span', '', `${item.serviceName || 'Prestation à compléter'}${used?.status === 'simulated' ? ' · déjà simulé' : ''}`)); list.append(b);
        }
        if (!list.children.length) list.append(node('p', 'empty', 'Aucun rendez-vous aujourd’hui.'));
        const drafts = $('drafts_list'); drafts.replaceChildren();
        for (const draft of state.workspace.drafts.filter(d => d.status === 'draft')) {
            const b = button('', 'appointment', () => { state.draft = draft; $('appointments_dialog').close(); render(); });
            b.append(node('strong', '', draft.clientName), node('span', '', `${draft.lines.length} ligne(s) · ${money(draft.totals.grossCents)}`)); drafts.append(b);
        }
        if (!drafts.children.length) drafts.append(node('p', 'empty', 'Aucun ticket en attente.'));
    }
    function openCatalog(productId = null) {
        $('catalog_form').reset(); $('catalog_form').querySelector('.form-error').textContent = '';
        $('catalog_kind').value = productId ? 'product' : 'service';
        $('catalog_product').replaceChildren();
        for (const p of state.workspace.products) { const option = node('option', '', p.name); option.value = p.id; $('catalog_product').append(option); }
        if (productId) $('catalog_product').value = productId;
        updateCatalogType(); $('catalog_dialog').showModal();
    }
    function updateCatalogType() { const isProduct = $('catalog_kind').value === 'product'; $('product_label').hidden = !isProduct; $('name_label').hidden = isProduct; $('catalog_name').required = !isProduct; }
    function openPrice(line) {
        state.lineId = line.id; $('price_item').textContent = line.name;
        $('line_price').value = line.unitCents === null ? '' : (line.unitCents / 100).toFixed(2).replace('.', ',');
        $('line_tax').value = line.taxMode === 'exempt' ? 'exempt' : line.taxBps === null ? '' : String(line.taxBps);
        $('price_form').querySelector('.form-error').textContent = ''; $('price_dialog').showModal(); $('line_price').focus();
    }
    $('search').addEventListener('input', event => { state.query = event.target.value; renderCatalog(); });
    document.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { state.kind = b.dataset.kind; document.querySelectorAll('[data-kind]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === b))); renderCatalog(); });
    $('new_catalog').onclick = () => state.workspace && openCatalog(); $('catalog_kind').onchange = updateCatalogType;
    $('appointments_button').onclick = () => state.workspace && $('appointments_dialog').showModal();
    $('new_sale').onclick = $('walk_in').onclick = () => state.workspace && action(() => openDraft());
    $('mobile_cart').onclick = () => $('ticket_panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth' });
    document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('search').focus(); } });
    $('catalog_form').onsubmit = event => { event.preventDefault(); void action(async () => {
        await api('catalog', { kind: $('catalog_kind').value, name: $('catalog_kind').value === 'product' ? $('catalog_product').selectedOptions[0]?.textContent : $('catalog_name').value,
            productId: Number($('catalog_product').value), unitCents: cents($('catalog_price').value), ...tax($('catalog_tax').value) });
        await load(); $('catalog_dialog').close();
    }, event.currentTarget); };
    $('price_form').onsubmit = event => { event.preventDefault(); void action(async () => {
        const line = state.draft.lines.find(l => l.id === state.lineId);
        await mutate('line', { lineId: line.id, quantity: line.quantity, unitCents: cents($('line_price').value), ...tax($('line_tax').value) }); $('price_dialog').close();
    }, event.currentTarget); };
    $('checkout').onclick = () => { state.paymentKey = crypto.randomUUID(); $('payment_form').reset(); $('payment_form').querySelector('.form-error').textContent = ''; $('cash_label').hidden = true; $('cash_amount').required = false; $('change_due').textContent = ''; $('payment_total').textContent = money(state.draft.totals.grossCents); $('payment_dialog').showModal(); };
    function updateCash() {
        const cash = document.querySelector('[name=method]:checked').value === 'cash'; $('cash_label').hidden = !cash; $('cash_amount').required = cash;
        try { const change = cents($('cash_amount').value || '0') - state.draft.totals.grossCents; $('change_due').textContent = cash ? change >= 0 ? `Monnaie à rendre : ${money(change)}` : `Il manque ${money(-change)}` : ''; } catch { $('change_due').textContent = ''; }
    }
    document.querySelectorAll('[name=method]').forEach(input => input.onchange = updateCash); $('cash_amount').oninput = updateCash;
    $('payment_form').onsubmit = event => { event.preventDefault(); void action(async () => {
        const method = document.querySelector('[name=method]:checked').value;
        await mutate('simulate', { key: state.paymentKey, method, tenderedCents: method === 'cash' ? cents($('cash_amount').value) : undefined }); $('payment_dialog').close();
    }, event.currentTarget); };
    void action(async () => {
        await load();
        const requested = new URLSearchParams(location.search).get('appointment');
        const id = requested ? Number(requested) : state.workspace.recommendedAppointmentId;
        if (id) await openDraft(id);
        else if (state.workspace.drafts.filter(d => d.status === 'draft').length === 1 && !state.workspace.appointments.length) state.draft = state.workspace.drafts.find(d => d.status === 'draft');
        else $('appointments_dialog').showModal();
    });
})();
