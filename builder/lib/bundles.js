// Steam bundles / editions that are on sale (Ultimate, Deluxe, Complete, Gold ... editions sold as a Steam "bundle", which CheapShark does not list).
// For the games in the saved feed we ask Steam's own store API for every purchase option, keep the bundles that are real editions and discounted,
// and return Steam's exact price for the asked country. Currency comes from Steam for that country. The CDN keeps each country for an hour.
const API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const EDITION = /edition|ultimate|deluxe|gold|complete|premium|definitive|goty|game of the year|collector|collection|anniversary|platinum|legendary|bundle/i;
const SKIP = /standard edition|soundtrack|\bost\b|art ?book|wallpaper|season pass|dlc|expansion pass/i;
const MAX_APPS = 6;
function savedUrl() {
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN || '');
  return m ? `https://${m[1].toLowerCase()}.public.blob.vercel-storage.com/deal-hunt/feed-v2.json` : null;
}
async function feedRows() { return globalThis.__FEED_ROWS || []; }
async function feedRowsOld() {
  const u = savedUrl();
  if (!u) return [];
  try { const r = await fetch(`${u}?t=${Math.floor(Date.now() / 60000)}`, { signal: AbortSignal.timeout(5000) }); const j = await r.json(); return Array.isArray(j.deals) ? j.deals : []; } catch { return []; }
}
async function get(cc, ids, dr) {
  const J = JSON.stringify({ ids, context: { language: 'english', country_code: cc }, data_request: dr });
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(`${API}?input_json=${encodeURIComponent(J)}`, { signal: AbortSignal.timeout(9000) });
      if (r.ok) return (await r.json()).response.store_items || [];
    } catch { /* retry */ }
  }
  return null;
}
async function currencyOf(cc) {
  for (const a of [1091500, 292030, 1245620, 271590]) {
    try {
      const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${a}&cc=${cc}&filters=price_overview`, { signal: AbortSignal.timeout(6000) });
      const j = await r.json(); const p = j && j[a] && j[a].data && j[a].data.price_overview;
      if (p && /^[A-Z]{3}$/.test(p.currency)) return p.currency;
    } catch { /* next */ }
  }
  return null;
}
export default async function handler(req, res) {
  const cc = String((req.query && req.query.cc) || 'US').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) { res.status(400).json({ error: 'bad country' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const rows = await feedRows();
    if (rows.length < 500) { res.status(503).json({ error: 'feed not ready' }); return; }
    const byApp = new Map(); // appid -> best feed row (for ratings)
    for (const d of rows) if (d.a && (!byApp.has(d.a) || (d.sc || 0) > (byApp.get(d.a).sc || 0))) byApp.set(d.a, d);
    const titles = new Set(rows.filter((d) => d.a).map((d) => norm(d.t))); // only titles the site actually shows as a card (rows without a Steam app id are not shown)
    const apps = [...byApp.keys()];
    const [cur, ...pages] = await Promise.all([currencyOf(cc), ...Array.from({ length: Math.ceil(apps.length / 200) }, (_, i) => get(cc, apps.slice(i * 200, i * 200 + 200).map((a) => ({ appid: a })), { include_all_purchase_options: true }))]);
    if (!cur || pages.some((p) => !p)) { res.status(502).json({ error: 'steam unavailable' }); return; }
    const bids = new Set();
    const out = [];
    const seenPkg = new Set();
    for (const items of pages) for (const it of items) for (const p of it.purchase_options || []) {
      if (p.bundleid) { bids.add(p.bundleid); continue; }
      // An edition sold as a package on the game's own Steam page (for example "Ultimate Edition" next to the base game).
      const nm = p.purchase_option_name, f = Number(p.final_price_in_cents), w = Number(p.original_price_in_cents || 0), d = Number(p.discount_pct || 0);
      if (!p.packageid || seenPkg.has(p.packageid) || !nm || nm === it.name || !EDITION.test(nm) || SKIP.test(nm) || !(d >= 1 && w > f && f > 0) || titles.has(norm(nm))) continue;
      seenPkg.add(p.packageid);
      const r = byApp.get(it.appid) || {}, A = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + it.appid + '/';
      out.push({ i: p.packageid, k: 'sub', n: nm, f, w, d, a: it.appid, q: r.q || 0, m: r.m || 0, sp: r.sp || 0, sc: r.sc || 0, st: r.st || null, img: A + 'capsule_616x353.jpg', hdr: A + 'header.jpg' });
    }
    const ids = [...bids];
    const bp = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => get(cc, ids.slice(i * 100, i * 100 + 100).map((b) => ({ bundleid: b })), { include_all_purchase_options: true, include_assets: true })));
    if (bp.some((p) => !p)) { res.status(502).json({ error: 'steam unavailable' }); return; }
    for (const it of bp.flat()) {
      const o = it.best_purchase_option; if (!o || !it.name) continue;
      const f = Number(o.final_price_in_cents), w = Number(o.price_before_bundle_discount || o.original_price_in_cents || 0), d = Number(o.combined_discount_pct || 0);
      const inc = it.included_appids || [];
      if (!(d >= 1 && w > f && f > 0) || !EDITION.test(it.name) || SKIP.test(it.name) || !inc.length || inc.length > MAX_APPS) continue;
      if (titles.has(norm(it.name))) continue; // already listed as its own game
      const ref = inc.map((a) => byApp.get(a)).find(Boolean); if (!ref) continue;
      if (out.some((x) => x.a === ref.a && norm(x.n) === norm(it.name))) continue; // same edition already added as a package
      const as = it.assets || {}, base = as.asset_url_format ? 'https://shared.fastly.steamstatic.com/store_item_assets/' + as.asset_url_format : null;
      out.push({ i: it.id, n: it.name, f, w, d, a: ref.a, q: ref.q || 0, m: ref.m || 0, sp: ref.sp || 0, sc: ref.sc || 0, st: ref.st || null,
        img: base && as.main_capsule ? base.replace('${FILENAME}', as.main_capsule) : null, hdr: base && as.header ? base.replace('${FILENAME}', as.header) : null });
    }
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=7200');
    res.status(200).json({ cc, cur, n: out.length, b: out });
  } catch { res.status(502).json({ error: 'failed' }); }
}
