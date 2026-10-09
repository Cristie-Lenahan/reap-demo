import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCompletedExample } from '../backend/example.mjs';
test('completed example whitelists receipt data and rejects incomplete or mismatched orders', async t => {
 const dir=await mkdtemp(join(tmpdir(),'kampawng-example-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.json');
 const receipt={checkoutId:'checkout-fixture',orderId:'order-fixture',currency:'SGD',finalCents:4390,simulationRequested:true,nextAction:{url:'https://private.invalid'},secret:'do-not-publish'};
 const state={care:{checkout:{id:'checkout-fixture',status:'COMPLETED'},receipt,selection:{name:'Cat food',variant:{name:'2kg'}},owner:'private-owner'}};
 await writeFile(path,JSON.stringify(state));const example=await loadCompletedExample(path);assert.equal(example.readOnly,true);assert.equal(example.receipt.hostedPaymentApprovalExercised,false);assert.doesNotMatch(JSON.stringify(example),/private|secret|nextAction/);
 for(const status of ['PROCESSING','REQUIRES_ACTION']){state.care.checkout.status=status;await writeFile(path,JSON.stringify(state));assert.equal(await loadCompletedExample(path),null);}
 state.care.checkout.status='COMPLETED';state.care.receipt.needsReconciliation=true;await writeFile(path,JSON.stringify(state));assert.equal(await loadCompletedExample(path),null);
});
