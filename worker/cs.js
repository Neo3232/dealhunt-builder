// Cached front door for the price lookups (games by id, deals). The browser used to call the price proxy directly with no cache, so every
// visitor re-asked CheapShark for the same ~30 batches every 5 minutes. Now the CDN answers repeat questions for 5 minutes, so thousands
// of visitors cost the same upstream calls as one. Same request and same reply shape as the proxy's /api/cheapshark.
const UP = 'https://game-price-tracker-proxy.vercel.app/api/cheapshark';
export default async function handler(req, res) {
  const qs = String(req.url || '').split('?')[1] || '';
  if (qs.length > 3000 || !/^[A-Za-z0-9,=&_.%+-]*$/.test(qs)) { res.status(400).json({ error: 'bad query' }); return; }
  try {
    // CheapShark now wants a descriptive User-Agent; the shared proxy sends none, which is why it was throttled. Ask CheapShark directly first, the proxy second.
    const sp = new URLSearchParams(qs); const ep = sp.get('endpoint'); sp.delete('endpoint');
    let r = null;
    if (ep === 'games' || ep === 'deals') {
      try { r = await fetch(`https://www.cheapshark.com/api/1.0/${ep}?${sp.toString()}`, { headers: { 'User-Agent': 'DealHunt/1.0 (+https://deal-hunt-mu.vercel.app)', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); } catch { r = null; }
      if (r && !r.ok) r = null;
    }
    if (!r) r = await fetch(`${UP}?${qs}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    if (r.status === 429) { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Retry-After', r.headers.get('retry-after') || '120'); res.status(429).send(body); return; }
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', r.ok ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=900' : 'no-store');
    res.status(r.ok ? 200 : r.status).send(body);
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ error: 'upstream unavailable' }); }
}
