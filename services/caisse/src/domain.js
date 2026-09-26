const { randomUUID } = require('node:crypto');
class CaisseError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
const demand = (valid, message, status) => { if (!valid) throw new CaisseError(message, status); };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const name = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 150;
const initialState = () => ({ catalog: [], drafts: [] });
function pricing(input) {
    demand(integer(input.unitCents, 0, 1000000), 'Saisis un prix entre 0 et 10 000 euros.');
    demand(['vat', 'exempt'].includes(input.taxMode), 'Choisis le régime de TVA.');
    demand(integer(input.taxBps, 0, 10000) && (input.taxMode !== 'exempt' || input.taxBps === 0), 'TVA invalide.');
    return { unitCents: input.unitCents, taxMode: input.taxMode, taxBps: input.taxBps };
}
function totals(lines) {
    let grossCents = 0, taxCents = 0, needsPrice = false;
    for (const line of lines) {
        demand(integer(line.quantity, 1, 100), 'Quantité invalide.');
        if (line.unitCents === null) { needsPrice = true; continue; }
        pricing(line);
        const gross = line.unitCents * line.quantity;
        // All calculations are integer cents; round VAT once per ticket line.
        const tax = line.taxMode === 'exempt' ? 0 : Math.floor((gross * line.taxBps + (10000 + line.taxBps) / 2) / (10000 + line.taxBps));
        grossCents += gross; taxCents += tax;
    }
    demand(integer(grossCents, 0, 1000000000), 'Total maximal dépassé.');
    return { grossCents, taxCents, netCents: grossCents - taxCents, needsPrice };
}
function recommendAppointment(appointments, drafts, minuteNow) {
    const eligible = appointments.filter(item => !drafts.some(d => d.appointmentId === item.id && d.status !== 'draft'));
    const active = eligible.filter(item => item.startMinute <= minuteNow && item.endMinute >= minuteNow);
    if (active.length) return active.length === 1 ? active[0].id : null;
    const recent = eligible.filter(item => item.endMinute < minuteNow && minuteNow - item.endMinute <= 90);
    return recent.length === 1 ? recent[0].id : null;
}
function view(state, context) {
    return { mode: 'simulation', catalog: [...(context.services || []), ...state.catalog], customers: context.customers || [], drafts: state.drafts, products: context.products,
        appointments: context.appointments, day: context.day,
        recommendedAppointmentId: recommendAppointment(context.appointments, state.drafts, context.minuteNow) };
}
function applyCommand(state, command, input, context) {
    demand(input && typeof input === 'object' && !Array.isArray(input), 'Demande invalide.');
    const now = new Date().toISOString();
    if (command === 'catalog') {
        demand(['product', 'service'].includes(input.kind) && name(input.name), 'Article ou prestation invalide.');
        let productId = null;
        if (input.kind === 'product') {
            const product = context.products.find(p => p.id === input.productId);
            demand(product, 'Produit introuvable dans ton inventaire.', 404);
            productId = product.id;
            input = { ...input, name: product.name };
        }
        demand(state.catalog.length < 500, 'Limite du catalogue pilote atteinte.');
        demand(!state.catalog.some(c => productId ? c.productId === productId : c.kind === 'service' && c.name.toLocaleLowerCase('fr') === input.name.trim().toLocaleLowerCase('fr')), 'Ce tarif existe déjà.', 409);
        const item = { id: randomUUID(), kind: input.kind, productId, name: input.name.trim(), ...pricing(input) };
        state.catalog.push(item);
        return { result: item, event: { type: 'catalog.created', item } };
    }
    if (command === 'open') {
        const appointment = input.appointmentId == null ? null : context.appointments.find(a => a.id === input.appointmentId);
        demand(input.appointmentId == null || appointment, 'Rendez-vous introuvable pour ce compte.', 404);
        // Stable appointment identity prevents duplicates, even after reconnecting.
        const existing = appointment && state.drafts.find(d => d.appointmentId === appointment.id);
        if (existing) return { result: existing };
        demand(typeof input.key === 'string' && /^[a-f0-9-]{36}$/.test(input.key), 'Clé de création manquante.');
        const retry = state.drafts.find(d => d.openKey === input.key);
        if (retry) return { result: retry };
        demand(state.drafts.length < 100, 'Limite de 100 tickets du pilote atteinte.');
        const catalog = [...(context.services || []), ...state.catalog];
        const matches = appointment?.serviceId ? catalog.filter(c => c.serviceId === appointment.serviceId) : appointment?.serviceName ? catalog.filter(c => c.kind === 'service' && c.name.toLocaleLowerCase('fr') === appointment.serviceName.toLocaleLowerCase('fr')) : [];
        const lines = appointment?.serviceName ? [{ id: randomUUID(), kind: 'service', productId: null, name: appointment.serviceName,
            quantity: 1, ...(matches.length === 1 ? pricing(matches[0]) : { unitCents: null, taxBps: null, taxMode: null }) }] : [];
        const customer = (context.customers || []).find(c => c.id === (input.customerId || appointment?.customerId));
        demand(input.customerId == null || customer, 'Cliente introuvable dans ce compte.', 404);
        const draft = { id: randomUUID(), openKey: input.key, appointmentId: appointment?.id || null, customerId: customer?.id || null, clientName: customer?.name || appointment?.clientName || 'Vente sans rendez-vous',
            appointmentTime: appointment?.startTime || null, status: 'draft', version: 1, lines, createdAt: now, updatedAt: now, totals: totals(lines) };
        state.drafts.push(draft);
        return { result: draft, event: { type: 'draft.created', draft: structuredClone(draft) } };
    }
    const draft = state.drafts.find(d => d.id === input.draftId);
    demand(draft, 'Ticket introuvable.', 404);
    if (command === 'simulate' && draft.status === 'simulated') {
        demand(input.key === draft.checkoutKey, 'Ticket déjà validé en simulation.', 409);
        return { result: draft };
    }
    demand(draft.status === 'draft', 'Ce ticket est figé. Une nouvelle opération est nécessaire.', 409);
    demand(input.version === draft.version, 'Ticket modifié dans un autre onglet. Recharge-le.', 409);
    if (command === 'customer') {
        const customer = (context.customers || []).find(c => c.id === input.customerId);
        demand(customer, 'Cliente introuvable dans ce compte.', 404);
        draft.customerId = customer.id; draft.clientName = customer.name;
    } else if (command === 'add') {
        const item = [...(context.services || []), ...state.catalog].find(c => c.id === input.catalogId);
        demand(item, 'Tarif introuvable.', 404);
        demand(draft.lines.length < 100, 'Maximum 100 lignes par ticket.');
        const current = draft.lines.find(l => l.catalogId === item.id);
        if (current) { demand(current.quantity < 100, 'Maximum 100 unités.'); current.quantity++; }
        else draft.lines.push({ ...item, id: randomUUID(), catalogId: item.id, quantity: 1 });
    } else if (command === 'line') {
        const line = draft.lines.find(l => l.id === input.lineId);
        demand(line, 'Ligne introuvable.', 404);
        demand(integer(input.quantity, 0, 100), 'Quantité invalide.');
        if (input.quantity === 0) draft.lines = draft.lines.filter(l => l.id !== line.id);
        else { line.quantity = input.quantity; if (input.unitCents !== undefined) Object.assign(line, pricing(input)); }
    } else if (command === 'simulate') {
        demand(typeof input.key === 'string' && /^[a-f0-9-]{36}$/.test(input.key), 'Clé de validation manquante.');
        demand(draft.lines.length && !totals(draft.lines).needsPrice, 'Complète les prix et la TVA avant de continuer.');
        demand(['card', 'cash', 'other'].includes(input.method), 'Mode de règlement invalide.');
        const sum = totals(draft.lines);
        demand(input.method !== 'cash' || integer(input.tenderedCents, sum.grossCents, 1000000000), 'Montant reçu insuffisant.');
        // Stock checked for UX only. This pilot NEVER changes production inventory.
        for (const line of draft.lines.filter(l => l.kind === 'product')) {
            const available = context.products.find(p => p.id === line.productId);
            const required = draft.lines.filter(l => l.productId === line.productId).reduce((n, l) => n + l.quantity, 0);
            demand(available && available.quantity >= required, `Stock insuffisant : ${line.name}.`, 409);
        }
        draft.status = 'simulated'; draft.checkoutKey = input.key;
        draft.simulation = { label: 'SIMULATION — AUCUN ENCAISSEMENT — SANS VALEUR FISCALE', method: input.method,
            tenderedCents: input.method === 'cash' ? input.tenderedCents : sum.grossCents,
            changeCents: input.method === 'cash' ? input.tenderedCents - sum.grossCents : 0, validatedAt: now };
    } else throw new CaisseError('Opération inconnue.', 404);
    draft.totals = totals(draft.lines); draft.updatedAt = now; draft.version++;
    return { result: draft, event: { type: command === 'simulate' ? 'simulation.frozen' : 'draft.changed', draft: structuredClone(draft) } };
}
module.exports = { CaisseError, initialState, applyCommand, totals, recommendAppointment, view };
