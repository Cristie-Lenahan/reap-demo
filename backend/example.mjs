import { readFile } from 'node:fs/promises';
// Public, read-only evidence of an earlier synthetic order. No provider call or hosted URL.
export async function loadCompletedExample(path) {
  let state; try { state=JSON.parse(await readFile(path,'utf8')); } catch(error) { if(error.code==='ENOENT')return null; throw error; }
  const care=state.care,r=care?.receipt,c=care?.checkout;
  if(!r||c?.status!=='COMPLETED'||r.checkoutId!==c.id||r.currency!=='SGD'||!Number.isSafeInteger(r.finalCents)||r.finalCents<0||r.needsReconciliation)return null;
  for(const id of [r.checkoutId,r.orderId]) if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(id))return null;
  return {kind:'PREVIOUS_COMPLETED_SANDBOX_ORDER',readOnly:true,product:care.selection?.name||'Pet food',size:care.selection?.variant?.name||'',receipt:{checkoutId:r.checkoutId,orderId:r.orderId,finalCents:r.finalCents,currency:'SGD',completedAt:r.completedAt,simulatedCheckout:r.simulatedCheckout===true,simulationRequested:r.simulationRequested===true,hostedApprovalRequired:r.hostedApprovalRequired===true,hostedPaymentApprovalExercised:false,careLogEntries:1,needsReconciliation:false}};
}
