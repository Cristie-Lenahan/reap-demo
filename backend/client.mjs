// Prepared server-only client. No environment/file loading and no implicit network activation.
export class AdapterError extends Error {
  constructor(code, status = 409, uncertain = false) { super(code); this.code = code; this.status = status; this.uncertain = uncertain; }
}
export const fail = (code, status = 409) => { throw new AdapterError(code, status); };
export function text(value, max = 250) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail('INVALID_INPUT', 400);
  return value;
}
export function strict(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('INVALID_INPUT', 400);
  return value;
}
export function cents(money) {
  if (money?.currency !== 'SGD' || typeof money.amount !== 'number' || !Number.isFinite(money.amount) || money.amount < 0) fail('INVALID_PROVIDER_MONEY', 502);
  const n = Math.round(money.amount * 100);
  if (!Number.isSafeInteger(n) || Math.abs(n / 100 - money.amount) > 0.0000001) fail('INVALID_PROVIDER_MONEY', 502);
  return n;
}
const knownErrors = new Set(['QUOTE_REPLACEMENT_REQUIRED', 'QUOTE_UNFULFILLABLE', 'IN_PROGRESS', 'UNAUTHORIZED', 'RATE_LIMITED', 'INVALID_REQUEST', 'AGENTIC_REQUEST_REJECTED', 'AGENTIC_PAYMENTS_NOT_ENABLED', 'ENROLLMENT_NOT_ACTIVE', 'QUOTE_EXPIRED', 'AGENTIC_RESOURCE_NOT_FOUND']);
const endpoints = /^\/agentic\/(?:products\/(?:search|details|variant)|quotes(?:\/[A-Za-z0-9_-]{1,160}(?:\/shipping-option)?)?|enrollments(?:\/[A-Za-z0-9_-]{1,160})?|checkouts(?:\/[A-Za-z0-9_-]{1,160})?)$/;
export class ReapClient {
  #key; #fetch; #enabled;
  constructor({ enabled = false, apiKey, fetchImpl = globalThis.fetch } = {}) { this.#enabled = enabled === true; this.#key = apiKey; this.#fetch = fetchImpl; }
  get enabled() { return this.#enabled && typeof this.#key === 'string' && !!this.#key; }
  async request(method, path, body, { idempotencyKey, simulateCompleted = false } = {}) {
    if (!this.enabled) fail('SANDBOX_DISABLED', 503); // Happens before any fetch.
    if (!['GET', 'POST'].includes(method) || !endpoints.test(path)) fail('INVALID_ENDPOINT', 400);
    if (simulateCompleted && !(method === 'POST' && path === '/agentic/checkouts')) fail('INVALID_SIMULATION', 400);
    if (idempotencyKey && !/^[A-Za-z0-9_-]{1,255}$/.test(idempotencyKey)) fail('INVALID_IDEMPOTENCY_KEY', 400);
    const headers = { authorization: `Bearer ${this.#key}`, 'Reap-Version': '2025-02-14', accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (simulateCompleted) headers['X-Simulate-Checkout'] = 'COMPLETED';
    try {
      const response = await this.#fetch(`https://sg.sandbox.api.reap.global${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
      const chunks = []; let size = 0;
      for await (const chunk of response.body || []) { size += chunk.byteLength; if (size > 1048576) { await response.body?.cancel?.().catch(() => {}); throw new AdapterError('PROVIDER_RESPONSE_TOO_LARGE', 502, method === 'POST'); } chunks.push(Buffer.from(chunk)); }
      const rawText = Buffer.concat(chunks).toString('utf8');
      if (rawText.includes(this.#key)) throw new AdapterError('INVALID_PROVIDER_RESPONSE', 502, method === 'POST');
      let data; try { data = JSON.parse(rawText); } catch { throw new AdapterError('INVALID_PROVIDER_RESPONSE', 502, method === 'POST'); }
      if (!response.ok) {
        const providerCode = data?.error?.code || data?.code;
        const code = knownErrors.has(providerCode) ? providerCode : 'PROVIDER_REQUEST_FAILED';
        throw new AdapterError(code, response.status === 401 ? 502 : response.status === 429 ? 429 : 502, method === 'POST' && (response.status >= 500 || (response.status === 409 && !['QUOTE_REPLACEMENT_REQUIRED', 'ENROLLMENT_NOT_ACTIVE', 'QUOTE_EXPIRED'].includes(code))));
      }
      return data;
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      // Never pass provider/transport error messages through: they can contain credentials.
      throw new AdapterError('PROVIDER_UNREACHABLE', 502, method === 'POST');
    }
  }
}
