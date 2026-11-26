// Builds the one file the site serves for /api/feedall (main list + deep rows, merged) plus its self check, from the two saved states.
import { getJSON, putJSON } from './kv.js';
export async function publish() {
  const sv = await getJSON('feed-v2'); const deep = await getJSON('feed-deep');
  if (!sv || !Array.isArray(sv.deals) || !sv.pt.every((t) => t) || sv.deals.length < 1500) return { ok: false };
  let deals = sv.deals;
  if (deep && Array.isArray(deep.deals) && deep.deals.length) { const have = new Set(deals.map((d) => d.d)); deals = deals.concat(deep.deals.filter((d) => !have.has(d.d))); }
  const out = { at: Math.min(...sv.pt), partial: false, deals };
  const w1 = await putJSON('feedall-out', out);
  await putJSON('feedall-chk', { rebuildCheck: sv.chk || null, listAt: Math.min(...sv.pt) });
  await putJSON('deep-chk', { pages: deep ? deep.pt.length : 0, done: deep ? deep.pt.filter((t) => t).length : 0, rows: deep ? deep.deals.length : 0, oldest: deep ? Math.min(...deep.pt.filter((t) => t)) : null });
  return { ok: true, rows: deals.length, written: w1 };
}
