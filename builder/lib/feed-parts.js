const UA = 'DealHunt/1.0 (+https://deal-hunt-mu.vercel.app)';
const BASE = 'https://www.cheapshark.com/api/1.0/deals?onSale=1&pageSize=60';
const STORE_PAIRS = [[1, 2], [3, 7], [13, 15], [21, 23], [25, 27], [30, 35]];
const KEY = 'deal-hunt/feed-v2.json';
const CHUNK = 16; // pages per call
const SPACING_MS = 1000;
const REFRESH_MS = 90 * 60 * 1000; // a page older than this is due (keeps uploads inside the free 2,000 a month: 3 per cycle)
const GAP_MS = 3 * 1000; // minimum time between two chunks
const BLOCK_MS = 10 * 60 * 1000; // pause after CheapShark says 429

function allUrls() {
  const urls = [];
  for (let i = 0; i < 12; i++) urls.push(`${BASE}&sortBy=DealRating&pageNumber=${i}`);
  for (const pair of STORE_PAIRS) for (const s of pair) for (let p = 0; p < 3; p++) urls.push(`${BASE}&storeID=${s}&sortBy=Metacritic&pageNumber=${p}`);
  return urls;
}
const URLS = allUrls();
const slim = (d, x) => ({
  g: d.gameID, t: d.title, s: d.storeID, p: Number(d.salePrice), r: Number(d.normalPrice), v: Math.round(Number(d.savings) || 0), d: d.dealID,
  q: Number(d.dealRating) || 0, m: Number(d.metacriticScore) || 0, sp: Number(d.steamRatingPercent) || 0, sc: Number(d.steamRatingCount) || 0,
  st: d.steamRatingText || null, a: Number(d.steamAppID) || null, lc: Number(d.lastChange) || 0, x,
});
const ITAD_SHOP = { 2: 24, 3: 36, 7: 35, 13: 62, 15: 6, 21: 64, 23: 20, 25: 16, 27: 29, 30: 42, 35: 15 };
// Self check that runs inside every rebuild, no one has to start it: the list must be well formed, so every card can name one store and one Buy target.
function selfCheck(deals, pt) {
  const noDeal = deals.filter((d) => !d.d || typeof d.d !== 'string').length;
  const badPrice = deals.filter((d) => !Number.isFinite(d.p) || d.p < 0).length;
  const badStore = deals.filter((d) => !ITAD_SHOP[d.s] && !['1', '5', '8', '11', '31', '28'].includes(String(d.s)) && !d.s).length;
  const steamNoApp = deals.filter((d) => d.s === '1' && !d.a).length; // Buy falls back to the CheapShark redirect to the Steam row for these
  const dup = deals.length - new Set(deals.map((d) => d.d)).size;
  const complete = pt.every((t) => t);
  return { at: Date.now(), complete, rows: deals.length, games: new Set(deals.map((d) => d.g)).size, noDeal, badPrice, badStore, steamNoApp, dup, ok: complete && noDeal === 0 && badPrice === 0 && badStore === 0 };
}

export { URLS, slim, selfCheck, UA };
