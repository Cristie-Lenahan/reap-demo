import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DemoSessions} from '../backend/sessions.mjs';
import {createProtectedHandler} from '../backend/public-http.mjs';
const client={enabled:true,request:async()=>{throw Error('No provider call expected');}};
const secret='fixture-browser-session-signing-secret';
async function setup(t,maxSessions=100){const directory=await mkdtemp(join(tmpdir(),'kampawng-sessions-'));let manager=await new DemoSessions({directory,secret,client,maxSessions}).open();t.after(async()=>{await manager.close();await rm(directory,{recursive:true,force:true});});return {get manager(){return manager;},async restart(){await manager.close();manager=await new DemoSessions({directory,secret,client,maxSessions}).open();}};}
const request=(cookie,method='GET')=>({method,url:method==='GET'?'/api/status':'/api/reap',headers:{cookie}});
test('browsers get isolated signed sessions, own owner mappings, stable reloads and durable restart',async t=>{
 const f=await setup(t);const a=request(),b=request();const [aa,bb]=await Promise.all([f.manager.resolve(a),f.manager.resolve(b)]);
 const [av,bv]=await Promise.all([aa.action('view'),bb.action('view')]);assert.equal(av.receipt,null);assert.equal(bv.receipt,null);
 assert.notEqual(aa.store.data.care.id,bb.store.data.care.id);assert.notEqual(aa.store.data.care.owner.id,bb.store.data.care.owner.id);
 assert.match(a.demoSessionCookie,/HttpOnly; Secure; SameSite=Lax/);const cookie=a.demoSessionCookie.split(';')[0];
 assert.equal(await f.manager.resolve(request(cookie)),aa);const ownerId=aa.store.data.care.owner.id;
 await f.restart();const restored=await f.manager.resolve(request(cookie,'POST'));assert.equal(restored.store.data.care.owner.id,ownerId);
 await assert.rejects(f.manager.resolve(request(cookie+'tamper','POST')),e=>e.code==='DEMO_SESSION_REQUIRED');
 await assert.rejects(f.manager.resolve(request(undefined,'POST')),e=>e.code==='DEMO_SESSION_REQUIRED');
});
test('durable session cap remains enforced after restart',async t=>{const f=await setup(t,1);await f.manager.resolve(request());await assert.rejects(f.manager.resolve(request()),e=>e.code==='DEMO_CAPACITY_REACHED');await f.restart();await assert.rejects(f.manager.resolve(request()),e=>e.code==='DEMO_CAPACITY_REACHED');});
test('public shop needs signed cart cookie, rejects other origins, and returns only its own snapshot',async t=>{
 const f=await setup(t);const api=createProtectedHandler(req=>f.manager.resolve(req),{accessCode:secret,publicSessions:true});
 async function call({method='GET',cookie,origin='https://reap-demo.kampawng.com',body={action:'view',input:{}}}={}){const req={method,url:method==='GET'?'/api/status':'/api/reap',headers:{host:'reap-demo.kampawng.com',origin,cookie,'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};const response={writeHead(status,headers){this.status=status;this.headers=headers;return this;},end(body){this.body=JSON.parse(body);}};await api(req,response);return response;}
 assert.equal((await call({method:'POST'})).status,401);const boot=await call();assert.equal(boot.status,200);assert.equal(boot.body.authenticated,true);assert.equal(boot.body.receipt,null);const cookie=boot.headers['set-cookie'].split(';')[0];
 const view=await call({method:'POST',cookie});assert.equal(view.status,200);assert.equal(view.body.enrollment,null);assert.equal((await call({method:'POST',cookie,origin:'https://attacker.invalid'})).status,403);
 assert.equal((await call({method:'POST',cookie,body:{action:'search',input:{query:'anything else'}}})).status,400);
 assert.equal((await call({method:'POST',cookie:cookie+'tampered'})).status,401);
});

test('cookie signing migration preserves only pre-existing carts and expires its old signer',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'kampawng-migration-'));let now=Date.now();let manager=await new DemoSessions({directory,secret,client,now:()=>now}).open();
 t.after(async()=>{await manager.close();await rm(directory,{recursive:true,force:true});});
 const original=request();const backend=await manager.resolve(original);await backend.action('view');const owner=backend.store.data.care.owner.id;const oldCookie=original.demoSessionCookie.split(';')[0];await manager.close();
 manager=await new DemoSessions({directory,secret:'new-private-server-only-signing-secret',legacySecret:secret,client,now:()=>now}).open();
 const retry=request(oldCookie);assert.equal((await manager.resolve(retry)).store.data.care.owner.id,owner);assert.ok(retry.demoSessionCookie);assert.notEqual(retry.demoSessionCookie.split(';')[0],oldCookie);
 const fresh=request();await manager.resolve(fresh);const token=fresh.demoSessionCookie.split('=')[1].split(';')[0];const [id,expiry]=token.split('.');
 const {createHmac}=await import('node:crypto');const forged=`kampawng_cart=${id}.${expiry}.${createHmac('sha256',secret).update(`${id}.${expiry}`).digest('base64url')}`;
 await assert.rejects(manager.resolve(request(forged,'POST')),e=>e.code==='DEMO_SESSION_REQUIRED');now+=8*3600000;
 await assert.rejects(manager.resolve(request(oldCookie,'POST')),e=>e.code==='DEMO_SESSION_REQUIRED');
});
