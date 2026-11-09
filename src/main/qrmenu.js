// منيو QR: خادم HTTP صغير على الشبكة المحلية يعرض المنيو (قراءة فقط) للزبون عند مسح رمز الطاولة.
// الأمان: لا يُعرض إلا بيانات منيو منقّحة (أصناف فعّالة فقط)، GET فقط، CSP صارم، حد معدل لكل عنوان، وهو معطّل افتراضياً.
const http = require('http');
const os = require('os');
const db = require('./db');
const auth = require('./auth');
const qr = require('./qr');

let server = null, listenPort = null, lastError = '';
const hits = new Map();

const cfg = () => { const s = db.get().settings; s.qrmenu ??= { enabled: false, port: 3737, showPrices: true, host: '' }; return s.qrmenu; };
const ID = /^[A-Za-z0-9-]{1,64}$/;

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
const baseUrl = () => { const c = cfg(); return `http://${c.host || lanIPs()[0] || 'localhost'}:${c.port}`; };

// ---------- بيانات المنيو العامة (منقّحة) ----------
function publicMenu(tableId) {
  const d = db.get(), c = cfg(), groups = new Map(d.modGroups.map((g) => [g.id, g]));
  const price = (v) => (c.showPrices ? v : null);
  const vis = (cid) => d.categories.some((x) => x.id === cid && x.active !== false); // التصنيف المخفي لا يظهر للزبون
  const items = d.items.filter((i) => i.active && vis(i.categoryId)).map((i) => ({
    id: i.id, name: i.name, categoryId: i.categoryId, soldOut: !!i.soldOut || ((i.variants || []).length > 0 && i.variants.every((v) => v.soldOut)), price: price(i.priceCents),
    variants: (i.variants || []).map((v) => ({ name: v.name, price: price(v.priceCents), soldOut: !!v.soldOut })), image: i.image ? `/img/${i.id}` : null,
    mods: (i.modifierGroupIds || []).map((g) => groups.get(g)).filter(Boolean).map((g) => ({ name: g.name, options: g.options.map((o) => ({ name: o.name, price: price(o.priceCents) })) })),
  }));
  const used = new Set(items.map((i) => i.categoryId));
  const t = tableId && d.tables.find((x) => x.id === tableId);
  return {
    restaurant: d.settings.restaurant, table: t ? t.name : null, showPrices: !!c.showPrices, vatPercent: Math.round((d.settings.vatRate || 0) * 100),
    categories: [...d.categories].sort((a, b) => a.sort - b.sort).filter((x) => used.has(x.id)).map(({ id, name }) => ({ id, name })), items,
  };
}

// ---------- صفحة الزبون ----------
const PAGE = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>المنيو</title><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 Tahoma,Arial,sans-serif;background:#f6f6f7;color:#111}
header{background:#111;color:#fff;padding:14px 16px;position:sticky;top:0;z-index:2}header h1{margin:0;font-size:20px}header small{opacity:.8}
nav{display:flex;gap:8px;overflow-x:auto;padding:10px 12px;background:#fff;position:sticky;top:62px;z-index:1;border-bottom:1px solid #e5e7eb}
nav button{flex:none;border:1px solid #d1d5db;background:#fff;border-radius:18px;padding:6px 14px;font:inherit}nav button.on{background:#111;color:#fff;border-color:#111}
main{padding:12px;max-width:720px;margin:0 auto}h2{font-size:18px;margin:16px 4px 8px}
.it{display:flex;gap:12px;background:#fff;border-radius:12px;padding:10px;margin-bottom:10px;box-shadow:0 1px 2px #0001}.it img{width:84px;height:84px;object-fit:cover;border-radius:8px;flex:none}
.it .b{flex:1}.it b{display:block}.pr{color:#047857;font-weight:bold}.so{opacity:.55}.tag{font-size:12px;background:#fee2e2;color:#b91c1c;border-radius:8px;padding:1px 8px}
.md{font-size:13px;color:#555;margin-top:4px}.note,.err{text-align:center;color:#666;font-size:13px;padding:12px}.err{color:#b91c1c}
</style></head><body><header><h1 id="t"></h1><small id="s"></small></header><nav id="n"></nav><main id="m"></main><div class="note" id="f"></div><script src="/menu.js"></script></body></html>`;

const SCRIPT = `(function(){
var $=function(i){return document.getElementById(i)},M=null,cat='';
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function pr(c){return (c/100).toFixed(2)+' ر.س'}
function draw(){
  $('t').textContent=M.restaurant;$('s').textContent=M.table?('طاولة '+M.table):'المنيو';document.title=M.restaurant;
  var n=$('n');n.textContent='';
  [{id:'',name:'الكل'}].concat(M.categories).forEach(function(c){var b=el('button',c.id===cat?'on':'',c.name);b.onclick=function(){cat=c.id;draw()};n.appendChild(b)});
  var m=$('m');m.textContent='';
  M.categories.filter(function(c){return !cat||c.id===cat}).forEach(function(c){
    m.appendChild(el('h2','',c.name));
    M.items.filter(function(i){return i.categoryId===c.id}).forEach(function(i){
      var d=el('div','it'+(i.soldOut?' so':''));
      if(i.image){var im=el('img');im.src=i.image;im.alt='';d.appendChild(im)}
      var b=el('div','b');b.appendChild(el('b','',i.name));
      if(i.price!==null)b.appendChild(el('span','pr',pr(i.price)));
      if(i.soldOut)b.appendChild(el('span','tag','نفد'));
      if(i.variants&&i.variants.length>1)b.appendChild(el('div','md',i.variants.map(function(v){return v.name+(v.price!==null?' ('+pr(v.price)+')':'')+(v.soldOut?' - نفد':'')}).join('، ')));
      i.mods.forEach(function(g){b.appendChild(el('div','md',g.name+': '+g.options.map(function(o){return o.name+(o.price?' (+'+pr(o.price)+')':'')}).join('، ')))});
      d.appendChild(b);m.appendChild(d)})});
  if(!M.items.length)m.appendChild(el('div','note','لا توجد أصناف حالياً'));
  $('f').textContent=(M.showPrices&&M.vatPercent)?('الأسعار لا تشمل ضريبة القيمة المضافة ('+M.vatPercent+'%)'):'';
}
function load(){
  var p=location.pathname.match(/^\\/m\\/([A-Za-z0-9-]+)/);
  fetch('/api/menu'+(p?('?t='+p[1]):''),{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){M=j;draw()}).catch(function(){if(!M)$('m').appendChild(el('div','err','تعذّر تحميل المنيو، حاول مرة أخرى'))});
}
load();setInterval(load,60000);
})();`;

// ---------- الخادم ----------
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
function send(res, code, type, body, extra = {}) { res.writeHead(code, { 'Content-Type': type, ...SEC, ...extra }); res.end(body); }

function limited(ip) {
  const now = Date.now(); let h = hits.get(ip);
  if (!h || now - h.t > 60000) { h = { t: now, n: 0 }; hits.set(ip, h); }
  if (hits.size > 2000) for (const [k, v] of hits) if (now - v.t > 60000) hits.delete(k);
  return ++h.n > 120; // 120 طلباً في الدقيقة لكل عنوان
}

function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', { Allow: 'GET, HEAD' });
    if (limited(req.socket.remoteAddress || '')) return send(res, 429, 'text/plain; charset=utf-8', 'Too Many Requests', { 'Retry-After': '60' });
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p === '/' || /^\/m\/[A-Za-z0-9-]{1,64}$/.test(p)) return send(res, 200, 'text/html; charset=utf-8', PAGE, { 'Cache-Control': 'no-store' });
    if (p === '/menu.js') return send(res, 200, 'application/javascript; charset=utf-8', SCRIPT, { 'Cache-Control': 'no-cache' });
    if (p === '/api/menu') {
      const t = u.searchParams.get('t');
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(publicMenu(t && ID.test(t) ? t : null)), { 'Cache-Control': 'no-store' });
    }
    const m = p.match(/^\/img\/([A-Za-z0-9-]{1,64})$/);
    if (m) {
      const it = db.get().items.find((i) => i.id === m[1] && i.active), im = it?.image?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
      if (im) return send(res, 200, im[1], Buffer.from(im[2], 'base64'), { 'Cache-Control': 'max-age=300' });
    }
    send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
  } catch { send(res, 500, 'text/plain; charset=utf-8', 'Error'); }
}

function stop() {
  return new Promise((ok) => {
    if (!server) return ok();
    const s = server; server = null; listenPort = null;
    s.close(() => ok()); s.closeAllConnections?.();
  });
}
function start(port) {
  return new Promise((ok, fail) => {
    const s = http.createServer(handler);
    s.requestTimeout = 10000; s.headersTimeout = 5000; s.keepAliveTimeout = 5000;
    s.once('error', (e) => { fail(e); });
    s.listen(port, '0.0.0.0', () => { server = s; listenPort = s.address().port; s.on('error', (e) => { lastError = e.message; }); ok(); });
  });
}

// يطابق حالة الخادم مع الإعدادات (يُستدعى عند الإقلاع وعند تغيير الإعدادات)
async function apply() {
  await stop(); lastError = '';
  const c = cfg();
  if (!c.enabled) return status();
  try { await start(c.port); } catch (e) { lastError = e.code === 'EADDRINUSE' ? `المنفذ ${c.port} مستخدم من برنامج آخر` : e.message; }
  return status();
}
const status = () => ({ running: !!server, port: listenPort, error: lastError });

async function setConfig(p) {
  const port = Number(p.port), host = String(p.host ?? '').trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('المنفذ يجب أن يكون بين 1024 و65535');
  if (host && !/^[A-Za-z0-9.-]{1,100}$/.test(host)) throw new Error('العنوان يجب أن يكون IP أو اسم نطاق بحروف لاتينية');
  const was = JSON.stringify(cfg());
  db.get().settings.qrmenu = { enabled: !!p.enabled, port, showPrices: p.showPrices !== false, host };
  db.save();
  auth.audit('settings', `منيو QR: ${p.enabled ? 'مفعّل' : 'معطّل'}، منفذ ${port}${host ? '، عنوان ' + host : ''}${p.showPrices === false ? '، بلا أسعار' : ''}`);
  if (was !== JSON.stringify(cfg()) || (cfg().enabled && !server)) await apply();
  return info();
}

// رموز الطاولات: رابط + SVG لكل طاولة (والمنيو العام)
function info() {
  const base = baseUrl(), c = cfg();
  const link = (name, url) => ({ name, url, svg: qr.svg(url) });
  return {
    config: { ...c }, status: status(), ips: lanIPs(), base,
    links: [link('المنيو العام', base + '/'), ...db.get().tables.map((t) => ({ id: t.id, area: t.area, ...link(t.name, `${base}/m/${t.id}`) }))],
  };
}

module.exports = { cfg, publicMenu, apply, stop, setConfig, info, status, lanIPs };
