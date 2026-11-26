// Steam regional prices for every game in the list, per country, saved as one file per country (the site reads them as static files).
import { getJSON, putJSON } from './lib/kv.js';
const sv = await getJSON('feed-v2'); const deep = await getJSON('feed-deep');
const rows = [...(sv ? sv.deals : []), ...(deep ? deep.deals : [])];
const ids = [...new Set(rows.map((d) => d.a).filter((a) => Number.isInteger(a) && a > 0))].sort((a, b) => a - b);
const BASE = 'us,gb,de,fr,es,it,nl,be,at,ch,se,no,dk,fi,pl,cz,ro,hu,gr,pt,ie,tr,ru,ua,eg,sa,ae,kw,qa,bh,om,jo,lb,ma,dz,tn,il,in,pk,bd,id,ph,th,vn,my,sg,hk,tw,cn,jp,kr,au,nz,ca,mx,br,ar,cl,co,za,kz,ng';
const CC = (process.env.COUNTRIES || BASE).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function batch(cc, part) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(`https://game-price-tracker-proxy.vercel.app/api/steam?cc=${cc}&appids=${part.join(',')}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(8000 * (t + 1));
  }
  return null;
}
console.log('appids', ids.length, 'countries', CC.length);
let written = 0, failed = 0, i = 0;
async function worker() {
  while (i < CC.length) {
    const cc = CC[i++]; const out = {}; let ok = true;
    for (let p = 0; p < ids.length; p += 100) {
      const j = await batch(cc, ids.slice(p, p + 100));
      if (!j) { ok = false; break; }
      for (const [k, v] of Object.entries(j)) out[k] = v && v.success ? { success: true, data: v.data && !Array.isArray(v.data) ? { price_overview: v.data.price_overview, is_free: v.data.is_free } : [] } : { success: false };
      await sleep(400);
    }
    if (ok && Object.keys(out).length) { if (await putJSON('st:' + cc, out)) written++; } else { failed++; console.log('failed', cc); }
  }
}
await Promise.all([worker(), worker()]);
console.log('steam written', written, 'failed', failed);
