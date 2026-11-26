// Exact GOG prices for one country, read from GOG's own public catalog for that country (GOG sets a USD price per country).
// Returns only discounted games as { normalizedTitle: [finalUsd, baseUsd] }. The CDN keeps each country for an hour.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
async function page(cc, p) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(`https://catalog.gog.com/v1/catalog?limit=100&page=${p}&countryCode=${cc}&locale=en-US&order=desc:discount&discounted=eq:true`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await new Promise((k) => setTimeout(k, 400));
  }
  return null;
}
export default async function handler(req, res) {
  const cc = String((req.url || '').split('cc=')[1] || '').slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) { res.status(400).json({ error: 'bad country' }); return; }
  const first = await page(cc, 1);
  if (!first || !first.pages) { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ error: 'upstream unavailable' }); return; }
  const pages = [first];
  const todo = []; for (let p = 2; p <= first.pages; p++) todo.push(p);
  let bad = false;
  for (let i = 0; i < todo.length; i += 15) {
    const got = await Promise.all(todo.slice(i, i + 15).map((p) => page(cc, p)));
    for (const g of got) { if (g) pages.push(g); else bad = true; }
  }
  if (bad) { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ error: 'incomplete' }); return; }
  // Keep only games the price list carries a GOG offer for (the feed is small and cached), so the answer stays small.
  let want = null;
  try {
    const fr = { ok: true, json: async () => ({ deals: globalThis.__FEED_ROWS || [] }) };
    const fj = fr.ok ? await fr.json() : null;
    if (fj && Array.isArray(fj.deals)) want = new Set(fj.deals.filter((d) => String(d.s) === '7').map((d) => norm(d.t)));
  } catch { /* fall back to everything */ }
  const m = {};
  const e = []; // editions and packs on sale that the price list does not carry from GOG yet (GOG's exact price for this country, in USD)
  const EDITION = /edition|ultimate|deluxe|gold|complete|premium|definitive|goty|game of the year|collector|collection|anniversary|platinum|legendary|bundle/i;
  const SKIP = /standard edition|soundtrack|\bost\b|art ?book|wallpaper|season pass|dlc|expansion pass|upgrade/i;
  const seenE = new Set();
  for (const pg of pages) for (const p of pg.products || []) {
    if ((p.productType === 'game' || p.productType === 'pack') && p.slug && (p.productType === 'pack' || EDITION.test(p.title)) && !SKIP.test(p.title) && !seenE.has(p.slug)) {
      const f2 = p.price && p.price.finalMoney, b2 = p.price && p.price.baseMoney;
      if (f2 && b2 && f2.currency === 'USD' && b2.currency === 'USD' && Number(b2.amount) > Number(f2.amount) && Number(f2.amount) > 0 && (!want || !want.has(norm(p.title)))) {
        seenE.add(p.slug);
        e.push({ s: p.slug, n: p.title, f: Number(f2.amount), b: Number(b2.amount), img: p.coverHorizontal || null, r: Number(p.reviewsRating) || 0, k: p.productType === 'pack' ? 1 : 0 });
      }
    }
    const f = p.price && p.price.finalMoney, b = p.price && p.price.baseMoney;
    if (!f || !b || f.currency !== 'USD' || b.currency !== 'USD') continue;
    const fa = Number(f.amount), ba = Number(b.amount);
    if (!(ba > fa) || !(fa >= 0)) continue;
    const k = norm(p.title); if (k && !m[k] && (!want || want.has(k))) m[k] = [fa, ba];
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({ cc, at: Date.now(), m, e });
}
