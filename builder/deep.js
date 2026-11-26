// Deeper edition/bundle crawl: 120 CheapShark pages, one per second.
import { URLS, slim, keep, resolveArt, UA } from './lib/deep-parts.js';
import { verifyItad } from './lib/verify.js';
import { getJSON, putJSON } from './lib/kv.js';
import { publish } from './lib/publish.js';
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const saved = await getJSON('feed-deep');
const ok = saved && saved.pt.length === URLS.length;
const pt = ok ? saved.pt.slice() : new Array(URLS.length).fill(0);
let deals = ok ? saved.deals : []; const ax = (saved && saved.ax) || {};
const fresh = new Map(); let hits = 0;
const N = Number(process.env.LIMIT) || URLS.length;
for (let i = 0; i < N; i++) {
  let done = false;
  for (let t = 0; t < 4 && !done; t++) {
    try {
      const r = await fetch(URLS[i], { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { hits++; await sleep(45000 * (t + 1)); continue; }
      if (r.ok) { const rows = await r.json(); if (Array.isArray(rows)) { fresh.set(i, rows.filter(keep).map((d) => slim(d, i))); done = true; } } else await sleep(3000);
    } catch { await sleep(3000); }
  }
  await sleep(1000);
}
console.log('pages', fresh.size, 'of', URLS.length, 'rate-limit hits', hits);
if (fresh.size >= Math.min(60, N)) {
  let add = [...fresh.values()].flat();
  try { add = await resolveArt(add, ax, 120000); } catch { /* no picture help */ }
  try { add = (await verifyItad(add, 60000)).rows; } catch { /* keep */ }
  deals = deals.filter((d) => !fresh.has(d.x)).concat(add);
  const now = Date.now(); for (const i of fresh.keys()) pt[i] = now;
  await putJSON('feed-deep', { at: pt.every((t) => t) ? Math.min(...pt) : 0, pt, na: 0, ax, deals });
  console.log('deep rows', deals.length);
} else console.log('too few pages, keeping the old file');
console.log('publish', JSON.stringify(await publish()));
