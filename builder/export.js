// Writes everything the site reads as plain static files (free and unlimited on Cloudflare), from the saved state in KV.
import fs from 'node:fs'; import path from 'node:path';
import { get, getJSON } from './lib/kv.js';
const OUT = process.env.OUT_DIR || 'site/api';
const CC = (process.env.COUNTRIES || 'us,gb,de,fr,es,it,nl,be,at,ch,se,no,dk,fi,pl,cz,ro,hu,gr,pt,ie,tr,ru,ua,eg,sa,ae,kw,qa,bh,om,jo,lb,ma,dz,tn,il,in,pk,bd,id,ph,th,vn,my,sg,hk,tw,cn,jp,kr,au,nz,ca,mx,br,ar,cl,co,za,kz,ng').split(',');
const WEEK = 7 * 86400000;
function blockVerdict(e, cc) {
  if (!e) return 'x' + cc; if (e === 'w') return 'b' + cc;
  const tag = e[0]; const list = (e.slice(1).match(/.{2}/g)) || [];
  if (tag === 'b' || tag === 'x') return list.includes(cc) ? e : e + cc;
  if (tag === 'a') { const kept = list.filter((c) => c !== cc).join(''); return kept ? 'a' + kept : 'b' + cc; }
  return list.includes(cc) ? 'x' + cc : e;
}
const w = (rel, text) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
let n = 0;
const feed = await get('feedall-out'); if (feed) { w('feedall', feed); n++; } else { console.log('no feed yet'); process.exit(1); }
const chk = await get('feedall-chk'); if (chk) w('feedall-check', chk);
const deepChk = await get('deep-chk'); if (deepChk) w('feeddeep-check', deepChk);
// geo (store block list) with the week's dead-link reports merged in, and the hidden list
const j2 = await getJSON('geo-v2'); const rep = (await getJSON('reports')) || {}; const now = Date.now();
if (j2 && j2.s) {
  for (const k of Object.keys(rep)) { const e = rep[k]; if (!e || !e.s || !e.g || !e.cc || now - e.at > WEEK) continue;
    for (const cc of Object.keys(e.cc)) { if (e.cc[cc] < 3) continue; const m = j2.s[e.s] || (j2.s[e.s] = {}); const nb = blockVerdict(m[e.g], cc); if (nb === undefined) delete m[e.g]; else m[e.g] = nb; } }
  w('geo', JSON.stringify({ at: j2.at || 0, v: [], l: {}, s: j2.s })); n++;
} else w('geo', JSON.stringify({ at: 0, v: [], l: {} }));
w('hidden', JSON.stringify({ hidden: Object.keys(rep).filter((k) => k !== '__chk' && rep[k].n >= 3 && now - rep[k].at < WEEK) }));
for (const c of CC) {
  const g = await get('gog:' + c.toUpperCase()); if (g) { w('gog/' + c.toUpperCase(), g); n++; }
  const b = await get('bnd:' + c.toUpperCase()); if (b) { w('bundles/' + c.toUpperCase(), b); n++; }
  const s = await get('st:' + c); if (s) { w('steam/' + c, s); n++; }
}
const off = await getJSON('offers'); if (off) for (const [id, v] of Object.entries(off)) { w('g/' + id, JSON.stringify(v)); n++; }
w('../_headers', '/api/*\n  Content-Type: application/json; charset=utf-8\n  Cache-Control: public, max-age=60, must-revalidate\n');
console.log('exported files', n);
