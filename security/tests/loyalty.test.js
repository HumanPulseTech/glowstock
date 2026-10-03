const test=require('node:test');
const assert=require('node:assert/strict');
const {money}=require('../../integrations/loyalty');
test('loyalty uses integer cents and rejects malformed monetary input',()=>{assert.equal(money('12,50'),1250);assert.throws(()=>money('-1'),/montant/i);});
test('loyalty automatic rewards refuse the simulation mode',async()=>{const loyalty=require('../../integrations/loyalty');const prior=process.env.CAISSE_MODE;delete process.env.CAISSE_MODE;try{await assert.rejects(loyalty.applyRealSale({}, {userId:1,customerId:1,saleId:'sale',grossCents:100}),/bloquée/i);}finally{if(prior===undefined)delete process.env.CAISSE_MODE;else process.env.CAISSE_MODE=prior;}});
