// Cloudflare Worker: serves the site files (assets) and the /api routes. Heavy work (price list rebuild, per-country GOG/Steam bundles) is done
// by the refresh job and stored in KV, so this Worker only reads and streams. Cron triggers start the refresh job on GitHub Actions.
import cs from './cs.js';
import steamc from './steamc.js';
import gamepage from './gamepage.js';

const J = { 'content-type': 'application/json' };
const json = (o, status = 200, cc = 'no-store') => new Response(JSON.stringify(o), { status, headers: { ...J, 'cache-control': cc } });

// Run a Vercel-style (req, res) handler.
function node(handler) {
  return async (request) => {
    const url = new URL(request.url);
    const req = { url: url.pathname + url.search, method: request.method, headers: Object.fromEntries(request.headers), query: Object.fromEntries(url.searchParams) };
    let status = 200, body = '';
    const h = new Headers();
    const res = { setHeader: (k, v) => h.set(k, v), status(c) { status = c; return res; }, json(o) { h.set('content-type', 'application/json'); body = JSON.stringify(o); return res; }, send(b) { body = b; return res; }, end(b) { body = b || ''; return res; } };
    await handler(req, res);
    return new Response(body, { status, headers: h });
  };
}
// Answer from the edge cache when the route allows it (Cache-Control s-maxage), otherwise compute and keep it.
async function cached(request, ctx, make) {
  const cache = caches.default; const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key); if (hit) return hit;
  const res = await make();
  if (res.status === 200 && /s-maxage=\d+/.test(res.headers.get('cache-control') || '')) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
async function kvStream(env, key, cc) {
  const body = await env.KV.get(key, 'stream');
  if (!body) return null;
  return new Response(body, { status: 200, headers: { ...J, 'cache-control': cc } });
}
const WEEK = 7 * 86400000;
function blockVerdict(e, cc) {
  if (!e) return 'x' + cc;
  if (e === 'w') return 'b' + cc;
  const tag = e[0];
  const list = (e.slice(1).match(/.{2}/g)) || [];
  if (tag === 'b' || tag === 'x') return list.includes(cc) ? e : e + cc;
  if (tag === 'a') { const kept = list.filter((c) => c !== cc).join(''); return kept ? 'a' + kept : 'b' + cc; }
  return list.includes(cc) ? 'x' + cc : e;
}
async function geo(env) {
  let j2 = null; try { j2 = JSON.parse((await env.KV.get('geo-v2')) || 'null'); } catch { /* none */ }
  const CC = 'public, max-age=30, s-maxage=60, must-revalidate';
  if (!(j2 && j2.s)) return json({ at: 0, v: [], l: {} }, 200, CC);
  try {
    const rep = JSON.parse((await env.KV.get('reports')) || '{}'); const now = Date.now();
    for (const k of Object.keys(rep || {})) {
      const e = rep[k];
      if (!e || !e.s || !e.g || !e.cc || now - e.at > WEEK) continue;
      for (const cc of Object.keys(e.cc)) {
        if (e.cc[cc] < 3) continue;
        const m = j2.s[e.s] || (j2.s[e.s] = {});
        const nb = blockVerdict(m[e.g], cc);
        if (nb === undefined) delete m[e.g]; else m[e.g] = nb;
      }
    }
  } catch { /* reports are best effort */ }
  return json({ at: j2.at || 0, v: [], l: {}, s: j2.s }, 200, CC);
}
async function report(request, env) {
  let all = {}; try { all = JSON.parse((await env.KV.get('reports')) || '{}') || {}; } catch { all = {}; }
  const now = Date.now(); const url = new URL(request.url);
  const save = () => env.KV.put('reports', JSON.stringify(all));
  if (request.method === 'POST') {
    let body = null; try { body = await request.json(); } catch { body = null; }
    if (body && body.k === 'chk') {
      const n = Math.min(9999, Number(body.n) || 0);
      const gs = Array.isArray(body.g) ? body.g.filter((x) => typeof x === 'string' && /^\d{1,10}$/.test(x)).slice(0, 5) : [];
      const c = all.__chk && now - all.__chk.at < WEEK ? all.__chk : { n: 0, at: now, g: [] };
      if (c.n < 50 && n > 0) { all.__chk = { n: c.n + 1, at: c.at, last: now, bad: n, g: gs }; try { await save(); } catch { /* ignore */ } }
      return json({ ok: true });
    }
    const d = body && body.d;
    if (typeof d !== 'string' || !/^[A-Za-z0-9%._~+=-]{16,90}$/.test(d)) return json({ error: 'bad id' }, 400);
    const st = body && typeof body.s === 'string' && /^\d{1,3}$/.test(body.s) ? body.s : null;
    const gid = body && typeof body.g === 'string' && /^\d{1,10}$/.test(body.g) ? body.g : null;
    const cc = body && typeof body.c === 'string' && /^[A-Z]{2}$/.test(body.c) ? body.c : null;
    const cur = all[d] && now - all[d].at < WEEK ? all[d] : { n: 0, at: now };
    if (cur.n < 8 && Object.keys(all).length < 600) {
      const next = { n: cur.n + 1, at: cur.n ? cur.at : now };
      if (cur.s || st) next.s = cur.s || st;
      if (cur.g || gid) next.g = cur.g || gid;
      const ccn = Object.assign({}, cur.cc || {}); if (cc) ccn[cc] = (ccn[cc] || 0) + 1; if (Object.keys(ccn).length) next.cc = ccn;
      all[d] = next;
      for (const k of Object.keys(all)) if (k !== '__chk' && now - all[k].at > WEEK) delete all[k];
      try { await save(); } catch { /* the report still counts for this visit */ }
    }
    return json({ ok: true });
  }
  if (url.searchParams.get('check')) return json({ browserFailures: all.__chk || null });
  const hidden = Object.keys(all).filter((k) => k !== '__chk' && all[k].n >= 3 && now - all[k].at < WEEK);
  return json({ hidden }, 200, 'public, max-age=30, s-maxage=60');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url); const p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (p === '/api/country') { const c = request.cf && request.cf.country; return json({ country: typeof c === 'string' && /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null }, 200, 'private, no-store'); }
      if (p === '/api/report') return await report(request, env);
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method' }, 405);
      if (p === '/api/geo') return await cached(request, ctx, () => geo(env));
      if (p === '/api/feedall') {
        if (url.searchParams.get('check')) return (await kvStream(env, 'feedall-chk', 'no-store')) || json({ rebuildCheck: null, listAt: null });
        return await cached(request, ctx, async () => (await kvStream(env, 'feedall-out', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300')) || json({ error: 'building' }, 503));
      }
      if (p === '/api/feeddeep') return (await kvStream(env, 'deep-chk', 'no-store')) || json({ pages: 0, done: 0, rows: 0 });
      if (p === '/api/gog' || p === '/api/bundles') {
        const cc = String(url.searchParams.get('cc') || '').toUpperCase();
        if (!/^[A-Z]{2}$/.test(cc)) return json({ error: 'bad country' }, 400);
        return await cached(request, ctx, async () => (await kvStream(env, (p === '/api/gog' ? 'gog:' : 'bnd:') + cc, 'public, max-age=300, s-maxage=3600, stale-while-revalidate=7200')) || json({ error: 'not ready' }, 502));
      }
      if (p === '/api/cs') return await cached(request, ctx, () => node(cs)(request));
      if (p === '/api/steamc') return await cached(request, ctx, () => node(steamc)(request));
      if (p === '/api/gamepage') return await cached(request, ctx, () => node(gamepage)(request));
      return json({ error: 'not found' }, 404);
    } catch { return json({ error: 'failed' }, 502); }
  },
  // Cron triggers only start the refresh job on GitHub Actions (the heavy work does not fit the free Worker limits).
  async scheduled(event, env, ctx) {
    const job = event.cron === env.CRON_DEEP ? 'deep' : event.cron === env.CRON_COUNTRY ? 'country' : event.cron === env.CRON_STEAM ? 'steam' : 'feed';
    if (!env.GH_TOKEN || !env.GH_REPO) return;
    const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/refresh.yml/dispatches`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'deal-hunt-cron', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main', inputs: { job } }),
    });
    if (!r.ok) console.log('dispatch failed', r.status);
  },
};
