const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const success of [true, false]) {
    test(`login ${success ? 'opens dashboard without consulting cashier status' : 'failure never redirects'}`, async () => {
        let click;
        const requests = [], destinations = [], alerts = [];
        const button = { disabled: false, addEventListener: (event, handler) => { click = handler; } };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/js/connexion.js'), 'utf8'), {
            document: { getElementById: id => id === 'validation_form' ? button : { value: 'test-only' } },
            fetch: async url => { requests.push(url); return { ok: success, json: async () => success ? {} : { error: 'Connexion impossible.' } }; },
            window: { location: { assign: url => destinations.push(url) } },
            alert: message => alerts.push(message)
        });
        await click({ preventDefault() {} });
        assert.deepEqual(requests, ['/api/auth/login']);
        assert.deepEqual(destinations, success ? ['/dashboard/'] : []);
        assert.equal(alerts.length, success ? 0 : 1);
        assert.equal(button.disabled, false);
    });
}
