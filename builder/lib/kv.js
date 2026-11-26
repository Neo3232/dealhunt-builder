// Tiny key-value helper. With CF_API_TOKEN set it talks to Cloudflare KV; otherwise it uses the folder KV_DIR (local tests).
import fs from 'node:fs'; import path from 'node:path';
const T = process.env.CF_API_TOKEN, A = process.env.CF_ACCOUNT_ID, N = process.env.CF_KV_ID;
const DIR = process.env.KV_DIR || '/tmp/kvlocal';
const url = (k) => `https://api.cloudflare.com/client/v4/accounts/${A}/storage/kv/namespaces/${N}/values/${encodeURIComponent(k)}`;
export const remote = Boolean(T && A && N);
const STATE = process.env.STATE_DIR; // when set: job state lives in plain files (kept between runs by the workflow cache), KV is only read, never written
const REMOTE_ONLY = new Set(['reports', 'geo-v2']); // written by the Worker, so always read live
const sf = (k) => path.join(STATE, encodeURIComponent(k));
const KC = process.env.KV_CACHE; // within one job run, remember what we just wrote (KV reads can lag a write by up to a minute)
const kcf = (k) => path.join(KC, encodeURIComponent(k));
async function getRemote(k) {
  const r = await fetch(url(k), { headers: { Authorization: `Bearer ${T}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`kv get ${k}: ${r.status}`);
  return await r.text();
}
export async function get(k) {
  if (STATE && remote) {
    if (REMOTE_ONLY.has(k)) return await getRemote(k);
    try { return fs.readFileSync(sf(k), 'utf8'); } catch { /* not saved locally yet: read KV once */ }
    const t = await getRemote(k);
    if (t !== null) { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(sf(k), t); }
    return t;
  }
  if (KC && remote) { try { return fs.readFileSync(kcf(k), 'utf8'); } catch { /* not written in this run */ } }
  if (!remote) { try { return fs.readFileSync(path.join(DIR, encodeURIComponent(k)), 'utf8'); } catch { return null; } }
  const r = await fetch(url(k), { headers: { Authorization: `Bearer ${T}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`kv get ${k}: ${r.status}`);
  return await r.text();
}
// Writes only when the value changed (the free plan allows 1,000 writes a day).
export async function put(k, text) {
  if (STATE && remote) {
    const old = await get(k).catch(() => null);
    if (old === text) return false;
    fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(sf(k), text); return true;
  }
  const old = await get(k).catch(() => null);
  if (old === text) { if (KC && remote) { try { fs.mkdirSync(KC, { recursive: true }); fs.writeFileSync(kcf(k), text); } catch { /* ignore */ } } return false; }
  if (KC && remote) { fs.mkdirSync(KC, { recursive: true }); }
  if (!remote) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, encodeURIComponent(k)), text); return true; }
  for (let t = 0; t < 3; t++) {
    const r = await fetch(url(k), { method: 'PUT', headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'text/plain' }, body: text });
    if (r.ok) { if (KC) fs.writeFileSync(kcf(k), text); return true; }
    if (t === 2) throw new Error(`kv put ${k}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise((ok) => setTimeout(ok, 2000 * (t + 1)));
  }
}
export const getJSON = async (k) => { const t = await get(k); try { return t ? JSON.parse(t) : null; } catch { return null; } };
export const putJSON = (k, o) => put(k, JSON.stringify(o));
