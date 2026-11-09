// الطلبات والدفع — تخزين SQLite (better-sqlite3). المبالغ كلها أعداد صحيحة بالهللات.
// السعر يُحسب هنا من المنيو؛ لا نثق بأي سعر قادم من الواجهة.
const path = require('path');
const db = require('./db');
const auth = require('./auth');

let sql;
const TYPES = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };
const METHODS = { cash: 'نقدي', card: 'بطاقة', other: 'أخرى' };

function init(file) {
  const Database = require('better-sqlite3');
  file ??= path.join(require('electron').app.getPath('userData'), 'orders.db');
  sql = new Database(file);
  sql.pragma('journal_mode = WAL');
  sql.pragma('foreign_keys = ON');
  sql.exec(`
   CREATE TABLE IF NOT EXISTS orders(
     id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER NOT NULL UNIQUE,
     status TEXT NOT NULL CHECK(status IN ('open','paid','void')),
     type TEXT NOT NULL, table_label TEXT NOT NULL DEFAULT '', customer TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '',
     lines TEXT NOT NULL, discount TEXT, vat_rate REAL NOT NULL,
     subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, vat_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
     paid_cents INTEGER NOT NULL DEFAULT 0, change_cents INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, paid_at TEXT, voided_at TEXT, void_reason TEXT,
     user_id TEXT, user_name TEXT);
   CREATE TABLE IF NOT EXISTS payments(
     id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
     method TEXT NOT NULL, amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
   CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
   CREATE TABLE IF NOT EXISTS tickets(
     id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id), order_number INTEGER NOT NULL,
     station_id TEXT NOT NULL, station_name TEXT NOT NULL, batch INTEGER NOT NULL, type TEXT NOT NULL, table_label TEXT NOT NULL DEFAULT '',
     items TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('new','preparing','ready','done','cancelled','ack')),
     created_at TEXT NOT NULL, started_at TEXT, ready_at TEXT, done_at TEXT);
   CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, station_id);`);
  // ترحيل: ربط الطلب بطاولة (قواعد المرحلة 3 لا تحتوي العمود)
  if (!sql.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'table_id')) sql.exec('ALTER TABLE orders ADD COLUMN table_id TEXT');
  sql.exec('CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id)');
  // ترحيل التوصيل: أجرة التوصيل + المنطقة + حالة التوصيل + السائق وأجره. الطلبات القديمة: المدفوعة/الملغاة تُعدّ مسلَّمة، والمفتوحة قيد التجهيز
  const has = (c) => sql.prepare('PRAGMA table_info(orders)').all().some((x) => x.name === c);
  const fresh = !has('delivery_status');
  for (const [c, t] of [['delivery_fee_cents', 'INTEGER NOT NULL DEFAULT 0'], ['fee_manual', 'INTEGER NOT NULL DEFAULT 0'], ['delivery_zone_id', 'TEXT'], ['delivery_zone', 'TEXT'], ['delivery_status', 'TEXT'], ['driver_id', 'TEXT'], ['driver_name', 'TEXT'], ['driver_wage_cents', 'INTEGER'], ['out_at', 'TEXT'], ['delivered_at', 'TEXT'], ['bill_requested_at', 'TEXT']]) if (!has(c)) sql.exec(`ALTER TABLE orders ADD COLUMN ${c} ${t}`);
  if (fresh) {
    sql.exec("UPDATE orders SET delivery_status='delivered', delivered_at=COALESCE(paid_at, voided_at, created_at) WHERE type='delivery' AND status IN ('paid','void')");
    sql.exec("UPDATE orders SET delivery_status='preparing' WHERE type='delivery' AND status='open'");
  }
  sql.exec('CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(driver_id)');
}
const close = () => { try { sql?.close(); } catch {} sql = null; };

const toCents = (v, max = 10000000) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error('مبلغ غير صالح');
  return Math.round(n * 100);
};
const text = (s, max) => String(s ?? '').trim().slice(0, max);

// ---------- بناء السطور من المنيو ----------
function buildLines(lines) {
  const d = db.get();
  if (!Array.isArray(lines) || !lines.length) throw new Error('الطلب فارغ');
  if (lines.length > 100) throw new Error('عدد الأصناف كبير');
  return lines.map((l) => {
    const it = d.items.find((x) => x.id === l.itemId);
    if (!it || !it.active) throw new Error('صنف غير متاح');
    if (it.soldOut) throw new Error(`«${it.name}» نفد`);
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('كمية غير صالحة');
    const groups = (it.modifierGroupIds || []).map((id) => d.modGroups.find((g) => g.id === id)).filter(Boolean);
    const picks = Array.isArray(l.mods) ? l.mods : [];
    if (picks.some((p) => !groups.some((g) => g.id === p.g))) throw new Error('خيار غير صالح');
    const mods = [];
    for (const g of groups) {
      const idxs = [...new Set(picks.filter((p) => p.g === g.id).map((p) => p.o))];
      if (idxs.some((o) => !Number.isInteger(o) || !g.options[o])) throw new Error('خيار غير صالح');
      if (g.required && !idxs.length) throw new Error(`اختر من «${g.name}» للصنف «${it.name}»`);
      if (!g.multi && idxs.length > 1) throw new Error(`«${g.name}» يسمح بخيار واحد فقط`);
      idxs.forEach((o) => mods.push({ g: g.id, o, group: g.name, name: g.options[o].name, priceCents: g.options[o].priceCents }));
    }
    let vr = null;
    if ((it.variants || []).length) {
      vr = l.variantId ? it.variants.find((v) => v.id === l.variantId) : it.variants.find((v) => v.isDefault) || it.variants[0];
      if (!vr) throw new Error(`اختر نوع «${it.name}»`);
      if (vr.soldOut) throw new Error(`«${it.name} · ${vr.name}» نفد`);
    }
    const base = vr ? vr.priceCents : it.priceCents;
    const unitCents = base + mods.reduce((s, m) => s + m.priceCents, 0);
    return { itemId: it.id, ...(vr ? { variantId: vr.id, variantName: vr.name } : {}), name: vr ? `${it.name} · ${vr.name}` : it.name, qty, baseCents: base, unitCents, mods, note: text(l.note, 100), totalCents: unitCents * qty, sentQty: 0 };
  });
}

function totals(lines, discount, trusted = false, feeCents = 0) {
  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  let discountCents = 0, disc = null;
  const v = Number(discount?.value);
  if (discount && v > 0) {
    const u = auth.current();
    if (!trusted && (!u || !auth.can(u.role, 'discount'))) throw new Error('غير مصرح لك بالخصم');
    if (discount.type === 'percent') {
      if (v > 100) throw new Error('نسبة الخصم غير صالحة');
      discountCents = Math.round((subtotalCents * v) / 100);
    } else if (discount.type === 'fixed') {
      discountCents = toCents(v);
    } else throw new Error('نوع الخصم غير صالح');
    if (discountCents > subtotalCents) throw new Error('الخصم أكبر من المجموع');
    disc = { type: discount.type, value: v };
  }
  const vatRate = db.get().settings.vatRate;
  const taxable = subtotalCents - discountCents;
  const vatCents = Math.round((taxable * Math.round(vatRate * 10000)) / 10000); // أعداد صحيحة لتفادي أخطاء الفاصلة العشرية
  // أجرة التوصيل تُضاف بعد الخصم والضريبة (لا يُفرض عليها خصم ولا ضريبة)
  return { subtotalCents, discountCents, discount: disc, vatRate, vatCents, deliveryFeeCents: feeCents, totalCents: taxable + vatCents + feeCents };
}

// أجرة التوصيل للطلب: تلقائية من المنطقة/الافتراضي/حد المجاني، أو يدوية (deliveryFee) لمن عنده صلاحية الخصم.
// deliveryFee: غير مُرسَل = يُبقي الأجرة اليدوية السابقة إن وُجدت، null = عودة للحساب التلقائي، رقم = أجرة يدوية.
function deliveryPart(p, L, cur) {
  if (p.type !== 'delivery') return { fee: 0, zoneId: null, zoneName: null, manual: false };
  const t0 = totals(L, p.discount), r = require('./delivery').feeFor({ zoneId: p.zoneId || null, netCents: t0.subtotalCents - t0.discountCents });
  let fee = r.feeCents, manual = false;
  if (p.deliveryFee !== undefined && p.deliveryFee !== null) {
    const c = toCents(p.deliveryFee, 100000), u = auth.current();
    if (!u || !auth.can(u.role, 'discount')) throw new Error('غير مصرح لك بتعديل أجرة التوصيل');
    fee = c; manual = true;
  } else if (p.deliveryFee === undefined && cur?.feeManual) { fee = cur.deliveryFeeCents; manual = true; }
  return { fee, zoneId: r.zoneId, zoneName: r.zoneName, manual, free: r.free && !manual };
}

function quote(p = {}) {
  const L = buildLines(p.lines), cur = p.id ? parse(sql.prepare('SELECT * FROM orders WHERE id=?').get(p.id)) : null, d = deliveryPart(p, L, cur);
  return { lines: L, ...totals(L, p.discount, false, d.fee), deliveryZone: d.zoneName, freeDelivery: !!d.free };
}

// ---------- قراءة ----------
const parse = (r) => r && ({
  id: r.id, number: r.number, status: r.status, type: r.type, table: r.table_label, tableId: r.table_id,
  customer: JSON.parse(r.customer), note: r.note, lines: JSON.parse(r.lines), discount: r.discount ? JSON.parse(r.discount) : null,
  vatRate: r.vat_rate, subtotalCents: r.subtotal_cents, discountCents: r.discount_cents, vatCents: r.vat_cents, totalCents: r.total_cents,
  paidCents: r.paid_cents, changeCents: r.change_cents, createdAt: r.created_at, paidAt: r.paid_at, voidedAt: r.voided_at,
  voidReason: r.void_reason, userName: r.user_name, customerId: r.customer_id || null,
  deliveryFeeCents: r.delivery_fee_cents || 0, feeManual: !!r.fee_manual, deliveryZoneId: r.delivery_zone_id || null, deliveryZone: r.delivery_zone || null,
  deliveryStatus: r.type === 'delivery' ? r.delivery_status || 'preparing' : null, driverId: r.driver_id || null, driverName: r.driver_name || null,
  driverWageCents: r.driver_wage_cents ?? null, outAt: r.out_at || null, deliveredAt: r.delivered_at || null, billAt: r.bill_requested_at || null,
});
function get(id) {
  const o = parse(sql.prepare('SELECT * FROM orders WHERE id=?').get(id));
  if (!o) throw new Error('الطلب غير موجود');
  o.payments = sql.prepare('SELECT method, amount_cents AS amountCents FROM payments WHERE order_id=? ORDER BY id').all(id);
  return o;
}
function list({ status, days = 1 } = {}) {
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (Math.max(1, Math.min(+days || 1, 90)) - 1));
  const rows = status
    ? sql.prepare('SELECT * FROM orders WHERE created_at>=? AND status=? ORDER BY id DESC LIMIT 300').all(from.toISOString(), status)
    : sql.prepare('SELECT * FROM orders WHERE created_at>=? ORDER BY id DESC LIMIT 300').all(from.toISOString());
  return rows.map(parse);
}

// ---------- تتبع ما أُرسل للمطبخ ----------
const lineKey = (l) => l.itemId + '|' + (l.variantId || '') + '|' + l.mods.map((m) => m.g + ':' + m.o).sort().join(',') + '|' + (l.note || '');
// عند إعادة حفظ طلب: نُبقي الكمية المرسلة لكل سطر مطابق (لا تُرسل مرتين)
function carrySent(newLines, oldLines) {
  const pool = {};
  oldLines.forEach((l) => { const k = lineKey(l); pool[k] = (pool[k] || 0) + (l.sentQty || 0); });
  // لا نخفض sentQty عند تقليل الكمية: ما حُضِّر في المطبخ لا يعود، فلا يُرسل مجدداً إن رُفعت الكمية
  newLines.forEach((l) => { const k = lineKey(l); l.sentQty = pool[k] || 0; pool[k] = 0; });
}
const TICKET_LIVE = "('new','preparing','ready')";

// ---------- كتابة ----------
const nextNumber = () => sql.prepare('SELECT COALESCE(MAX(number),1000)+1 AS n FROM orders').get().n;
const COLS = ['type', 'table_id', 'table_label', 'customer', 'note', 'lines', 'discount', 'vat_rate', 'subtotal_cents', 'discount_cents', 'vat_cents', 'total_cents', 'delivery_fee_cents', 'delivery_zone_id', 'delivery_zone', 'fee_manual'];
const rowVals = (o, L, t) => [o.type, o.tableId || null, o.table || '', JSON.stringify(o.customer || {}), o.note || '', JSON.stringify(L),
  t.discount ? JSON.stringify(t.discount) : null, t.vatRate, t.subtotalCents, t.discountCents, t.vatCents, t.totalCents, t.deliveryFeeCents || 0, o.deliveryZoneId || null, o.deliveryZone || null, o.feeManual ? 1 : 0];
function insertOrder(o, L, t, u) {
  const q = `INSERT INTO orders(number,status,${COLS.join(',')},created_at,user_id,user_name) VALUES(?,'open',${[...COLS, 'c', 'u', 'n'].map(() => '?').join(',')})`;
  const id = Number(sql.prepare(q).run(nextNumber(), ...rowVals(o, L, t), new Date().toISOString(), u?.id || null, u?.name || null).lastInsertRowid);
  if (o.type === 'delivery') sql.prepare("UPDATE orders SET delivery_status='preparing' WHERE id=?").run(id);
  return id;
}
const updateOrder = (id, o, L, t) => sql.prepare(`UPDATE orders SET ${COLS.map((c) => c + '=?').join(', ')} WHERE id=?`).run(...rowVals(o, L, t), id);
const base = (o) => ({ type: o.type, tableId: o.tableId, table: o.table, customer: o.customer, note: o.note, deliveryZoneId: o.deliveryZoneId, deliveryZone: o.deliveryZone, feeManual: o.feeManual });
function needOpen(o) { if (o.status !== 'open') throw new Error('الطلب غير مفتوح'); return o; }

function save(p) {
  const u = auth.current();
  if (!TYPES[p.type]) throw new Error('نوع الطلب غير صالح');
  let tableId = null, table = '';
  if (p.type === 'dine_in') {
    if (db.get().tables.length) {
      const t = db.get().tables.find((x) => x.id === p.tableId);
      if (!t) throw new Error('اختر الطاولة');
      tableId = t.id; table = t.name;
    } else { table = text(p.table, 20); if (!table) throw new Error('أدخل رقم الطاولة'); }
  }
  const cust = { name: text(p.customer?.name, 60), phone: text(p.customer?.phone, 20), address: text(p.customer?.address, 200) };
  if (p.type === 'delivery' && !cust.phone) throw new Error('أدخل رقم جوال العميل للتوصيل');
  const L = buildLines(p.lines), prev = p.id ? parse(sql.prepare('SELECT * FROM orders WHERE id=?').get(p.id)) : null, d = deliveryPart(p, L, prev), t = totals(L, p.discount, false, d.fee);
  const o = { type: p.type, tableId, table, customer: p.type === 'delivery' ? cust : {}, note: text(p.note, 200), deliveryZoneId: d.zoneId, deliveryZone: d.zoneName, feeManual: d.manual };
  const id = sql.transaction(() => {
    if (p.id) {
      const cur = sql.prepare('SELECT status FROM orders WHERE id=?').get(p.id);
      if (!cur) throw new Error('الطلب غير موجود');
      if (cur.status !== 'open') throw new Error('لا يمكن تعديل طلب مدفوع أو ملغي');
      if (prev.type === 'delivery' && p.type !== 'delivery' && prev.deliveryStatus !== 'preparing') throw new Error('الطلب خرج للتوصيل؛ لا يمكن تغيير نوعه');
      carrySent(L, JSON.parse(sql.prepare('SELECT lines FROM orders WHERE id=?').get(p.id).lines));
      updateOrder(p.id, o, L, t);
      if (p.type !== 'delivery') sql.prepare('UPDATE orders SET delivery_status=NULL, driver_id=NULL, driver_name=NULL, driver_wage_cents=NULL, out_at=NULL, delivered_at=NULL WHERE id=?').run(p.id);
      else if (prev.type !== 'delivery') sql.prepare("UPDATE orders SET delivery_status='preparing' WHERE id=?").run(p.id);
      return p.id;
    }
    return insertOrder(o, L, t, u);
  })();
  const r = get(Number(id));
  auth.audit(p.id ? 'order_update' : 'order_create', `#${r.number} (${TYPES[r.type]}${r.table ? ' ' + r.table : ''})${t.discountCents ? ' — خصم ' + (t.discountCents / 100).toFixed(2) : ''}`);
  return r;
}

// ---------- «طلب الحساب»: الطاولة تتحول إلى «تنتظر الحساب» حتى الدفع/الإلغاء/إلغاء الطلب ----------
function requestBill(id, on = true) {
  const o = needOpen(get(id));
  if (o.type !== 'dine_in') throw new Error('طلب الحساب للطلبات الداخلية (الطاولات) فقط');
  if (on && o.billAt) return o;
  sql.prepare('UPDATE orders SET bill_requested_at=? WHERE id=?').run(on ? new Date().toISOString() : null, id);
  auth.audit(on ? 'bill_request' : 'bill_cancel', `#${o.number}${o.table ? ' — ' + o.table : ''}`);
  return get(id);
}

// ---------- الطاولات: حالة وإعادة تسمية ونقل ودمج وتقسيم ----------
function openByTable() {
  const by = {};
  sql.prepare("SELECT id, number, table_id, total_cents, created_at, bill_requested_at FROM orders WHERE status='open' AND table_id IS NOT NULL ORDER BY id").all()
    .forEach((r) => (by[r.table_id] ||= []).push({ id: r.id, number: r.number, totalCents: r.total_cents, createdAt: r.created_at, billAt: r.bill_requested_at || null }));
  return by;
}
const relabel = (tableId, name) => {
  sql.prepare(`UPDATE tickets SET table_label=? WHERE status IN ${TICKET_LIVE} AND order_id IN (SELECT id FROM orders WHERE table_id=? AND status='open')`).run(name, tableId);
  sql.prepare("UPDATE orders SET table_label=? WHERE table_id=? AND status='open'").run(name, tableId);
};

function moveOrder(id, toTableId) {
  const o = needOpen(get(id));
  if (o.type !== 'dine_in') throw new Error('النقل للطلبات الداخلية فقط');
  const t = db.get().tables.find((x) => x.id === toTableId);
  if (!t) throw new Error('الطاولة غير موجودة');
  if (o.tableId === t.id) throw new Error('الطلب على هذه الطاولة بالفعل');
  sql.prepare('UPDATE orders SET table_id=?, table_label=? WHERE id=?').run(t.id, t.name, id);
  sql.prepare(`UPDATE tickets SET table_label=? WHERE order_id=? AND status IN ${TICKET_LIVE}`).run(t.name, id);
  auth.audit('order_move', `#${o.number}: ${o.table || '-'} ← ${t.name}`);
  return get(id);
}

function merge(sourceId, targetId) {
  if (sourceId === targetId) throw new Error('اختر طلبين مختلفين');
  const s = needOpen(get(sourceId)), t = needOpen(get(targetId));
  if (s.type !== 'dine_in' || t.type !== 'dine_in') throw new Error('الدمج للطلبات الداخلية فقط');
  if (s.discountCents > 0) throw new Error('الطلب المراد دمجه عليه خصم؛ ألغِ الخصم منه أولاً حتى لا يضيع');
  const key = lineKey;
  const merged = t.lines.map((l) => ({ ...l }));
  for (const l of s.lines) {
    const ex = merged.find((x) => key(x) === key(l) && x.qty + l.qty <= 99);
    if (ex) { ex.qty += l.qty; ex.sentQty = (ex.sentQty || 0) + (l.sentQty || 0); ex.totalCents = ex.unitCents * ex.qty; } else merged.push({ ...l });
  }
  const tt = totals(merged, t.discount, true);
  sql.transaction(() => {
    updateOrder(targetId, base(t), merged, tt);
    sql.prepare("UPDATE orders SET status='void', void_reason=?, voided_at=? WHERE id=?").run(`مدموج في #${t.number}`, new Date().toISOString(), sourceId);
    sql.prepare('UPDATE tickets SET order_id=?, table_label=? WHERE order_id=?').run(targetId, t.table, sourceId); // التذاكر النشطة تتبع الطلب الجديد
  })();
  auth.audit('order_merge', `#${s.number} → #${t.number}`);
  return get(targetId);
}

// picks: [{ i: فهرس السطر, qty: الكمية المنقولة }]
function split(id, picks) {
  const o = needOpen(get(id)), u = auth.current();
  if (!Array.isArray(picks) || !picks.length) throw new Error('اختر أصنافاً للتقسيم');
  const seen = new Set(), moved = [], rest = [];
  for (const p of picks) {
    const l = o.lines[p.i];
    if (!l || seen.has(p.i) || !Number.isInteger(p.qty) || p.qty < 1 || p.qty > l.qty) throw new Error('اختيار غير صالح');
    seen.add(p.i);
  }
  o.lines.forEach((l, i) => {
    const q = picks.find((p) => p.i === i)?.qty || 0;
    const sent = l.sentQty || 0, movedSent = Math.min(sent, q);
    if (q) moved.push({ ...l, qty: q, totalCents: l.unitCents * q, sentQty: movedSent });
    if (l.qty - q > 0) rest.push({ ...l, qty: l.qty - q, totalCents: l.unitCents * (l.qty - q), sentQty: Math.min(sent - movedSent, l.qty - q) });
  });
  if (!rest.length) throw new Error('اترك صنفاً واحداً على الأقل في الطلب الأصلي');
  // الخصم النسبي يُنسخ للطرفين؛ الخصم بمبلغ ثابت يبقى على الأصلي
  const t1 = totals(rest, o.discount, true, o.deliveryFeeCents);
  const t2 = totals(moved, o.discount?.type === 'percent' ? o.discount : null, true); // أجرة التوصيل تبقى على الأصلي
  const newId = sql.transaction(() => { updateOrder(id, base(o), rest, t1); return insertOrder({ ...base(o), deliveryZoneId: null, deliveryZone: null, feeManual: false }, moved, t2, u); })();
  const created = get(newId);
  auth.audit('order_split', `#${o.number} → #${created.number}`);
  return { original: get(id), created };
}

function pay(id, payments) {
  const o = get(id);
  if (o.status !== 'open') throw new Error('الطلب غير مفتوح');
  const shifts = require('./shifts'), shiftId = shifts.currentId();
  if (!shiftId && shifts.requireShift()) throw new Error('افتح وردية أولاً (من صفحة «الوردية»)');
  if (!Array.isArray(payments) || payments.length > 6) throw new Error('دفعات غير صالحة');
  const P = payments.map((x) => {
    if (!METHODS[x.method]) throw new Error('طريقة دفع غير صالحة');
    const amountCents = toCents(x.amount);
    if (amountCents <= 0) throw new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر');
    if (x.kind && (x.method !== 'other' || !['gift', 'points'].includes(x.kind))) throw new Error('نوع دفعة غير صالح');
    return { method: x.method, amountCents, kind: x.kind || null, ref: x.ref || null };
  });
  const paid = P.reduce((s, x) => s + x.amountCents, 0);
  if (paid < o.totalCents) throw new Error('المبلغ المدفوع أقل من الإجمالي');
  const cash = P.filter((x) => x.method === 'cash').reduce((s, x) => s + x.amountCents, 0);
  const change = paid - o.totalCents;
  if (change > cash) throw new Error('الفائض (الباقي) يجب أن يكون من الدفع النقدي');
  const now = new Date().toISOString();
  sql.transaction(() => {
    const ins = sql.prepare('INSERT INTO payments(order_id,method,amount_cents,created_at) VALUES(?,?,?,?)');
    P.forEach((x) => ins.run(id, x.method, x.amountCents, now));
    if (P.some((x) => x.kind)) require('./crm').spend(id, P); // كرت هدية/نقاط: يخصم داخل نفس المعاملة، وأي خطأ يلغي الدفع كله
    sql.prepare("UPDATE orders SET status='paid', paid_cents=?, change_cents=?, paid_at=?, shift_id=? WHERE id=? AND status='open'").run(paid, change, now, shiftId, id);
  })();
  try { require('./inventory').onPaid(id); } catch (e) { auth.audit('inventory_error', `#${o.number}: ${e.message}`); } // خطأ مخزون لا يوقف البيع
  auth.audit('order_pay', `#${o.number} — ${(o.totalCents / 100).toFixed(2)} (${P.map((x) => METHODS[x.method]).join('+') || '-'})`);
  return get(id);
}

function voidOrder(id, reason) {
  const o = get(id), u = auth.current();
  if (o.status === 'void') throw new Error('الطلب ملغي مسبقاً');
  reason = text(reason, 120);
  if (o.status === 'paid') {
    if (!u || !auth.can(u.role, 'orders.edit')) throw new Error('إلغاء طلب مدفوع يحتاج صلاحية المدير');
    if (!reason) throw new Error('سبب الإلغاء مطلوب');
  }
  sql.transaction(() => {
    // المرتجع يُنسب للوردية المفتوحة وقت الإلغاء (قد تكون غير الوردية التي دُفع فيها الطلب)
    sql.prepare("UPDATE orders SET status='void', void_reason=?, voided_at=?, void_shift_id=? WHERE id=?").run(reason, new Date().toISOString(), require('./shifts').currentId(), id);
    sql.prepare(`UPDATE tickets SET status='cancelled' WHERE order_id=? AND status IN ${TICKET_LIVE}`).run(id); // المطبخ يرى الإلغاء
  })();
  if (o.status === 'paid') { try { require('./inventory').onVoid(id); } catch (e) { auth.audit('inventory_error', `#${o.number}: ${e.message}`); } }
  auth.audit('order_void', `#${o.number}${o.status === 'paid' ? ' (كان مدفوعاً)' : ''}${reason ? ' — ' + reason : ''}`);
  return get(id);
}

// الشكل الذي يفهمه receipt.js (مبالغ بالريال)
function toReceipt(id) {
  const o = get(id), r = (c) => c / 100;
  return {
    restaurant: db.get().settings.restaurant, number: o.number, date: new Date(o.paidAt || o.createdAt).toLocaleString('ar-SA'),
    type: TYPES[o.type], table: o.table, customer: o.type === 'delivery' ? o.customer : null, status: o.status, vatRate: o.vatRate,
    items: o.lines.map((l) => ({ name: l.name, qty: l.qty, price: r(l.unitCents), mods: l.mods.map((m) => m.name), note: l.note })),
    totals: { subtotal: r(o.subtotalCents), discount: r(o.discountCents), vat: r(o.vatCents), deliveryFee: r(o.deliveryFeeCents), total: r(o.totalCents), paid: r(o.paidCents), change: r(o.changeCents) },
    payments: o.payments.map((p) => ({ method: METHODS[p.method], amount: r(p.amountCents) })),
  };
}

module.exports = { init, close, quote, save, pay, get, list, voidOrder, toReceipt, openByTable, relabel, moveOrder, merge, split, requestBill, raw: () => sql };
