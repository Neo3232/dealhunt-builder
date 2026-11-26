// Shared sale checks (Steam price API and IsThereAnyDeal), used by the deeper feed. Same logic as in feedall.js.
const UA = 'DealHunt/1.0 (+https://deal-hunt-mu.vercel.app)';
// Steam rows are checked against Steam's own US price (keyless, 50 apps per call): an offer Steam says has no discount is dropped (CheapShark keeps
// listing it after the sale ends), and the price is taken from Steam when the two differ. Rows Steam cannot answer for are kept as they are.
export async function verifySteam(rows, budgetMs) {
  const apps = [...new Set(rows.filter((d) => d.s === '1' && d.a).map((d) => d.a))];
  const info = new Map();
  const t0 = Date.now();
  for (let i = 0; i < apps.length; i += 50) {
    if (Date.now() - t0 > budgetMs) break;
    try {
      const r = await fetch(`https://store.steampowered.com/api/appdetails?cc=us&filters=price_overview&appids=${apps.slice(i, i + 50).join(',')}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) break;
      const j = await r.json();
      for (const a of apps.slice(i, i + 50)) { const e = j && j[a]; if (e && e.success && e.data && e.data.price_overview && e.data.price_overview.currency === 'USD') info.set(a, e.data.price_overview); }
    } catch { break; }
    await new Promise((ok) => setTimeout(ok, 700));
  }
  let dropped = 0, fixed = 0;
  const out = [];
  for (const d of rows) {
    const p = d.s === '1' && d.a ? info.get(d.a) : null;
    if (!p) { out.push(d); continue; }
    if (!(p.discount_percent >= 1)) { dropped++; continue; }
    const fin = p.final / 100, ini = p.initial / 100;
    if (Math.abs(fin - d.p) > 0.005) { fixed++; out.push({ ...d, p: fin, r: ini, v: p.discount_percent }); } else out.push(d);
  }
  return { rows: out, dropped, fixed, checked: info.size };
}
// Second opinion from IsThereAnyDeal (key kept in the ITAD_KEY environment variable, server side only). For each offer it knows about, ITAD says
// whether that store currently has a sale (Steam rows are skipped: Steam's own price API is the source of truth there, ITAD missed 24 real Steam sales in testing). An offer is dropped when ITAD shows no discount at that store (seen within 45 days and not newer on
// CheapShark's side) or when ITAD says the sale already ended. Offers ITAD does not list, or cannot answer for, are kept.
const ITAD_SHOP = { 2: 24, 3: 36, 7: 35, 13: 62, 15: 6, 21: 64, 23: 20, 25: 16, 27: 29, 30: 42, 35: 15 };
export async function verifyItad(rows, budgetMs) {
  const key = process.env.ITAD_KEY;
  if (!key) return { rows, dropped: 0 };
  const t0 = Date.now();
  const jpost = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
  const apps = [...new Set(rows.filter((d) => d.a).map((d) => d.a))];
  const idOf = new Map();
  for (let i = 0; i < apps.length; i += 200) {
    if (Date.now() - t0 > budgetMs) return { rows, dropped: 0 };
    const j = await jpost(`https://api.isthereanydeal.com/lookup/id/shop/61/v1?key=${key}`, apps.slice(i, i + 200).map((a) => 'app/' + a));
    for (const k of Object.keys(j)) if (j[k]) idOf.set(k.slice(4), j[k]);
  }
  const ids = [...new Set(idOf.values())];
  const deals = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    if (Date.now() - t0 > budgetMs) return { rows, dropped: 0 };
    const j = await jpost(`https://api.isthereanydeal.com/games/prices/v3?key=${key}&country=US&capacity=0`, ids.slice(i, i + 100));
    for (const g of j) { const m = new Map(); for (const x of g.deals || []) m.set(x.shop.id, x); deals.set(g.id, m); }
  }
  const now = Date.now(), out = [];
  let dropped = 0;
  for (const d of rows) {
    const id = d.a ? idOf.get(String(d.a)) : null, sh = ITAD_SHOP[d.s];
    const x = id && sh ? (deals.get(id) || new Map()).get(sh) : null;
    if (!x) { out.push(d); continue; }
    const ts = Date.parse(x.timestamp) || 0, ex = x.expiry ? Date.parse(x.expiry) : 0;
    const ended = ex && ex < now;
    const noSale = x.cut === 0 && ts > now - 45 * 86400000 && !(d.lc && d.lc * 1000 > ts + 6 * 3600000);
    if (ended || noSale) dropped++; else out.push(d);
  }
  return { rows: out, dropped };
}
