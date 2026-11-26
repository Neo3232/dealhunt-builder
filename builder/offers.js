// Store offers per game (what the card window and live price check show), saved as one KV blob and split into one static file per game on export.
import { getJSON, putJSON } from './lib/kv.js';
const sv = await getJSON('feed-v2'); const deep = await getJSON('feed-deep');
const rows = [...(sv ? sv.deals : []), ...(deep ? deep.deals : [])];
const ids = [...new Set(rows.map((d) => String(d.g)).filter((g) => /^\d{1,10}$/.test(g)))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function batch(part) {
  const qs = `ids=${part.join(',')}`;
  for (let t = 0; t < 4; t++) {
    for (const u of [`https://www.cheapshark.com/api/1.0/games?${qs}`, `https://game-price-tracker-proxy.vercel.app/api/cheapshark?endpoint=games&${qs}`]) {
      try {
        const r = await fetch(u, { headers: { 'User-Agent': 'DealHunt/1.0 (+https://deal-hunt-mu.vercel.app)', Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
        if (r.ok) { const j = await r.json(); if (j && typeof j === 'object' && !Array.isArray(j)) return j; }
      } catch { /* try next */ }
    }
    await sleep(10000 * (t + 1));
  }
  return null;
}
const old = (await getJSON('offers')) || {}; const out = {}; let fail = 0;
for (let p = 0; p < ids.length; p += 25) {
  const part = ids.slice(p, p + 25); const j = await batch(part);
  if (!j) { fail++; for (const id of part) if (old[id]) out[id] = old[id]; continue; }
  for (const id of part) { const v = j[id]; if (v && Array.isArray(v.deals)) out[id] = { info: v.info, cheapestPriceEver: v.cheapestPriceEver, deals: v.deals.map((d) => ({ storeID: d.storeID, dealID: d.dealID, price: d.price, retailPrice: d.retailPrice, savings: d.savings })) }; else if (old[id]) out[id] = old[id]; }
  await sleep(1200);
}
console.log('offers games', Object.keys(out).length, 'of', ids.length, 'failed batches', fail);
if (Object.keys(out).length > ids.length * 0.5) console.log('offers saved', await putJSON('offers', out)); else console.log('too few, not saved');
