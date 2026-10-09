import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DurableStore } from './store.mjs';
import { DemoBackend } from './workflow.mjs';
import { fail } from './client.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class DemoSessions {
  constructor({ directory, secret, legacySecret, client, now = () => Date.now(), maxSessions = 100 }) {
    this.directory = directory; this.secret = secret; this.client = client; this.now = now; this.maxSessions = maxSessions;
    this.legacySecret = legacySecret; this.legacyIds = new Set(); this.legacyUntil = 0;
    this.entries = new Map(); this.known = new Set(); this.created = []; this.tail = Promise.resolve();
  }
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) if(uuid.test(name)) this.known.add(name);
    if(this.legacySecret) {
      const path = join(this.directory,'.signing-migration.json'); let migration;
      try { migration = JSON.parse(await readFile(path,'utf8')); }
      catch(error) { if(error.code !== 'ENOENT') throw error; migration = { ids:[...this.known], until:this.now()+8*3600000 }; await writeFile(path,JSON.stringify(migration),{mode:0o600,flag:'wx'}); }
      this.legacyIds = new Set(migration.ids.filter(id=>uuid.test(id))); this.legacyUntil = migration.until;
    }
    return this;
  }
  sign(value) { return createHmac('sha256',this.secret).update(value).digest('base64url'); }
  validCookie(request) {
    const token = request.headers.cookie?.match(/(?:^|;\s*)kampawng_cart=([A-Za-z0-9_.-]+)/)?.[1]; if(!token) return null;
    const [id, expiry, signature, extra] = token.split('.'); const expected = this.sign(`${id}.${expiry}`);
    if(extra || !uuid.test(id || '') || !signature || Number(expiry) <= this.now() || Number(expiry) > this.now() + 8*3600000) return null;
    if(signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) {
      if(!this.legacySecret || !this.legacyIds.has(id) || this.now() >= this.legacyUntil) return null;
      const old = createHmac('sha256',this.legacySecret).update(`${id}.${expiry}`).digest('base64url');
      if(signature.length !== old.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(old))) return null;
      const value = `${id}.${expiry}`;
      request.demoSessionCookie = `kampawng_cart=${value}.${this.sign(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.max(1,Math.floor((Number(expiry)-this.now())/1000))}`;
    }
    return id;
  }
  resolve(request) {
    const result = this.tail.then(() => this.resolveOne(request)); this.tail = result.catch(()=>{}); return result;
  }
  async resolveOne(request) {
    let id = this.validCookie(request);
    if(!id || !this.known.has(id)) {
      if(request.method !== 'GET' || request.url !== '/api/status') fail('DEMO_SESSION_REQUIRED',401);
      this.created = this.created.filter(t=>t > this.now()-60000);
      if(this.created.length >= 12 || this.known.size >= this.maxSessions) fail('DEMO_CAPACITY_REACHED',429);
      id = randomUUID(); this.created.push(this.now()); this.known.add(id);
      const expiry = String(this.now()+8*3600000); const value = `${id}.${expiry}`;
      request.demoSessionCookie = `kampawng_cart=${value}.${this.sign(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`;
    }
    let entry = this.entries.get(id);
    if(!entry) {
      const store = await new DurableStore(join(this.directory,id)).open();
      entry = { store, backend: new DemoBackend({ store, client: this.client, uniqueOwners: true, simulateCompleted: true }), recent: [] };
      this.entries.set(id,entry);
    }
    if(request.method === 'POST') {
      entry.recent = entry.recent.filter(t=>t > this.now()-60000);
      if(entry.recent.length >= 30) fail('RATE_LIMITED',429);
      entry.recent.push(this.now());
    }
    return entry.backend;
  }
  async close() { await this.tail; await Promise.all([...this.entries.values()].map(e=>e.store.close())); }
}
