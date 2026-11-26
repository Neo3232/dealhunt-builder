// Per-country exact prices: GOG (USD per country) and Steam editions/bundles (Steam's own currency), for the countries the site offers.
import { getJSON, putJSON } from './lib/kv.js';
import gog from './lib/gog.js';
import bundles from './lib/bundles.js';
const CC = (process.env.COUNTRIES || 'us,gb,de,fr,es,it,nl,be,at,ch,se,no,dk,fi,pl,cz,ro,hu,gr,pt,ie,tr,ru,ua,eg,sa,ae,kw,qa,bh,om,jo,lb,ma,dz,tn,il,in,pk,bd,id,ph,th,vn,my,sg,hk,tw,cn,jp,kr,au,nz,ca,mx,br,ar,cl,co,pe,za,ng,ke').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const sv = await getJSON('feed-v2'); const deep = await getJSON('feed-deep');
globalThis.__FEED_ROWS = [...(sv ? sv.deals : []), ...(deep ? deep.deals : [])];
console.log('feed rows', globalThis.__FEED_ROWS.length, 'countries', CC.length);
const run = async (h, req) => { let out = null, st = 200; await h(req, { setHeader() {}, status(c) { st = c; return this; }, json(o) { out = o; return this; }, send(o) { out = o; return this; } }); return st === 200 ? out : null; };
let wg = 0, wb = 0, fails = 0;
for (const cc of CC) {
  const g = await run(gog, { url: `/api/gog?cc=${cc}`, headers: {}, query: { cc } });
  if (g && g.m) { if (await putJSON('gog:' + cc, g)) wg++; } else fails++;
  const b = await run(bundles, { url: `/api/bundles?cc=${cc}`, headers: {}, query: { cc } });
  if (b && b.b) { if (await putJSON('bnd:' + cc, b)) wb++; } else fails++;
}
console.log('written gog', wg, 'bundles', wb, 'failed', fails);
