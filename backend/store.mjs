import { mkdir, readFile, rename, rm, open } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { AdapterError, fail } from './client.mjs';
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// One store owns the directory exclusively. An orphan lock after a crash fails closed;
// recovery requires checking the durable operations, not blindly deleting/retrying.
export class DurableStore {
  #dir; #tail = Promise.resolve(); data;
  constructor(dir) { this.#dir = dir; }
  async open() {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    try { await mkdir(join(this.#dir, '.writer-lock'), { mode: 0o700 }); } catch { fail('STORE_ALREADY_OWNED', 503); }
    try { this.data = JSON.parse(await readFile(join(this.#dir, 'state.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') { await this.close(); fail('STORE_INVALID', 503); } this.data = { version: 1, operations: {}, care: null }; }
    if (this.data.version !== 1 || !this.data.operations || typeof this.data.operations !== 'object') { await this.close(); fail('STORE_INVALID', 503); }
    for (const op of Object.values(this.data.operations)) if (op.state === 'DISPATCHING') op.state = 'UNCERTAIN';
    await this.save(); return this;
  }
  async save() {
    const next = join(this.#dir, `.state-${randomUUID()}.next`);
    const file = await open(next, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(this.data)); await file.sync(); } finally { await file.close(); }
    await rename(next, join(this.#dir, 'state.json'));
    const dir = await open(this.#dir, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
  async close() { await this.#tail.catch(() => {}); await rm(join(this.#dir, '.writer-lock'), { recursive: true, force: true }); }
  exclusive(fn) { const result = this.#tail.then(fn); this.#tail = result.catch(() => {}); return result; }
  // Called only within exclusive(). No automatic retry, even with a retained key:
  // resource-less uncertainty requires manual reconciliation before another POST.
  async mutation(name, body, send, normalize) {
    const hash = digest(body); let op = this.data.operations[name];
    if (op) {
      if (op.hash !== hash) fail('OPERATION_BODY_CHANGED');
      if (op.state === 'COMPLETE') return structuredClone(op.result);
      if (op.state === 'REJECTED') throw new AdapterError(op.code || 'OPERATION_REJECTED');
      fail('RESULT_UNCERTAIN');
    }
    op = this.data.operations[name] = { key: randomUUID(), hash, state: 'DISPATCHING', createdAt: new Date().toISOString() };
    await this.save(); // UUID/body hash and intent lock precede the network side effect.
    try {
      const raw = await send(op.key);
      // A successful POST with an invalid shape can still have created a resource.
      let result; try { result = normalize(raw); } catch { throw new AdapterError('INVALID_PROVIDER_RESPONSE', 502, true); }
      op.state = 'COMPLETE'; op.result = result; await this.save(); return structuredClone(result);
    } catch (error) {
      op.state = error instanceof AdapterError && !error.uncertain ? 'REJECTED' : 'UNCERTAIN';
      op.code = error instanceof AdapterError ? error.code : 'RESULT_UNCERTAIN';
      await this.save(); throw error instanceof AdapterError ? error : new AdapterError('RESULT_UNCERTAIN', 502, true);
    }
  }
}
