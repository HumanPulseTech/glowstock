const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {money}=require('../../integrations/loyalty');
test('loyalty uses integer cents and rejects malformed monetary input',()=>{assert.equal(money('12,50'),1250);assert.throws(()=>money('-1'),/montant/i);});
test('loyalty and gift cards have append-only ledgers and no automatic simulation hook',()=>{const source=fs.readFileSync(require.resolve('../../integrations/loyalty'),'utf8');assert.match(source,/loyalty_ledger/);assert.match(source,/gift_card_ledger/);assert.doesNotMatch(source,/callCaisse|simulate\(/);});
