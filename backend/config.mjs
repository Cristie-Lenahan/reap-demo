import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
export const privateDir = '/home/amk1/.config/kampawng-reap-demo';
export async function loadConfig() {
  const values = Object.fromEntries((await readFile(`${privateDir}/reap-sandbox.env`, 'utf8')).split(/\r?\n/).filter(x => /^[A-Z_]+=/.test(x)).map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]; }));
  if (!values.REAP_API_KEY || values.REAP_BASE_URL !== 'https://sg.sandbox.api.reap.global' || values.REAP_VERSION !== '2025-02-14') throw new Error('INVALID_SANDBOX_CONFIGURATION');
  let accessCode;
  try { accessCode = (await readFile(`${privateDir}/demo-access-code`, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; accessCode = randomBytes(18).toString('base64url'); await writeFile(`${privateDir}/demo-access-code`, accessCode + '\n', { mode: 0o600, flag: 'wx' }); }
  if (accessCode.length < 20) throw new Error('INVALID_DEMO_ACCESS_CODE');
  let sessionSecret;
  try { sessionSecret = (await readFile(`${privateDir}/browser-session-secret`, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; sessionSecret = randomBytes(32).toString('base64url'); await writeFile(`${privateDir}/browser-session-secret`, sessionSecret + '\n', { mode: 0o600, flag: 'wx' }); }
  if (sessionSecret.length < 40) throw new Error('INVALID_SESSION_SECRET');
  return { apiKey: values.REAP_API_KEY, accessCode, sessionSecret };
}
