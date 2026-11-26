import fs from 'node:fs';
const f = fs.readdirSync('site/assets').find((n) => /^index-.*\.js$/.test(n) && fs.statSync('site/assets/' + n).size > 300000);
let s = fs.readFileSync('site/assets/' + f, 'utf8'); const orig = s; const miss = [];
const rep = (a, b, all = false) => { if (!s.includes(a)) { miss.push(a.slice(0, 50)); return; } s = all ? s.split(a).join(b) : s.replace(a, b); };
rep('fetch("/api/country",{cache:"no-store"})', 'fetch("/cdn-cgi/trace",{cache:"no-store"}).then(t=>t.text()).then(t=>{const m=/loc=([A-Z]{2})/.exec(t);const c=m&&m[1]!=="XX"&&m[1]!=="T1"?m[1]:null;return{json:async()=>({country:c})}})', true);
rep('fetch("/api/gog?cc="+e.toUpperCase())', 'fetch("/api/gog/"+e.toUpperCase())');
rep('fetch("/api/bundles?cc="+e.toUpperCase(),', 'fetch("/api/bundles/"+e.toUpperCase(),');
rep('fetch(i2+"?cc="+d+"&appids="+e,', 'fetch("/api/steam/"+String(d).toLowerCase(),');
rep('fetch(i2+"?cc="+e+"&appids="+t.join(","),', 'fetch("/api/steam/"+String(e).toLowerCase(),');
rep('fetch("/api/report",{signal:AbortSignal.timeout(6e3)})', 'fetch("/api/hidden",{signal:AbortSignal.timeout(6e3)})');
rep('const r=await fetch(_3(e),{signal:a.signal,cache:"no-store"});if(r.status===429&&(ur=Date.now()+Math.max(60,Number(r.headers.get("Retry-After"))||3600)*1e3),!r.ok)throw new Error("Price source unavailable");const n=await r.json();',
 'const n=await SG(e,a.signal);');
rep('async function Lo(e){', 'async function SG(e,sig){const one=async id=>{const r=await fetch("/api/g/"+id,{signal:sig});if(!r.ok)throw new Error("Price source unavailable");return await r.json()};if(e.startsWith("games?ids=")){const ids=e.slice(10).split(",").filter(Boolean);const o={};await Promise.all(ids.map(async id=>{try{o[id]=await one(id)}catch{}}));return o}return await one(decodeURIComponent(e.slice(9)))}async function Lo(e){');
if (miss.length) { console.log('MISSING', miss); process.exit(1); }
fs.writeFileSync('site/assets/' + f, s); console.log('patched', f, s.length - orig.length);
