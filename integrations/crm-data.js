class InputError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
function priceCents(value, optional = true) {
    if (value == null || String(value).trim() === '') {
        if (optional) return null;
        throw new InputError('Le prix de la prestation est obligatoire.');
    }
    const text = String(value).trim().replace(',', '.');
    if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(text)) throw new InputError('Prix invalide : utilisez au maximum deux décimales.');
    const [whole, fraction = ''] = text.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (cents > 1000000) throw new InputError('Prix maximal : 10 000 €.');
    return cents;
}
function field(value, max, required = false) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new InputError('Un champ est manquant ou trop long.');
    return value.trim();
}
function customerInput(input = {}) {
    const result = { name: field(input.name, 150, true), email: field(input.email, 254), phone: field(input.phone, 40), address: field(input.address, 500), notes: field(input.notes, 2000) };
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new InputError('Adresse e-mail invalide.');
    return result;
}
function serviceInput(input = {}) {
    const result = { name: field(input.name, 150, true), priceCents: priceCents(input.price, false), description: field(input.description, 2000), duration: Number(input.duration), taxMode: input.taxMode, taxBps: Number(input.taxBps) };
    if (!Number.isInteger(result.duration) || result.duration < 5 || result.duration > 480) throw new InputError('Durée attendue : de 5 à 480 minutes.');
    if (!['vat', 'exempt'].includes(result.taxMode) || ![0, 550, 1000, 2000].includes(result.taxBps) || (result.taxMode === 'exempt' && result.taxBps !== 0)) throw new InputError('Sélectionnez explicitement la TVA ou l’exonération.');
    if (!Array.isArray(input.productIds) || input.productIds.length > 100 || input.productIds.some(id => !Number.isSafeInteger(id) || id < 1)) throw new InputError('Articles associés invalides.');
    result.productIds = [...new Set(input.productIds)]; return result;
}
async function productPrices(pool, userId) {
    try { return new Map((await pool.query('SELECT product_id, price_cents FROM product_prices WHERE id_user = ?', [userId])).map(r => [Number(r.product_id), r.price_cents == null ? null : Number(r.price_cents)])); }
    catch (e) { if (e.code === 'ER_NO_SUCH_TABLE') return new Map(); throw e; }
}
async function saveProductPrice(connection, userId, productId, cents) {
    await connection.query('INSERT INTO product_prices (product_id, id_user, price_cents) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE price_cents = VALUES(price_cents)', [productId, userId, cents]);
}
async function crmContext(pool, userId) {
    try {
        const [customers, services, links] = await Promise.all([
            pool.query('SELECT id, name FROM crm_customers WHERE id_user = ? ORDER BY name LIMIT 1001', [userId]),
            pool.query('SELECT id, name, price_cents, tax_mode, tax_bps FROM crm_services WHERE id_user = ? ORDER BY name LIMIT 501', [userId]),
            pool.query('SELECT l.appointment_id, l.customer_id, l.service_id FROM crm_appointment_links l JOIN planning_entries p ON p.id = l.appointment_id AND p.id_user = l.id_user WHERE l.id_user = ?', [userId])
        ]);
        if (customers.length > 1000 || services.length > 500) throw new InputError('Limite du pilote clientes/prestations atteinte.', 503);
        return { customers: customers.map(c => ({ id: Number(c.id), name: c.name })), services: services.map(s => ({ id: `service-${s.id}`, serviceId: Number(s.id), kind: 'service', productId: null, name: s.name, unitCents: Number(s.price_cents), taxMode: s.tax_mode, taxBps: Number(s.tax_bps) })), links };
    } catch (e) { if (e.code === 'ER_NO_SUCH_TABLE') return { customers: [], services: [], links: [] }; throw e; }
}
module.exports = { InputError, priceCents, customerInput, serviceInput, productPrices, saveProductPrice, crmContext };
