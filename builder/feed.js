// Full rebuild of the main price list: all 48 CheapShark pages, one per second, Steam price check, then publish.
import { URLS, slim, selfCheck, UA } from './lib/feed-parts.js';
import { verifySteam, verifyItad } from './lib/verify.js';
import { getJSON, putJSON } from './lib/kv.js';
import { publish } from './lib/publish.js';
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const saved = await getJSON('feed-v2');
const pt = saved && saved.pt.length === URLS.length ? saved.pt.slice() : new Array(URLS.length).fill(0);
let deals = saved && saved.pt.length === URLS.length ? saved.deals : [];
const fresh = new Map(); let blocked429 = 0;
for (let i = 0; i < URLS.length; i++) {
  let done = false;
  for (let t = 0; t < 4 && !done; t++) {
    try {
      const r = await fetch(URLS[i], { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { blocked429++; await sleep(45000 * (t + 1)); continue; }
      if (r.ok) { const rows = await r.json(); if (Array.isArray(rows)) { fresh.set(i, rows.map((d) => slim(d, i))); done = true; } }
      else await sleep(3000);
    } catch { await sleep(3000); }
  }
  await sleep(1000);
}
console.log('pages fetched', fresh.size, 'of', URLS.length, 'rate-limit hits', blocked429);
if (fresh.size >= 30) {
  let add = [...fresh.values()].flat();
  const v = await verifySteam(add, 240000); add = v.rows; console.log('steam check', v.checked, 'dropped', v.dropped, 'fixed', v.fixed);
  try { add = (await verifyItad(add, 60000)).rows; } catch { /* no second opinion */ }
  deals = deals.filter((d) => !fresh.has(d.x)).concat(add);
  const now = Date.now(); for (const i of fresh.keys()) pt[i] = now;
  const chk = selfCheck(deals, pt);
  await putJSON('feed-v2', { at: pt.every((t) => t) ? Math.min(...pt) : 0, pt, na: 0, deals, chk });
  console.log('check', JSON.stringify(chk));
} else console.log('too few pages, keeping the old file');
console.log('publish', JSON.stringify(await publish()));
