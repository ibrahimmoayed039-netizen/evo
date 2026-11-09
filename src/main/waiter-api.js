// واجهة تطبيق النادل (أندرويد): خادم HTTP/JSON على الشبكة المحلية. معطّل افتراضياً.
// الاتصال مشفّر دائماً (HTTPS بشهادة ذاتية يثبّت التطبيق بصمتها)، والعثور التلقائي على الكاشير عبر UDP (waiter-discovery.js).
// الأمان: دخول بالرمز السري ← رمز جلسة عشوائي (Bearer)، الصلاحيات تُفحص هنا بنفس أدوار البرنامج،
// حد معدل لكل عنوان، حجم الطلب محدود، ولا تُلمس جلسة الكاشير على الشاشة (auth.runAs).
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const orders = require('./orders');
const kitchen = require('./kitchen');
const tables = require('./tables');
const qrmenu = require('./qrmenu');
const tlsCert = require('./tls-cert');
const discovery = require('./waiter-discovery');
const { can } = require('./permissions');

let server = null, listenPort = null, lastError = '', deps = { sendToKitchen: null };
const sessions = new Map();   // token -> { userId, exp }
const hits = new Map();       // ip -> { t, n }
const loginHits = new Map();  // ip -> { t, n }
const recent = new Map();     // userId:clientId -> { p, t }  (منع تكرار الطلب عند إعادة الإرسال بعد انقطاع الشبكة)

const SESSION_MS = 12 * 3600 * 1000;
const cfg = () => { const s = db.get().settings; s.waiterApi ??= { enabled: false, port: 3838 }; return s.waiterApi; };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };
const send = (res, code, obj) => { res.writeHead(code, SEC); res.end(JSON.stringify(obj)); };
class Binary { constructor(type, buf, tag) { this.type = type; this.buf = buf; this.tag = tag; } }
const IMG = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const imgVer = new Map(); // itemId -> { src, v } : رقم نسخة الصورة (بصمة قصيرة) ليُخزَّن التطبيق الصورة ويتجدد عند تغييرها
function imageVersion(i) {
  const e = imgVer.get(i.id);
  if (e && e.src === i.image) return e.v;
  const v = crypto.createHash('sha1').update(i.image).digest('hex').slice(0, 12);
  imgVer.set(i.id, { src: i.image, v });
  return v;
}

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

function limiter(map, ip, max) {
  const now = Date.now(); let h = map.get(ip);
  if (!h || now - h.t > 60000) { h = { t: now, n: 0 }; map.set(ip, h); }
  if (map.size > 2000) for (const [k, v] of map) if (now - v.t > 60000) map.delete(k);
  return ++h.n > max;
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = []; let n = 0, big = false;
    req.on('data', (c) => { n += c.length; if (n > 65536) big = true; else chunks.push(c); });
    req.on('end', () => {
      if (big) return fail(new HttpError(413, 'الطلب كبير جداً'));
      if (!chunks.length) return ok({});
      try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); ok(j && typeof j === 'object' ? j : {}); } catch { fail(new HttpError(400, 'JSON غير صالح')); }
    });
    req.on('error', fail);
  });
}

// ---------- الجلسات ----------
function authenticate(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(m[1]); return null; }
  const u = db.get().users.find((x) => x.id === s.userId && x.active);
  if (!u || !can(u.role, 'pos')) { sessions.delete(m[1]); return null; } // عُطّل أو تغيّر دوره
  s.exp = Date.now() + SESSION_MS;
  return { token: m[1], user: u };
}
const need = (user, perm) => { if (!can(user.role, perm)) throw new HttpError(403, 'غير مصرح لك بهذا الإجراء'); };

// ---------- تحويلات للإخراج ----------
function summarize(o) {
  return {
    id: o.id, number: o.number, status: o.status, type: o.type, table: o.table, tableId: o.tableId, note: o.note || '', billAt: o.billAt,
    subtotalCents: o.subtotalCents, discountCents: o.discountCents, vatCents: o.vatCents, totalCents: o.totalCents, userName: o.userName,
    lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, sentQty: l.sentQty || 0, totalCents: l.totalCents, note: l.note || '', mods: (l.mods || []).map((m) => m.name) })),
  };
}

function publicMenu() {
  const d = db.get();
  const vis = new Set(d.categories.filter((c) => c.active !== false).map((c) => c.id));
  const groups = new Map(d.modGroups.map((g) => [g.id, g]));
  const items = d.items.filter((i) => i.active && vis.has(i.categoryId)).map((i) => {
    const variants = (i.variants || []).map((v) => ({ id: v.id, name: v.name, priceCents: v.priceCents, soldOut: !!v.soldOut, isDefault: !!v.isDefault }));
    return {
      id: i.id, name: i.name, categoryId: i.categoryId, priceCents: i.priceCents, variants, image: i.image && IMG.test(i.image) ? `/api/img/${i.id}?v=${imageVersion(i)}` : null,
      soldOut: !!i.soldOut || (variants.length > 0 && variants.every((v) => v.soldOut)),
      mods: (i.modifierGroupIds || []).map((g) => groups.get(g)).filter(Boolean).map((g) => ({
        id: g.id, name: g.name, required: !!g.required, multi: !!g.multi, options: g.options.map((o) => ({ name: o.name, priceCents: o.priceCents })),
      })),
    };
  });
  const used = new Set(items.map((i) => i.categoryId));
  return {
    restaurant: d.settings.restaurant, vatPercent: Math.round((d.settings.vatRate || 0) * 100), kitchen: kitchen.enabled(),
    categories: [...d.categories].sort((a, b) => a.sort - b.sort).filter((c) => used.has(c.id)).map((c) => ({ id: c.id, name: c.name, color: c.color || '' })),
    items,
  };
}

function floor() {
  return tables.floor().map((t) => ({
    id: t.id, name: t.name, area: t.area, seats: t.seats, status: t.status, billAt: t.billAt, seatedAt: t.seatedAt, totalCents: t.totalCents,
    orders: t.orders.map((o) => ({ id: o.id, number: o.number, totalCents: o.totalCents })),
    reservation: t.reservation ? { name: t.reservation.name, time: t.reservation.time, late: !!t.reservation.late } : null,
  }));
}

// ---------- إنشاء/إضافة طلب ----------
const cleanLine = (l) => {
  if (!l || typeof l !== 'object') throw new HttpError(400, 'سطر غير صالح');
  const it = db.get().items.find((x) => x.id === l.itemId);
  let variantId = l.variantId ? String(l.variantId) : undefined;
  if (it && (it.variants || []).length && !variantId) variantId = (it.variants.find((v) => v.isDefault) || it.variants[0]).id;
  return {
    itemId: String(l.itemId ?? ''), variantId, qty: Number(l.qty),
    mods: (Array.isArray(l.mods) ? l.mods : []).map((m) => ({ g: String(m?.g ?? ''), o: Number(m?.o) })),
    note: l.note ? String(l.note).slice(0, 100) : '',
  };
};
const keyOf = (l) => l.itemId + '|' + (l.variantId || '') + '|' + l.mods.map((m) => m.g + ':' + m.o).sort().join(',') + '|' + l.note;

async function createOrder(user, b) {
  const type = b.type === 'takeaway' ? 'takeaway' : 'dine_in';
  if (!Array.isArray(b.lines) || !b.lines.length) throw new HttpError(400, 'الطلب فارغ');
  if (b.lines.length > 60) throw new HttpError(400, 'عدد الأصناف كبير');
  let existing = null;
  if (b.orderId != null) existing = orders.get(Number(b.orderId));
  else if (type === 'dine_in' && b.tableId) { const l = orders.openByTable()[b.tableId]; if (l?.length) existing = orders.get(l[0].id); }
  if (existing) {
    if (existing.status !== 'open') throw new HttpError(409, 'الطلب مغلق (مدفوع أو ملغي)');
    if (existing.type !== type) throw new HttpError(409, 'نوع الطلب لا يطابق الطلب المفتوح');
    if (existing.discount) throw new HttpError(409, 'عليه خصم؛ أضف الأصناف من الكاشير حتى لا يضيع الخصم');
  }
  // الأسطر القديمة + الجديدة، مع دمج المتطابق (يحافظ على ما أُرسل للمطبخ سابقاً)
  const merged = (existing ? existing.lines.map((l) => ({ itemId: l.itemId, variantId: l.variantId, qty: l.qty, mods: l.mods.map((m) => ({ g: m.g, o: m.o })), note: l.note || '' })) : []);
  for (const raw of b.lines) {
    const l = cleanLine(raw), same = merged.find((x) => keyOf(x) === keyOf(l));
    if (same) same.qty += l.qty; else merged.push(l);
  }
  const saved = auth.runAs(user, () => orders.save({
    id: existing?.id, type, tableId: existing ? existing.tableId : b.tableId, table: existing ? existing.table : (b.table ? String(b.table) : ''),
    lines: merged, note: b.note !== undefined ? String(b.note) : existing?.note || '',
  }));
  let sent = false, tickets = 0, printErrors = [], sendError = null;
  if (b.send === false) sendError = null;
  else if (!kitchen.enabled()) sendError = 'لم تُعرَّف محطات مطبخ';
  else {
    try { const r = await auth.runAs(user, () => deps.sendToKitchen(saved.id)); sent = true; tickets = r.tickets.length; printErrors = r.printErrors || []; }
    catch (e) { sendError = e.message; }
  }
  return { order: summarize(orders.get(saved.id)), sent, tickets, printErrors, sendError };
}

function dedupe(user, clientId, run) {
  const key = clientId && /^[A-Za-z0-9-]{8,64}$/.test(clientId) ? user.id + ':' + clientId : null;
  if (!key) return run();
  const e = recent.get(key);
  if (e) return e.p;
  const now = Date.now();
  for (const [k, v] of recent) if (now - v.t > 600000) recent.delete(k);
  const p = run();
  recent.set(key, { p, t: now });
  p.catch(() => recent.delete(key)); // الفاشل لا يُخزَّن: إعادة المحاولة تنفَّذ فعلاً
  return p;
}

// ---------- الموجّه ----------
const ID = /^\d{1,12}$/;
async function route(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method, ip = req.socket.remoteAddress || '';
  if (limiter(hits, ip, 300)) throw new HttpError(429, 'طلبات كثيرة، انتظر قليلاً');
  if (!p.startsWith('/api/')) throw new HttpError(404, 'غير موجود');

  if (p === '/api/ping' && m === 'GET') return { app: 'restaurant-pos-waiter', version: 2, name: db.get().settings.restaurant, fp: tlsCert.load().fp };
  if (p === '/api/staff' && m === 'GET') return { staff: db.get().users.filter((x) => x.active && can(x.role, 'pos')).map((x) => ({ id: x.id, name: x.name })) };
  if (p === '/api/login' && m === 'POST') {
    if (limiter(loginHits, ip, 20)) throw new HttpError(429, 'محاولات دخول كثيرة، انتظر دقيقة');
    const b = await readBody(req);
    let user;
    try { user = auth.loginApi(String(b.id ?? ''), String(b.pin ?? '')); } catch (e) { throw new HttpError(401, e.message); }
    if (!can(user.role, 'pos')) throw new HttpError(403, 'هذا الحساب لا يملك صلاحية الطلبات');
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { userId: user.id, exp: Date.now() + SESSION_MS });
    return { token, user: { id: user.id, name: user.name, role: user.role } };
  }

  const s = authenticate(req);
  if (!s) throw new HttpError(401, 'انتهت الجلسة، سجّل الدخول من جديد');
  const user = s.user;

  if (p === '/api/logout' && m === 'POST') { sessions.delete(s.token); return { ok: true }; }
  if (p === '/api/menu' && m === 'GET') return publicMenu();
  let im = /^\/api\/img\/([A-Za-z0-9-]{1,64})$/.exec(p);
  if (im && m === 'GET') {
    const d = db.get(), it = d.items.find((x) => x.id === im[1] && x.active && d.categories.some((c) => c.id === x.categoryId && c.active !== false));
    const mt = it?.image && IMG.exec(it.image);
    if (!mt) throw new HttpError(404, 'لا توجد صورة');
    return new Binary(mt[1], Buffer.from(mt[2], 'base64'), imageVersion(it));
  }
  if (p === '/api/tables' && m === 'GET') { need(user, 'tables'); return { tables: floor() }; }

  if (p === '/api/orders' && m === 'POST') {
    const b = await readBody(req);
    return dedupe(user, b.clientId, () => createOrder(user, b));
  }
  let r = /^\/api\/orders\/(\d+)(?:\/(send|bill))?$/.exec(p);
  if (r && ID.test(r[1])) {
    const id = Number(r[1]);
    if (!r[2] && m === 'GET') return { order: summarize(orders.get(id)) };
    if (r[2] === 'send' && m === 'POST') {
      if (!kitchen.enabled()) throw new HttpError(409, 'لم تُعرَّف محطات مطبخ');
      const out = await auth.runAs(user, () => deps.sendToKitchen(id));
      return { sent: true, tickets: out.tickets.length, printErrors: out.printErrors || [], order: summarize(orders.get(id)) };
    }
    if (r[2] === 'bill' && m === 'POST') { need(user, 'tables'); const o = auth.runAs(user, () => orders.requestBill(id, true)); return { order: summarize(o) }; }
  }
  if (p === '/api/ready' && m === 'GET') {
    const out = kitchen.board().filter((t) => t.status === 'ready').map((t) => ({
      id: t.id, orderId: t.orderId, orderNumber: t.orderNumber, tableLabel: t.tableLabel, type: t.type, stationName: t.stationName, readyAt: t.readyAt,
      items: t.items.map((i) => ({ name: i.name, qty: i.qty })),
    }));
    return { tickets: out };
  }
  r = /^\/api\/tickets\/(\d+)\/served$/.exec(p);
  if (r && m === 'POST') { auth.runAs(user, () => kitchen.bump(Number(r[1]), 'done')); return { ok: true }; }
  throw new HttpError(404, 'غير موجود');
}

async function handler(req, res) {
  try {
    const out = await route(req, res);
    if (out instanceof Binary) {
      res.writeHead(200, { 'X-Content-Type-Options': 'nosniff', 'Content-Type': out.type, 'Content-Length': out.buf.length, 'Cache-Control': 'private, max-age=86400', ETag: `"${out.tag}"`, 'Content-Security-Policy': "default-src 'none'" });
      res.end(out.buf);
    } else send(res, 200, out);
  }
  catch (e) {
    const code = e instanceof HttpError ? e.status : 400; // أخطاء المنطق (نفد، خيار إجباري...) رسائلها عربية صالحة للعرض
    try { send(res, code, { error: e.message || 'خطأ' }); } catch { /* الاتصال أُغلق */ }
  }
}

// ---------- التشغيل ----------
async function stop() {
  sessions.clear();
  await discovery.stop();
  await new Promise((ok) => {
    if (!server) return ok();
    const s = server; server = null; listenPort = null;
    s.close(() => ok()); s.closeAllConnections?.();
  });
}
function start(port) {
  return new Promise((ok, fail) => {
    const c = tlsCert.load();
    const s = https.createServer({ key: c.key, cert: c.cert, minVersion: 'TLSv1.2' }, handler);
    s.on('tlsClientError', () => { /* اتصال غير مشفّر أو إصدار قديم: يُرفض بصمت */ });
    s.requestTimeout = 15000; s.headersTimeout = 5000; s.keepAliveTimeout = 5000;
    s.once('error', fail);
    s.listen(port, '0.0.0.0', () => { server = s; listenPort = s.address().port; s.on('error', (e) => { lastError = e.message; }); ok(); });
  });
}
const status = () => ({ running: !!server, port: listenPort, error: lastError });
async function apply() {
  await stop(); lastError = '';
  const c = cfg();
  if (!c.enabled) return status();
  try { await start(c.port); } catch (e) { lastError = e.code === 'EADDRINUSE' ? `المنفذ ${c.port} مستخدم من برنامج آخر` : e.message; return status(); }
  await discovery.start(c.discoveryPort || discovery.DEFAULT_PORT, () => ({ name: db.get().settings.restaurant, port: listenPort, fp: tlsCert.load().fp }));
  return status();
}
function init(d) { deps = { ...deps, ...d }; }

async function setConfig(p) {
  const port = Number(p.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('المنفذ يجب أن يكون بين 1024 و65535');
  const q = qrmenu.cfg();
  if (p.enabled && q.enabled && q.port === port) throw new Error('المنفذ مستخدم لمنيو QR، اختر منفذاً آخر');
  const was = JSON.stringify(cfg());
  db.get().settings.waiterApi = { ...cfg(), enabled: !!p.enabled, port };
  db.save();
  auth.audit('settings', `تطبيق النادل: ${p.enabled ? 'مفعّل' : 'معطّل'}، منفذ ${port}`);
  if (was !== JSON.stringify(cfg()) || (cfg().enabled && !server)) await apply();
  return info();
}
function info() {
  const c = cfg(), ips = lanIPs();
  const t = tlsCert.load();
  return {
    config: { ...c }, status: status(), ips, addresses: ips.map((ip) => `${ip}:${c.port}`), sessions: sessions.size,
    tls: { fp: t.fp, pretty: tlsCert.pretty(t.fp), notAfter: t.notAfter }, discovery: discovery.status(),
  };
}
const revokeAll = () => sessions.clear();
// شهادة جديدة = بصمة جديدة: كل الأجهزة المقترنة تطلب تأكيداً جديداً وتُفصل جلساتها
async function regenerateCert() {
  tlsCert.regenerate(); revokeAll();
  auth.audit('settings', 'تطبيق النادل: إعادة إنشاء شهادة التشفير');
  if (cfg().enabled) await apply();
  return info();
}

module.exports = { init, apply, stop, setConfig, info, status, cfg, revokeAll, regenerateCert };
