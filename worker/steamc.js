// Cached front door for Steam regional prices (per country, per batch of games). Prices move slowly, so the CDN keeps each answer 15 minutes.
const UP = 'https://game-price-tracker-proxy.vercel.app/api/steam';
export default async function handler(req, res) {
  const qs = String(req.url || '').split('?')[1] || '';
  if (qs.length > 3000 || !/^[A-Za-z0-9,=&_.%+-]*$/.test(qs)) { res.status(400).json({ error: 'bad query' }); return; }
  try {
    const r = await fetch(`${UP}?${qs}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
    const body = await r.text();
    if (r.status === 429) { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Retry-After', r.headers.get('retry-after') || '120'); res.status(429).send(body); return; }
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', r.ok ? 'public, max-age=120, s-maxage=900, stale-while-revalidate=1800' : 'no-store');
    res.status(r.ok ? 200 : r.status).send(body);
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ error: 'upstream unavailable' }); }
}
