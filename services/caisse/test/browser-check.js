// Optional owned-app UI test: set PLAYWRIGHT_MODULE to an installed Playwright package.
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const { startDemo } = require('./demo-server');
async function main() {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const demo = await startDemo();
    let browser;
    try {
        browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(demo.url);
        await page.locator('#client_card').getByText('Camille Martin').waitFor();
        await page.waitForFunction(() => !document.querySelector('#checkout').disabled);
        assert.match(await page.locator('#grand_total').innerText(), /55,00/);
        const output = path.join(__dirname, '../test-output'); await mkdir(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        await page.getByRole('button', { name: 'Ajouter Huile cuticules', exact: false }).click();
        await page.waitForFunction(() => document.querySelector('#grand_total').textContent.includes('67,00'));
        await page.locator('#checkout').click();
        await page.getByRole('radio', { name: 'Espèces' }).check();
        await page.locator('#cash_amount').fill('70');
        assert.match(await page.locator('#change_due').innerText(), /3,00/);
        await page.locator('#payment_dialog').getByRole('button', { name: 'Fermer' }).click();
        await page.locator('#checkout').click();
        assert.equal(await page.locator('#cash_amount').evaluate(el => el.required), false);
        await page.getByRole('button', { name: 'Confirmer la simulation' }).click();
        await page.waitForFunction(() => document.querySelector('#draft_status').textContent === 'Simulation figée');
        assert.equal(await page.locator('#checkout').isDisabled(), true);
        const workspace = await page.evaluate(async () => (await fetch('/api/caisse/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json());
        assert.equal(workspace.products.find(p => p.id === 1).quantity, 12);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        await page.locator('#appointments_dialog[open]').waitFor();
        await page.getByRole('button', { name: /11:30 · Léa Dubois/ }).click();
        await page.waitForFunction(() => !document.querySelector('#checkout').disabled);
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No mobile horizontal overflow');
        await page.locator('#mobile_cart').click();
        await page.locator('#checkout').click();
        await page.getByRole('radio', { name: 'Espèces' }).check();
        await page.locator('#cash_amount').fill('50');
        await page.getByRole('button', { name: 'Confirmer la simulation' }).click();
        await page.waitForFunction(() => document.querySelector('#ticket_note').textContent.includes('5,00'));
        // The real inventory read remains visible even when the cashier service is unavailable.
        await page.route('**/api/caisse/workspace', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Service indisponible"}' }));
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Service caisse indisponible'));
        assert.match(await page.locator('#inventory_status').innerText(), /2 produit/);
        assert.match(await page.locator('#catalog').innerText(), /Huile cuticules/);
        assert.match(await page.locator('#catalog').innerText(), /Stock : 12/);
        assert.equal(await page.locator('#new_sale').isDisabled(), true);
        assert.equal(await page.locator('#new_catalog').isDisabled(), true);
        assert.equal(await page.locator('#checkout').isDisabled(), true);
        await page.locator('#search').fill('Crème');
        assert.equal(await page.locator('#catalog .item-card').count(), 1);
        assert.equal(await page.locator('#catalog .item-card').isDisabled(), true);
        assert.deepEqual(errors, []);
        console.log('UI desktop/mobile: prefill, product, totals, payment reset, freeze, stock unchanged, cash change and overflow checks passed.');
    } finally { if (browser) await browser.close(); await demo.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
