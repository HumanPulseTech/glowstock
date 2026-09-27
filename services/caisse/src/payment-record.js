const { CaisseError } = require('./errors');

function manualPayment(input, grossCents) {
    if (!['card', 'cash', 'other'].includes(input.method)) throw new CaisseError('Mode de règlement invalide.');
    const terminalReference = typeof input.terminalReference === 'string' ? input.terminalReference.trim() : '';
    if (terminalReference.length > 80 || /[\u0000-\u001f]/.test(terminalReference)) throw new CaisseError('Référence TPE invalide.');
    return {
        provider: 'manual',
        method: input.method,
        terminalReference: terminalReference || null,
        amountCents: grossCents
    };
}

module.exports = { manualPayment };
