import { verifyItad } from './verify.js';
const UA = 'DealHunt/1.0 (+https://deal-hunt-mu.vercel.app)';
const STORES = [2, 3, 13, 15, 21, 23, 25, 27, 30, 35];
const PAGES = 12; // pages of 60 per store, best deal rating first
const KEY = 'deal-hunt/feed-deep.json';
const CHUNK = 16, SPACING_MS = 1000, REFRESH_MS = 9 * 3600 * 1000, BLOCK_MS = 15 * 60 * 1000;
const EDITION = /edition|ultimate|deluxe|gold|complete|premium|definitive|goty|game of the year|collector|collection|anniversary|platinum|legendary|bundle/i;
const SKIP = /standard edition|soundtrack|\bost\b|art ?book|wallpaper|season pass|\bdlc\b|expansion pass|upgrade/i;
const URLS = [];
for (const s of STORES) for (let p = 0; p < PAGES; p++) URLS.push(`https://www.cheapshark.com/api/1.0/deals?onSale=1&pageSize=60&storeID=${s}&sortBy=DealRating&pageNumber=${p}`);
const slim = (d, x) => ({
  g: d.gameID, t: d.title, s: d.storeID, p: Number(d.salePrice), r: Number(d.normalPrice), v: Math.round(Number(d.savings) || 0), d: d.dealID,
  q: Number(d.dealRating) || 0, m: Number(d.metacriticScore) || 0, sp: Number(d.steamRatingPercent) || 0, sc: Number(d.steamRatingCount) || 0,
  st: d.steamRatingText || null, a: Number(d.steamAppID) || null, lc: Number(d.lastChange) || 0, x,
});
const keep = (d) => d && d.gameID && d.dealID && EDITION.test(d.title || '') && !SKIP.test(d.title || '') && Number(d.savings) >= 1 && Number(d.salePrice) >= 0;
// Most edition rows from non-Steam stores carry no Steam app id, so the site would have no picture for them. Find the base game on Steam by name
// (keyless store search) and keep its id as `ar`, used ONLY for the picture; it never changes a price or a Buy link.
const STRIP = /\b(digital|standard|ultimate|deluxe|gold|complete|premium|definitive|goty|game of the year|collector'?s?|collection|anniversary|platinum|legendary|edition|bundle|pack|the|directors? cut)\b/g;
const nk = (t) => String(t || '').toLowerCase().replace(/['\u2019]/g, '').replace(STRIP, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '');
async function resolveArt(rows, ax, budgetMs) {
  const t0 = Date.now();
  const need = [...new Set(rows.filter((d) => !d.a).map((d) => nk(d.t)))].filter((k) => k.length >= 4 && ax[k] === undefined);
  const title = new Map(rows.map((d) => [nk(d.t), String(d.t).replace(/\b(digital|standard|ultimate|deluxe|gold|complete|premium|definitive|edition|bundle|pack)\b/gi, ' ').replace(/\s+/g, ' ').trim()]));
  for (let i = 0; i < need.length; i += 8) {
    if (Date.now() - t0 > budgetMs) break;
    await Promise.all(need.slice(i, i + 8).map(async (k) => {
      try {
        const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title.get(k))}&cc=us&l=en`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return;
        const j = await r.json();
        const hit = (j.items || []).find((it) => it.type === 'app' && nk(it.name) === k);
        ax[k] = hit ? hit.id : 0;
      } catch { /* try again next time */ }
    }));
  }
  return rows.map((d) => (!d.a && ax[nk(d.t)] ? { ...d, ar: ax[nk(d.t)] } : d));
}

export { URLS, slim, keep, resolveArt, UA, REFRESH_MS };
