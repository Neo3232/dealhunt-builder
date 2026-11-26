// Game page extras from Steam's public store API: about text, release date, developer, screenshots, trailers, Metacritic and DLC (with Steam's own price for the asked country).
// One call per game and country, kept by the CDN for an hour. If Steam fails, the page simply hides these parts.
const strip = (h) => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|li|ul)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
async function details(id, cc, filters) {
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=${cc}&l=english${filters ? `&filters=${filters}` : ''}`, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const j = await r.json(); const o = j && j[id];
      return o && o.success ? o.data : null;
    } catch { /* retry */ }
  }
  return null;
}
export default async function handler(req, res) {
  const id = String((req.query && req.query.appid) || '').replace(/\D/g, '');
  const cc = String((req.query && req.query.cc) || 'US').toUpperCase();
  if (!id || !/^[A-Z]{2}$/.test(cc)) { res.status(400).json({ error: 'bad request' }); return; }
  const d = await details(id, cc);
  if (!d) { res.setHeader('Cache-Control', 'public, s-maxage=120'); res.status(200).json({ ok: false }); return; }
  const dlcIds = (Array.isArray(d.dlc) ? d.dlc : []).slice(0, 8);
  const dlc = (await Promise.all(dlcIds.map(async (x) => {
    const e = await details(x, cc, 'basic,price_overview');
    if (!e || !e.name) return null;
    const p = e.price_overview;
    return { id: x, name: e.name, img: e.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${x}/header.jpg`, free: !!e.is_free, price: p ? p.final_formatted || null : null, was: p && p.discount_percent > 0 ? p.initial_formatted : null, off: p ? p.discount_percent : 0 };
  }))).filter(Boolean);
  const out = {
    ok: true, name: d.name, release: d.release_date && !d.release_date.coming_soon ? d.release_date.date : null,
    short: strip(d.short_description), about: strip(d.about_the_game).slice(0, 2500),
    devs: d.developers || [], pubs: d.publishers || [], genres: (d.genres || []).map((g) => g.description).slice(0, 5),
    meta: d.metacritic ? { score: d.metacritic.score, url: d.metacritic.url || null } : null,
    recs: d.recommendations ? d.recommendations.total : null,
    shots: (d.screenshots || []).slice(0, 10).map((s) => ({ t: s.path_thumbnail, f: s.path_full })),
    movies: (d.movies || []).slice(0, 4).map((m) => ({ name: m.name, thumb: m.thumbnail, mp4: (m.mp4 && (m.mp4['480'] || m.mp4.max)) || null, webm: (m.webm && (m.webm['480'] || m.webm.max)) || null })),
    dlc, dlcTotal: Array.isArray(d.dlc) ? d.dlc.length : 0,
  };
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(out);
}
