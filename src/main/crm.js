// العملاء + الولاء (نقاط) + كروت الهدايا. تخزين SQLite في orders.db. المبالغ بالهللات.
// - النقاط تُكتسب عند دفع طلب مربوط بعميل، وتُعكس عند إلغاء طلب مدفوع (دفتر حركات لا يُعدَّل).
// - الاسترداد (نقاط/كرت هدية) يُسجَّل كدفعة «أخرى» ويُخصم داخل نفس معاملة الدفع؛ فإن فشل الدفع يتراجع كل شيء.
// - بيع كرت الهدية ليس إيراداً: يُسجَّل التزاماً على المطعم، والنقدي يدخل الدرج كإيداع في الوردية.
const crypto = require('crypto');
const orders = require('./orders');
const db = require('./db');
const auth = require('./auth');

const sqlite = () => orders.raw();
const text = (s, max) => String(s ?? '').trim().slice(0, max);
const now = () => new Date().toISOString();
const uname = () => auth.current()?.name || null;
const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
const normPhone = (p) => {
  const d = String(p ?? '').replace(/[٠-٩۰-۹]/g, (c) => String(AR.includes(c) ? AR.indexOf(c) : FA.indexOf(c))).replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) throw new Error('رقم الجوال غير صالح');
  return d;
};
const cents = (v, min, max) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new Error('مبلغ غير صالح');
  const c = Math.round(n * 100);
  if (c < min || c > max) throw new Error('مبلغ خارج الحد المسموح');
  return c;
};

function init() {
  const sql = sqlite();
  sql.exec(`
   CREATE TABLE IF NOT EXISTS customers(
     id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '',
     points INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS loyalty_moves(
     id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL REFERENCES customers(id), order_id INTEGER,
     points INTEGER NOT NULL, reason TEXT NOT NULL CHECK(reason IN ('earn','redeem','void_earn','void_redeem','adjust')),
     note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, user_name TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_once ON loyalty_moves(order_id, reason) WHERE order_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS gift_cards(
     code TEXT PRIMARY KEY, initial_cents INTEGER NOT NULL, balance_cents INTEGER NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('active','void')), expires_at TEXT, buyer_note TEXT NOT NULL DEFAULT '',
     issued_at TEXT NOT NULL, issued_by TEXT);
   CREATE TABLE IF NOT EXISTS gift_moves(
     id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL REFERENCES gift_cards(code),
     type TEXT NOT NULL CHECK(type IN ('issue','redeem','refund','void')), amount_cents INTEGER NOT NULL,
     order_id INTEGER, created_at TEXT NOT NULL, user_name TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_once ON gift_moves(code, order_id, type) WHERE order_id IS NOT NULL;`);
  if (!sql.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'customer_id')) sql.exec('ALTER TABLE orders ADD COLUMN customer_id TEXT');
  sql.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');
}

// ---------- إعدادات الولاء ----------
function loyalty() {
  const s = db.get().settings;
  s.loyalty ??= { enabled: false, earnPerRiyal: 1, pointValueCents: 5 }; // 100 نقطة = 5 ريال
  return s.loyalty;
}
function setLoyalty(p) {
  const earn = Number(p.earnPerRiyal), pv = Number(p.pointValueCents);
  if (!Number.isFinite(earn) || earn < 0 || earn > 100) throw new Error('نقاط الريال يجب أن تكون بين 0 و100');
  if (!Number.isInteger(pv) || pv < 1 || pv > 1000) throw new Error('قيمة النقطة (بالهللة) يجب أن تكون عدداً صحيحاً بين 1 و1000');
  db.get().settings.loyalty = { enabled: !!p.enabled, earnPerRiyal: earn, pointValueCents: pv };
  db.save();
  auth.audit('settings', `الولاء: ${p.enabled ? 'مفعّل' : 'معطّل'}، ${earn} نقطة/ريال، النقطة = ${pv} هللة`);
  return loyalty();
}

// ---------- العملاء ----------
const toCust = (r) => r && { id: r.id, name: r.name, phone: r.phone, note: r.note, points: r.points, active: !!r.active, createdAt: r.created_at };
const stats = (id) => sqlite().prepare("SELECT COUNT(*) AS visits, COALESCE(SUM(total_cents),0) AS spent, MAX(paid_at) AS last FROM orders WHERE customer_id=? AND status='paid'").get(id);
function withStats(c) { const s = stats(c.id); return { ...c, visits: s.visits, spentCents: s.spent, lastVisit: s.last }; }

function list(q = '') {
  q = text(q, 40);
  const rows = q
    ? sqlite().prepare("SELECT * FROM customers WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' ORDER BY name LIMIT 200").all(...[`%${q.replace(/[%_\\]/g, '\\$&')}%`, `%${q.replace(/[%_\\]/g, '\\$&')}%`])
    : sqlite().prepare('SELECT * FROM customers ORDER BY name LIMIT 200').all();
  return rows.map(toCust).map(withStats);
}
function get(id) {
  const c = toCust(sqlite().prepare('SELECT * FROM customers WHERE id=?').get(id));
  if (!c) throw new Error('العميل غير موجود');
  return {
    ...withStats(c),
    orders: sqlite().prepare("SELECT id, number, total_cents AS totalCents, paid_at AS paidAt, status FROM orders WHERE customer_id=? AND status IN ('paid','void') ORDER BY id DESC LIMIT 20").all(id),
    moves: sqlite().prepare('SELECT points, reason, note, created_at AS createdAt, order_id AS orderId FROM loyalty_moves WHERE customer_id=? ORDER BY id DESC LIMIT 30').all(id),
  };
}
function findByPhone(phone) {
  let p; try { p = normPhone(phone); } catch { return null; }
  const c = toCust(sqlite().prepare('SELECT * FROM customers WHERE phone=? AND active=1').get(p));
  return c ? withStats(c) : null;
}
function save(c) {
  const name = text(c.name, 60), note = text(c.note, 200);
  if (!name) throw new Error('اسم العميل مطلوب');
  const phone = normPhone(c.phone);
  const dup = sqlite().prepare('SELECT id FROM customers WHERE phone=?').get(phone);
  if (dup && dup.id !== c.id) throw new Error('رقم الجوال مسجّل لعميل آخر');
  let id = c.id;
  if (id) {
    if (!sqlite().prepare('SELECT 1 FROM customers WHERE id=?').get(id)) throw new Error('العميل غير موجود');
    sqlite().prepare('UPDATE customers SET name=?, phone=?, note=? WHERE id=?').run(name, phone, note, id);
  } else {
    id = crypto.randomUUID();
    sqlite().prepare('INSERT INTO customers(id,name,phone,note,created_at) VALUES(?,?,?,?,?)').run(id, name, phone, note, now());
  }
  auth.audit(c.id ? 'customer_update' : 'customer_create', `${name} (${phone})`);
  return withStats(toCust(sqlite().prepare('SELECT * FROM customers WHERE id=?').get(id)));
}
function setActive(id, active) {
  const c = get(id);
  sqlite().prepare('UPDATE customers SET active=? WHERE id=?').run(active ? 1 : 0, id);
  auth.audit('customer_update', `${c.name}: ${active ? 'تفعيل' : 'تعطيل'}`);
  return get(id);
}
function adjustPoints(id, delta, note) {
  const d = Number(delta), c = get(id);
  if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 100000) throw new Error('عدد النقاط غير صالح');
  note = text(note, 120); if (!note) throw new Error('اكتب سبب التعديل');
  if (c.points + d < 0) throw new Error('الرصيد لا يكفي للخصم');
  sqlite().transaction(() => {
    sqlite().prepare('UPDATE customers SET points=points+? WHERE id=?').run(d, id);
    sqlite().prepare("INSERT INTO loyalty_moves(customer_id,points,reason,note,created_at,user_name) VALUES(?,?, 'adjust', ?,?,?)").run(id, d, note, now(), uname());
  })();
  auth.audit('loyalty_adjust', `${c.name}: ${d > 0 ? '+' : ''}${d} — ${note}`);
  return get(id);
}

// ---------- ربط الطلب بعميل ----------
const customerOf = (orderId) => sqlite().prepare('SELECT customer_id FROM orders WHERE id=?').get(orderId)?.customer_id || null;
function attach(orderId, customerId) {
  const o = sqlite().prepare('SELECT status, number FROM orders WHERE id=?').get(orderId);
  if (!o) throw new Error('الطلب غير موجود');
  if (o.status !== 'open') throw new Error('لا يمكن تغيير عميل طلب مدفوع أو ملغي');
  if (customerId) {
    const c = sqlite().prepare('SELECT active FROM customers WHERE id=?').get(customerId);
    if (!c) throw new Error('العميل غير موجود');
    if (!c.active) throw new Error('العميل معطّل');
  }
  sqlite().prepare('UPDATE orders SET customer_id=? WHERE id=?').run(customerId || null, orderId);
}

// ---------- كسب النقاط وعكسها ----------
function onPaid(orderId) {
  const L = loyalty(), cid = customerOf(orderId);
  if (!L.enabled || !cid) return 0;
  const o = sqlite().prepare('SELECT subtotal_cents, discount_cents FROM orders WHERE id=?').get(orderId);
  const redeemed = sqlite().prepare("SELECT COALESCE(-SUM(points),0) AS p FROM loyalty_moves WHERE order_id=? AND reason='redeem'").get(orderId).p * L.pointValueCents;
  const base = Math.max(0, o.subtotal_cents - o.discount_cents - redeemed); // قبل الضريبة وبعد الخصم واسترداد النقاط
  const pts = Math.floor((base / 100) * L.earnPerRiyal);
  if (pts <= 0) return 0;
  return sqlite().transaction(() => {
    const r = sqlite().prepare("INSERT OR IGNORE INTO loyalty_moves(customer_id,order_id,points,reason,created_at,user_name) VALUES(?,?,?, 'earn',?,?)").run(cid, orderId, pts, now(), uname());
    if (!r.changes) return 0; // احتُسب مسبقاً
    sqlite().prepare('UPDATE customers SET points=points+? WHERE id=?').run(pts, cid);
    return pts;
  })();
}

// يُستدعى داخل معاملة orders.pay: يخصم رصيد الكرت/النقاط أو يرمي خطأً فيتراجع الدفع كله
function spend(orderId, P) {
  const sql = sqlite(), L = loyalty();
  let pointsRows = 0;
  for (const p of P) {
    if (p.kind === 'gift') {
      const code = normCode(p.ref);
      const g = sql.prepare('SELECT * FROM gift_cards WHERE code=?').get(code);
      if (!g) throw new Error('كرت الهدية غير موجود');
      if (g.status !== 'active') throw new Error('كرت الهدية ملغي');
      if (g.expires_at && g.expires_at < now()) throw new Error('كرت الهدية منتهي الصلاحية');
      if (sql.prepare("SELECT 1 FROM gift_moves WHERE code=? AND order_id=? AND type='redeem'").get(code, orderId)) throw new Error('الكرت مستخدم في هذا الطلب مسبقاً');
      if (p.amountCents > g.balance_cents) throw new Error(`رصيد الكرت ${(g.balance_cents / 100).toFixed(2)} فقط`);
      sql.prepare('UPDATE gift_cards SET balance_cents=balance_cents-? WHERE code=?').run(p.amountCents, code);
      sql.prepare("INSERT INTO gift_moves(code,type,amount_cents,order_id,created_at,user_name) VALUES(?, 'redeem',?,?,?,?)").run(code, p.amountCents, orderId, now(), uname());
    } else if (p.kind === 'points') {
      if (++pointsRows > 1) throw new Error('دفعة نقاط واحدة فقط لكل طلب');
      if (!L.enabled) throw new Error('برنامج الولاء غير مفعّل');
      const cid = customerOf(orderId);
      if (!cid) throw new Error('اربط الطلب بعميل لاستخدام النقاط');
      if (p.amountCents % L.pointValueCents) throw new Error(`المبلغ يجب أن يكون من مضاعفات قيمة النقطة (${L.pointValueCents} هللة)`);
      const pts = p.amountCents / L.pointValueCents;
      const c = sql.prepare('SELECT points FROM customers WHERE id=?').get(cid);
      if (c.points < pts) throw new Error(`رصيد العميل ${c.points} نقطة فقط`);
      sql.prepare('UPDATE customers SET points=points-? WHERE id=?').run(pts, cid);
      sql.prepare("INSERT INTO loyalty_moves(customer_id,order_id,points,reason,created_at,user_name) VALUES(?,?,?, 'redeem',?,?)").run(cid, orderId, -pts, now(), uname());
    } else if (p.kind) throw new Error('نوع دفعة غير صالح');
  }
}

// عند إلغاء طلب مدفوع: عكس النقاط المكتسبة، إرجاع النقاط المستردة، وإعادة رصيد الكروت
function onVoid(orderId) {
  const sql = sqlite();
  sql.transaction(() => {
    const cid = customerOf(orderId);
    for (const m of sql.prepare("SELECT * FROM loyalty_moves WHERE order_id=? AND reason IN ('earn','redeem')").all(orderId)) {
      const reason = m.reason === 'earn' ? 'void_earn' : 'void_redeem';
      const r = sql.prepare('INSERT OR IGNORE INTO loyalty_moves(customer_id,order_id,points,reason,created_at,user_name) VALUES(?,?,?,?,?,?)').run(m.customer_id, orderId, -m.points, reason, now(), uname());
      if (r.changes) sql.prepare('UPDATE customers SET points=points+? WHERE id=?').run(-m.points, m.customer_id); // قد يصبح الرصيد سالباً إن كان صُرف
    }
    void cid;
    for (const g of sql.prepare("SELECT * FROM gift_moves WHERE order_id=? AND type='redeem'").all(orderId)) {
      const r = sql.prepare("INSERT OR IGNORE INTO gift_moves(code,type,amount_cents,order_id,created_at,user_name) VALUES(?, 'refund',?,?,?,?)").run(g.code, g.amount_cents, orderId, now(), uname());
      if (r.changes) sql.prepare("UPDATE gift_cards SET balance_cents=balance_cents+? WHERE code=? AND status='active'").run(g.amount_cents, g.code);
    }
  })();
}

// ---------- كروت الهدايا ----------
const normCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtCode = (c) => c.match(/.{1,4}/g).join('-');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بلا أحرف ملتبسة (0/O و1/I)
const genCode = () => Array.from(crypto.randomBytes(12), (b) => ALPHA[b % ALPHA.length]).join('');
const toCard = (r) => r && {
  code: fmtCode(r.code), initialCents: r.initial_cents, balanceCents: r.balance_cents, status: r.status,
  expiresAt: r.expires_at, buyerNote: r.buyer_note, issuedAt: r.issued_at, issuedBy: r.issued_by,
  expired: !!(r.expires_at && r.expires_at < now()),
};
function giftGet(code) {
  const c = toCard(sqlite().prepare('SELECT * FROM gift_cards WHERE code=?').get(normCode(code)));
  if (!c) throw new Error('كرت الهدية غير موجود');
  c.moves = sqlite().prepare('SELECT type, amount_cents AS amountCents, order_id AS orderId, created_at AS createdAt, user_name AS userName FROM gift_moves WHERE code=? ORDER BY id DESC LIMIT 30').all(normCode(code));
  return c;
}
const giftList = () => sqlite().prepare('SELECT * FROM gift_cards ORDER BY issued_at DESC LIMIT 200').all().map(toCard);

// method: cash | card. النقدي يدخل الدرج كإيداع (يتطلب وردية مفتوحة إن كانت مشترطة)
function giftIssue({ amount, method, buyerNote, expiryDays }) {
  const c = cents(amount, 100, 1000000);
  if (method !== 'cash' && method !== 'card') throw new Error('طريقة الدفع غير صالحة');
  const days = expiryDays === '' || expiryDays == null ? null : Number(expiryDays);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new Error('مدة الصلاحية غير صالحة');
  const shifts = require('./shifts');
  if (method === 'cash' && !shifts.currentId() && shifts.requireShift()) throw new Error('افتح وردية أولاً (من صفحة «الوردية»)');
  const expires = days ? new Date(Date.now() + days * 864e5).toISOString() : null;
  let code;
  sqlite().transaction(() => {
    for (let i = 0; i < 5; i++) {
      code = genCode();
      if (!sqlite().prepare('SELECT 1 FROM gift_cards WHERE code=?').get(code)) break;
      if (i === 4) throw new Error('تعذّر توليد رمز فريد');
    }
    sqlite().prepare("INSERT INTO gift_cards(code,initial_cents,balance_cents,status,expires_at,buyer_note,issued_at,issued_by) VALUES(?,?,?, 'active',?,?,?,?)").run(code, c, c, expires, text(buyerNote, 100), now(), uname());
    sqlite().prepare("INSERT INTO gift_moves(code,type,amount_cents,created_at,user_name) VALUES(?, 'issue',?,?,?)").run(code, c, now(), uname());
    if (method === 'cash' && shifts.currentId()) shifts.addMove('in', c / 100, `بيع كرت هدية ${fmtCode(code)}`);
  })();
  auth.audit('giftcard_issue', `${fmtCode(code)} — ${(c / 100).toFixed(2)} (${method === 'cash' ? 'نقدي' : 'بطاقة'})`);
  return giftGet(code);
}
function giftVoid(code, reason) {
  const c = giftGet(code);
  reason = text(reason, 120); if (!reason) throw new Error('اكتب سبب الإلغاء');
  if (c.status === 'void') throw new Error('الكرت ملغي مسبقاً');
  sqlite().transaction(() => {
    sqlite().prepare("UPDATE gift_cards SET status='void', balance_cents=0 WHERE code=?").run(normCode(code));
    sqlite().prepare("INSERT INTO gift_moves(code,type,amount_cents,created_at,user_name) VALUES(?, 'void',?,?,?)").run(normCode(code), c.balanceCents, now(), uname());
  })();
  auth.audit('giftcard_void', `${c.code} — رصيد ${(c.balanceCents / 100).toFixed(2)} — ${reason}`);
  return giftGet(code);
}

// ---------- بيانات الإيصال (العميل والنقاط) ----------
function receiptInfo(orderId) {
  const cid = customerOf(orderId); if (!cid) return null;
  const c = sqlite().prepare('SELECT name, points FROM customers WHERE id=?').get(cid); if (!c) return null;
  const sum = (reason) => sqlite().prepare('SELECT COALESCE(SUM(points),0) AS p FROM loyalty_moves WHERE order_id=? AND reason=?').get(orderId, reason).p;
  return { name: c.name, enabled: !!loyalty().enabled, earned: sum('earn'), redeemed: -sum('redeem'), balance: c.points };
}

// ---------- دمج عملاء مكررين: المصدر ← الهدف ----------
function merge(fromId, intoId) {
  if (!fromId || !intoId || fromId === intoId) throw new Error('اختر عميلين مختلفين');
  const sql = sqlite(), a = sql.prepare('SELECT * FROM customers WHERE id=?').get(fromId), b = sql.prepare('SELECT * FROM customers WHERE id=?').get(intoId);
  if (!a || !b) throw new Error('العميل غير موجود');
  if (!b.active) throw new Error('العميل الهدف معطّل');
  sql.transaction(() => {
    sql.prepare('UPDATE orders SET customer_id=? WHERE customer_id=?').run(intoId, fromId);
    sql.prepare('UPDATE loyalty_moves SET customer_id=? WHERE customer_id=?').run(intoId, fromId);
    sql.prepare('UPDATE reservations SET customer_id=? WHERE customer_id=?').run(intoId, fromId);
    sql.prepare('UPDATE customers SET points=points+? WHERE id=?').run(a.points, intoId);
    sql.prepare('UPDATE customers SET points=0, active=0 WHERE id=?').run(fromId);
  })();
  auth.audit('customer_merge', `${a.name} (${a.phone}) ← دُمج في ${b.name} (${b.phone}) — نُقل ${a.points} نقطة`);
  return get(intoId);
}

// ---------- التزامات كروت الهدايا (أرصدة غير مستخدمة) ----------
function giftLiabilities() {
  const sql = sqlite(), t = now();
  const one = (q, ...a) => sql.prepare(q).get(...a);
  const act = one("SELECT COUNT(*) AS n, COALESCE(SUM(balance_cents),0) AS c FROM gift_cards WHERE status='active' AND balance_cents>0 AND (expires_at IS NULL OR expires_at>=?)", t);
  const exp = one("SELECT COUNT(*) AS n, COALESCE(SUM(balance_cents),0) AS c FROM gift_cards WHERE status='active' AND balance_cents>0 AND expires_at<?", t);
  const mv = (type) => one('SELECT COALESCE(SUM(amount_cents),0) AS c FROM gift_moves WHERE type=?', type).c;
  return { activeCount: act.n, activeCents: act.c, expiredCount: exp.n, expiredCents: exp.c, issuedCents: mv('issue'), usedCents: mv('redeem') - mv('refund'), voidedCents: mv('void') };
}

// بيانات طباعة الكرت (للقسيمة)
const giftVoucher = (code) => { const c = giftGet(code); return { restaurant: db.get().settings.restaurant, code: c.code, balanceCents: c.balanceCents, initialCents: c.initialCents, expiresAt: c.expiresAt, buyerNote: c.buyerNote, status: c.status }; };

module.exports = { receiptInfo, merge, giftLiabilities, giftVoucher, init, loyalty, setLoyalty, list, get, findByPhone, save, setActive, adjustPoints, attach, customerOf, onPaid, spend, onVoid, giftGet, giftList, giftIssue, giftVoid, normPhone };
