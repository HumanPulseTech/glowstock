const { CaisseError } = require('./errors');

function normalizeGiftCode(value) {
    if (typeof value !== 'string' || !/^GS-(?:[A-F0-9]{12}|[A-F0-9]{32})$/.test(value.trim().toUpperCase())) throw new CaisseError('Code de carte cadeau invalide.');
    return value.trim().toUpperCase();
}

// This is a simulation balance, derived from frozen tickets and separate corrections.
// No main-application card or financial ledger is mutated by the cashier pilot.
function giftBalance(state, context, code) {
    const card = context.giftCard;
    if (!card || card.code !== normalizeGiftCode(code) || typeof card.id !== 'string'
        || !context.tenantId || card.tenantId !== context.tenantId) throw new CaisseError('Carte cadeau introuvable dans cet établissement.', 404);
    if (card.status !== 'active') throw new CaisseError('Cette carte cadeau est désactivée ou expirée.', 409);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (card.expiresAt && (!/^\d{4}-\d{2}-\d{2}$/.test(card.expiresAt) || card.expiresAt < today)) throw new CaisseError('Cette carte cadeau est expirée.', 409);
    if (!Number.isSafeInteger(card.availableCents) || card.availableCents < 0) throw new CaisseError('Solde de carte cadeau indisponible.', 409);
    const cancelled = new Set((state.corrections || []).map(item => item.ticketId));
    const consumed = state.drafts.filter(ticket => ticket.status === 'simulated' && ticket.simulation?.giftCard?.id === card.id && !cancelled.has(ticket.id))
        .reduce((sum, ticket) => sum + ticket.simulation.giftCard.amountCents, 0);
    if (!Number.isSafeInteger(consumed) || consumed < 0) throw new CaisseError('Historique simulé incohérent.', 409);
    return { id: card.id, code: card.code, availableCents: Math.max(0, card.availableCents - consumed), realBalanceCents: card.availableCents, expiresAt: card.expiresAt || null, mode: 'simulation' };
}

function simulationRequest(input) {
    const hasCard = input.giftCardCode !== undefined && input.giftCardCode !== null && input.giftCardCode !== '';
    if (!hasCard && input.giftCardAmountCents != null && input.giftCardAmountCents !== 0) throw new CaisseError('Code de carte cadeau requis.');
    if (hasCard && (!Number.isSafeInteger(input.giftCardAmountCents) || input.giftCardAmountCents <= 0)) throw new CaisseError('Montant carte cadeau invalide.');
    return {
        version: input.version,
        method: input.method,
        terminalReference: typeof input.terminalReference === 'string' ? input.terminalReference.trim() : '',
        tenderedCents: input.method === 'cash' ? input.tenderedCents : null,
        giftCardCode: hasCard ? normalizeGiftCode(input.giftCardCode) : null,
        giftCardAmountCents: hasCard ? input.giftCardAmountCents : 0
    };
}

module.exports = { giftBalance, simulationRequest, normalizeGiftCode };
