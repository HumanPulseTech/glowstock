(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const money = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
    const state = { workspace: null, draft: null, kind: 'all', query: '', busy: false, lineId: null, paymentKey: null, cancellationTicket: null, uncertain: false, inventoryOnly: true, integrity: null };
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
    async function loadInventory() {
        const response = await fetch('/api/caisse/inventory', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (response.status === 401) window.location.assign('/connexion/');
        const data = await response.json();
        if (!response.ok) { $('inventory_status').textContent = data.error || 'Inventaire indisponible.'; throw Object.assign(new Error(data.error || 'Inventaire indisponible.'), { status: response.status }); }
        state.workspace ||= { products: [], catalog: [], drafts: [], appointments: [] };
        state.workspace.products = data.products;
        render();
    }
    async function load() {
        try { state.workspace = await api('workspace'); state.inventoryOnly = false; }
        catch (error) { state.inventoryOnly = true; render(); throw error; }
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
        try { await work(); message('Données du compte à jour dans la caisse pilote.'); }
        catch (error) {
            message(error.message, true); if (form) form.querySelector('.form-error').textContent = error.message;
            if (!error.status || error.status === 409 || error.status >= 500) {
                state.uncertain = true;
                try { await load(); } catch { message('Service caisse indisponible. L’inventaire chargé reste consultable ; la création et la modification des tickets sont bloquées.', true); }
            }
        } finally { state.busy = false; document.querySelectorAll('button').forEach(b => { b.disabled = false; }); render(); }
    }
    async function openDraft(appointmentId = null) {
        if (state.inventoryOnly) throw new Error('Le service caisse doit être disponible pour créer un ticket.');
        state.draft = await api('open', { appointmentId, key: crypto.randomUUID() });
        $('appointments_dialog').close(); await load();
    }
    async function mutate(command, input) {
        if (!state.draft || state.uncertain || state.inventoryOnly) throw new Error('Recharge le ticket avant de continuer.');
        state.draft = await api(command, { ...input, draftId: state.draft.id, version: state.draft.version });
        await load();
    }
    function render() {
        if (!state.workspace) return;
        renderCatalog(); renderTicket(); renderAppointments(); renderCashSession(); renderCashReport(); renderIntegrity();
        const count = state.workspace.products.length;
        $('inventory_status').textContent = `${count} produit(s) de votre inventaire${state.inventoryOnly ? ' · consultation seule, service caisse indisponible ou en connexion' : ' · tarifs de vente à définir si nécessaire'}`;
        for (const id of ['new_catalog', 'appointments_button', 'new_sale', 'walk_in']) $(id).disabled = state.busy || state.inventoryOnly;
    }
    function renderCashSession() {
        const session = state.workspace.cashSession, summary = $('cash_session_summary'), control = $('cash_session_button');
        control.disabled = state.busy || state.inventoryOnly;
        if (session?.status === 'open') {
            summary.textContent = `Caisse ouverte · fonds de départ : ${money(session.openingCents)}.`;
            control.textContent = 'Fermer la caisse';
            control.onclick = () => {
                $('cash_close_form').reset(); $('closing_amount').value = (session.openingCents / 100).toFixed(2).replace('.', ',');
                $('cash_close_form').querySelector('.form-error').textContent = ''; $('cash_close_dialog').showModal();
            };
        } else if (session?.status === 'closed') {
            summary.textContent = `Dernière fermeture · compté : ${money(session.closingCents)} · écart simulé : ${money(session.differenceCents)}.`;
            control.textContent = 'Ouvrir la caisse';
            control.onclick = () => { $('cash_open_form').reset(); $('opening_amount').value = '0,00'; $('cash_open_form').querySelector('.form-error').textContent = ''; $('cash_open_dialog').showModal(); };
        } else {
            summary.textContent = 'Aucune caisse ouverte. Saisissez le fonds de départ pour commencer.';
            control.textContent = 'Ouvrir la caisse';
            control.onclick = () => { $('cash_open_form').reset(); $('opening_amount').value = '0,00'; $('cash_open_form').querySelector('.form-error').textContent = ''; $('cash_open_dialog').showModal(); };
        }
    }
    function renderCashReport() {
        const report = state.workspace.cashClosures?.[0], section = $('cash_report'), data = $('cash_report_data');
        section.hidden = !report; if (!report) return;
        data.replaceChildren();
        const metric = (label, value) => { const item = node('div'); item.append(node('span', '', label), node('strong', '', value)); return item; };
        data.append(
            metric('Tickets simulés', String(report.payments?.ticketCount || 0)),
            metric('Carte / autre', `${money(report.payments?.cardCents || 0)} · ${money(report.payments?.otherCents || 0)}`),
            metric('Cartes cadeaux simulées', money(report.payments?.giftCardCents || 0)),
            metric('Espèces attendues', money(report.expectedCents)),
            metric('Compté · écart', `${money(report.closingCents)} · ${money(report.differenceCents)}`),
            metric('Empreinte de clôture', report.auditSeal ? `${report.auditSeal.slice(0, 16)}…` : 'Fermeture antérieure')
        );
    }
    function renderIntegrity() {
        const target = $('integrity_status'), result = state.integrity;
        if (!result) { target.textContent = ''; target.classList.remove('error'); return; }
        target.classList.toggle('error', !result.ok);
        if (result.scope === 'memory-demo') target.textContent = 'Démonstration locale : aucun journal SQL à contrôler.';
        else target.textContent = result.ok ? `Journal cohérent : ${result.eventCount} événement(s), séquence ${result.sequence}, ${result.sealedTickets || 0} ticket(s), ${result.sealedCorrections || 0} annulation(s) et ${result.sealedClosures} fermeture(s) scellés.` : 'Alerte : incohérence détectée dans le journal. Stoppez les opérations et contactez l’assistance.';
    }
    function renderTicketHistory() {
        const list = $('ticket_history_list'); list.replaceChildren();
        const method = { card: 'Carte simulée', cash: 'Espèces simulées', other: 'Autre simulé' };
        const tickets = state.workspace.drafts.filter(d => d.status === 'simulated').sort((a, b) => String(b.simulation?.validatedAt).localeCompare(String(a.simulation?.validatedAt)));
        const corrections = new Map((state.workspace.corrections || []).map(item => [item.ticketId, item]));
        for (const ticket of tickets) {
            const entry = node('article', 'history-ticket');
            const when = ticket.simulation?.validatedAt ? new Date(ticket.simulation.validatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date indisponible';
            const correction = corrections.get(ticket.id);
            entry.append(node('strong', '', `${ticket.simulation?.reference || 'SIM'} · ${ticket.clientName} · ${money(ticket.totals.grossCents)}`), node('span', '', `${when} · ${method[ticket.simulation?.method] || 'Simulation'} · ${ticket.lines.length} ligne(s)`));
            if (ticket.simulation?.giftCard) entry.append(node('span', 'small', `Carte cadeau …${ticket.simulation.giftCard.code.slice(-6)} : ${money(ticket.simulation.giftCard.amountCents)} simulés${correction ? ' · montant test restitué' : ''}. Aucun débit réel.`));
            if (correction) entry.append(node('span', 'small', `${correction.reference} · annulé en simulation : ${correction.reason}`));
            else entry.append(button('Annuler la simulation', 'text-button', () => openCancellation(ticket)));
            list.append(entry);
        }
        if (!tickets.length) list.append(node('p', 'empty', 'Aucun ticket validé en simulation pour le moment.'));
    }
    function renderCatalog() {
        const list = $('catalog'); list.replaceChildren();
        const productsWithoutPrice = state.workspace.products.filter(p => !state.workspace.catalog.some(c => c.productId === p.id)).map(p => ({ id: `product-${p.id}`, productId: p.id, kind: 'product', name: p.name, unitCents: null }));
        const entries = [...state.workspace.catalog, ...productsWithoutPrice].filter(item => (state.kind === 'all' || item.kind === state.kind) && `${item.name} ${state.workspace.products.find(p => p.id === item.productId)?.reference || ''}`.toLocaleLowerCase('fr').includes(state.query.toLocaleLowerCase('fr')));
        for (const item of entries) {
            const card = button('', 'item-card', () => {
                if (item.unitCents === null) return openCatalog(item.productId);
                if (!state.draft || state.draft.status !== 'draft') { $('appointments_dialog').showModal(); return; }
                void action(() => mutate('add', { catalogId: item.id }));
            }, item.unitCents === null ? `Définir le tarif de ${item.name}` : `Ajouter ${item.name}, ${money(item.unitCents)}`);
            card.append(node('span', 'item-art', item.kind === 'product' ? '◒' : '✧'), node('strong', '', item.name), node('span', 'item-kind', item.kind === 'service' ? 'Prestation' : 'Produit à emporter'), node('span', item.unitCents === null ? 'item-price missing-price' : 'item-price', item.unitCents === null ? 'Définir le tarif' : money(item.unitCents)), node('span', 'add-sign', '+'));
            const product = state.workspace.products.find(p => p.id === item.productId);
            if (product) card.append(node('span', 'inventory-detail', `Stock : ${product.quantity}${product.reference ? ' · Réf. ' + product.reference : ''}`));
            if (state.inventoryOnly) card.disabled = true;
            list.append(card);
        }
        if (!entries.length) list.append(node('p', 'empty', state.query ? 'Aucun résultat. Essayez un autre nom.' : 'Votre catalogue est prêt à accueillir vos prestations. Utilisez + pour créer votre premier tarif.'));
    }
    function renderTicket() {
        const draft = state.draft, editable = draft?.status === 'draft' && !state.uncertain && !state.inventoryOnly;
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
        const giftNote = draft?.simulation?.giftCard ? ` Carte cadeau : ${money(draft.simulation.giftCard.amountCents)} simulés, reste test après ce ticket : ${money(draft.simulation.giftCard.remainingCents)}. Aucun débit réel.` : '';
        $('ticket_note').textContent = draft?.simulation ? `SIMULATION SANS VALEUR FISCALE · monnaie simulée : ${money(draft.simulation.changeCents)}. Aucun stock modifié.${giftNote}` : draft?.totals.needsPrice ? 'Confirmez les prix et la TVA pour continuer.' : 'Brouillon enregistré dans le service caisse.';
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
    function openCancellation(ticket) {
        state.cancellationTicket = ticket;
        state.cancellationKey = crypto.randomUUID();
        $('cancel_ticket_reference').textContent = `${ticket.simulation?.reference || 'Ticket'} · ${ticket.clientName} · ${money(ticket.totals.grossCents)}`;
        $('cancel_form').reset(); $('cancel_form').querySelector('.form-error').textContent = '';
        $('cancel_dialog').showModal(); $('cancel_reason').focus();
    }
    $('search').addEventListener('input', event => { state.query = event.target.value; renderCatalog(); });
    document.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { state.kind = b.dataset.kind; document.querySelectorAll('[data-kind]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === b))); renderCatalog(); });
    $('new_catalog').onclick = () => state.workspace && openCatalog(); $('catalog_kind').onchange = updateCatalogType;
    $('refresh_inventory').onclick = () => action(async () => { await loadInventory(); await load(); });
    $('appointments_button').onclick = () => state.workspace && $('appointments_dialog').showModal();
    $('ticket_history_button').onclick = () => { if (!state.workspace) return; renderTicketHistory(); $('ticket_history_dialog').showModal(); };
    $('integrity_button').onclick = () => void action(async () => {
        state.integrity = await api('audit-verify');
        if (!state.integrity.ok) throw Object.assign(new Error('Incohérence détectée dans le journal.'), { status: 409 });
        renderIntegrity();
    });
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
    $('checkout').onclick = () => {
        state.paymentKey = crypto.randomUUID(); state.paymentRequest = null;
        $('payment_form').reset(); $('payment_form').querySelector('.form-error').textContent = '';
        $('gift_summary').textContent = 'Le solde réel est consulté, mais les essais ne le débitent jamais.';
        $('payment_form').querySelector('details').open = false;
        $('payment_total').textContent = money(state.draft.totals.grossCents); updateCash(); $('payment_dialog').showModal();
    };
    function remainingPayment() {
        const gift = $('gift_code').value.trim() ? cents($('gift_amount').value || '0') : 0;
        if (gift > state.draft.totals.grossCents) throw new Error('Le montant carte cadeau dépasse le ticket.');
        return state.draft.totals.grossCents - gift;
    }
    function updateCash() {
        const cash = document.querySelector('[name=method]:checked').value === 'cash'; $('cash_label').hidden = !cash; $('cash_amount').required = cash;
        $('terminal_reference_label').hidden = cash;
        $('gift_amount').required = Boolean($('gift_code').value.trim());
        try {
            const remaining = remainingPayment(), change = cents($('cash_amount').value || '0') - remaining;
            $('payment_residual').textContent = `Reste à régler en simulation : ${money(remaining)}`;
            $('change_due').textContent = cash ? change >= 0 ? `Monnaie à rendre : ${money(change)}` : `Il manque ${money(-change)}` : '';
        } catch (error) { $('change_due').textContent = ''; $('payment_residual').textContent = error.message; }
    }
    document.querySelectorAll('[name=method]').forEach(input => input.onchange = updateCash); $('cash_amount').oninput = updateCash;
    $('gift_amount').oninput = updateCash;
    $('gift_code').oninput = () => { $('gift_summary').textContent = 'Vérifiez cette carte avant de poursuivre. Le solde sera revérifié à la validation.'; updateCash(); };
    $('gift_check').onclick = () => void action(async () => {
        const quote = await api('gift-card-check', { giftCardCode: $('gift_code').value });
        $('gift_summary').textContent = `Solde disponible pour les tests : ${money(quote.availableCents)} · solde réel inchangé : ${money(quote.realBalanceCents)}${quote.expiresAt ? ' · validité : ' + new Date(quote.expiresAt + 'T12:00:00').toLocaleDateString('fr-FR') : ''}.`;
        if (!$('gift_amount').value) $('gift_amount').value = (Math.min(quote.availableCents, state.draft.totals.grossCents) / 100).toFixed(2).replace('.', ',');
        updateCash();
    }, $('payment_form'));
    $('payment_form').onsubmit = event => { event.preventDefault(); void action(async () => {
        const method = document.querySelector('[name=method]:checked').value;
        const giftCardCode = $('gift_code').value.trim().toUpperCase();
        const request = { key: state.paymentKey, draftId: state.draft.id, version: state.paymentRequest?.version ?? state.draft.version,
            method, terminalReference: $('terminal_reference').value, tenderedCents: method === 'cash' ? cents($('cash_amount').value) : undefined,
            giftCardCode: giftCardCode || undefined, giftCardAmountCents: giftCardCode ? cents($('gift_amount').value) : undefined };
        if (state.paymentRequest && JSON.stringify(request) !== JSON.stringify(state.paymentRequest)) throw new Error('La dernière demande doit être confirmée sans modification. Rechargez le ticket avant de changer le règlement.');
        state.paymentRequest = request;
        try { state.draft = await api('simulate', request); await load(); $('payment_dialog').close(); }
        catch (error) { if (error.status && error.status < 500) state.paymentRequest = null; throw error; }
    }, event.currentTarget); };
    $('cash_open_form').onsubmit = event => { event.preventDefault(); void action(async () => {
        await api('cash-open', { key: crypto.randomUUID(), openingCents: cents($('opening_amount').value) });
        await load(); $('cash_open_dialog').close();
    }, event.currentTarget); };
    $('cash_close_form').onsubmit = event => { event.preventDefault(); void action(async () => {
        const session = state.workspace.cashSession;
        await api('cash-close', { key: crypto.randomUUID(), sessionId: session?.id, closingCents: cents($('closing_amount').value) });
        await load(); $('cash_close_dialog').close();
    }, event.currentTarget); };
    $('cancel_form').onsubmit = event => { event.preventDefault(); void action(async () => {
        const ticket = state.cancellationTicket;
        if (!ticket) throw new Error('Ticket à annuler introuvable.');
        await api('cancel', { ticketId: ticket.id, key: state.cancellationKey, reason: $('cancel_reason').value });
        if (state.draft?.id === ticket.id) state.draft = null;
        await load(); renderTicketHistory(); $('cancel_dialog').close();
    }, event.currentTarget); };
    void action(async () => {
        await loadInventory();
        await load();
        const requested = new URLSearchParams(location.search).get('appointment');
        const id = requested ? Number(requested) : state.workspace.recommendedAppointmentId;
        if (id) await openDraft(id);
        else if (state.workspace.drafts.filter(d => d.status === 'draft').length === 1 && !state.workspace.appointments.length) state.draft = state.workspace.drafts.find(d => d.status === 'draft');
        else $('appointments_dialog').showModal();
    });
})();
