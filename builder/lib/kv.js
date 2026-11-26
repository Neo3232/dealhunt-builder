// Tiny key-value helper. With CF_API_TOKEN set it talks to Cloudflare KV; otherwise it uses the folder KV_DIR (local tests).
import fs from 'node:fs'; import path from 'node:path';
const T = process.env.CF_API_TOKEN, A = process.env.CF_ACCOUNT_ID, N = process.env.CF_KV_ID;
const DIR = process.env.KV_DIR || '/tmp/kvlocal';
const url = (k) => `https://api.cloudflare.com/client/v4/accounts/${A}/storage/kv/namespaces/${N}/values/${encodeURIComponent(k)}`;
export const remote = Boolean(T && A && N);
export async function get(k) {
  if (!remote) { try { return fs.readFileSync(path.join(DIR, encodeURIComponent(k)), 'utf8'); } catch { return null; } }
  const r = await fetch(url(k), { headers: { Authorization: `Bearer ${T}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`kv get ${k}: ${r.status}`);
  return await r.text();
}
// Writes only when the value changed (the free plan allows 1,000 writes a day).
export async function put(k, text) {
  const old = await get(k).catch(() => null);
  if (old === text) return false;
  if (!remote) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, encodeURIComponent(k)), text); return true; }
  for (let t = 0; t < 3; t++) {
    const r = await fetch(url(k), { method: 'PUT', headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'text/plain' }, body: text });
    if (r.ok) return true;
    if (t === 2) throw new Error(`kv put ${k}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise((ok) => setTimeout(ok, 2000 * (t + 1)));
  }
}
export const getJSON = async (k) => { const t = await get(k); try { return t ? JSON.parse(t) : null; } catch { return null; } };
export const putJSON = (k, o) => put(k, JSON.stringify(o));
