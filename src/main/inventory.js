// المخزون: مكوّنات، وصفات، خصم تلقائي عند الدفع، جرد، هدر، أوامر شراء. تخزين SQLite (orders.db).
// الكميات بوحدة أساسية (جرام / مل / حبة). تكلفة الوحدة بالهللات (قد تكون كسرية). السماح بالرصيد السالب كي لا يتعطل البيع.
const crypto = require('crypto');
const orders = require('./orders');
const db = require('./db');
const auth = require('./auth');

const UNITS = { g: 'جرام', ml: 'مل', pcs: 'حبة' };
const REASONS = ['initial', 'sale', 'void', 'purchase', 'adjust', 'waste', 'count'];
let ready = false;
const S = () => orders.raw();
const r3 = (x) => Math.round(x * 1000) / 1000;
const nm = (s) => { s = String(s ?? '').trim(); if (!s) throw new Error('الاسم مطلوب'); if (s.length > 80) throw new Error('الاسم طويل'); return s; };
const num = (v, { min = 0, max = 1e9, what = 'قيمة' } = {}) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max) throw new Error(`${what} غير صالحة`);
  return n;
};

function init() {
  S().exec(`
   CREATE TABLE IF NOT EXISTS ingredients(
     id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, min_qty REAL NOT NULL DEFAULT 0,
     unit_cost REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS recipe_lines(
     item_id TEXT NOT NULL, ingredient_id TEXT NOT NULL REFERENCES ingredients(id), qty REAL NOT NULL, PRIMARY KEY(item_id, ingredient_id));
   CREATE TABLE IF NOT EXISTS stock_moves(
     id INTEGER PRIMARY KEY AUTOINCREMENT, ingredient_id TEXT NOT NULL REFERENCES ingredients(id), delta REAL NOT NULL, reason TEXT NOT NULL,
     order_id INTEGER, po_id INTEGER, cost_cents REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, user_name TEXT);
   CREATE INDEX IF NOT EXISTS idx_moves_order ON stock_moves(order_id);
   CREATE INDEX IF NOT EXISTS idx_moves_ing ON stock_moves(ingredient_id);
   CREATE INDEX IF NOT EXISTS idx_moves_time ON stock_moves(created_at);
   CREATE TABLE IF NOT EXISTS purchase_orders(
     id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER NOT NULL UNIQUE, supplier TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL CHECK(status IN ('draft','ordered','received','cancelled')), created_at TEXT NOT NULL, ordered_at TEXT, received_at TEXT, user_name TEXT);
   CREATE TABLE IF NOT EXISTS po_lines(
     id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER NOT NULL REFERENCES purchase_orders(id), ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
     qty REAL NOT NULL, unit_cost REAL NOT NULL, received_qty REAL);`);
  // ترحيل: تصنيف المادة ووحدة الشراء والمورّد
  const cols = S().prepare('PRAGMA table_info(ingredients)').all().map((c) => c.name);
  ['category', 'supplier', 'pack_label'].forEach((c) => { if (!cols.includes(c)) S().exec(`ALTER TABLE ingredients ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`); });
  ready = true;
}

// حركة مخزون + تحديث الرصيد (داخل معاملة المستدعي)
function move(ing, delta, reason, { orderId = null, poId = null, note = '', costCents } = {}) {
  delta = r3(delta);
  S().prepare('INSERT INTO stock_moves(ingredient_id,delta,reason,order_id,po_id,cost_cents,note,created_at,user_name) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(ing.id, delta, reason, orderId, poId, costCents ?? delta * ing.unit_cost, note, new Date().toISOString(), auth.current()?.name || null);
  S().prepare('UPDATE ingredients SET qty=ROUND(qty+?,3) WHERE id=?').run(delta, ing.id);
}
const ingRow = (id) => { const r = S().prepare('SELECT * FROM ingredients WHERE id=?').get(id); if (!r) throw new Error('المكوّن غير موجود'); return r; };
const pub = (r) => ({ id: r.id, name: r.name, category: r.category || '', supplier: r.supplier || '', packLabel: r.pack_label || '', unit: r.unit, qty: r.qty, minQty: r.min_qty, unitCostCents: r.unit_cost, active: !!r.active,
  low: !!r.active && r.min_qty > 0 && r.qty <= r.min_qty, valueCents: Math.round(r.qty * r.unit_cost) });

// ---------- المكوّنات ----------
function list() {
  const ings = S().prepare('SELECT * FROM ingredients ORDER BY name').all().map(pub);
  const recipes = {};
  S().prepare('SELECT item_id, ingredient_id, qty FROM recipe_lines').all().forEach((r) => (recipes[r.item_id] ||= []).push({ ingredientId: r.ingredient_id, qty: r.qty }));
  return { ingredients: ings, recipes, units: UNITS };
}
const lowCount = () => (ready ? S().prepare('SELECT COUNT(*) AS n FROM ingredients WHERE active=1 AND min_qty>0 AND qty<=min_qty').get().n : 0);

// unitCost: بالريال لكل وحدة أساسية (مثلاً 0.05 للجرام)
function save({ id, name, unit, minQty = 0, unitCost = 0, qty = 0, active = true, category, supplier, packLabel }) {
  name = nm(name);
  const tx = (v, what) => { v = String(v ?? '').trim(); if (v.length > 60) throw new Error(`${what} طويل`); return v; };
  const cat = category === undefined ? undefined : tx(category, 'التصنيف'), sup = supplier === undefined ? undefined : tx(supplier, 'المورّد'), pk = packLabel === undefined ? undefined : tx(packLabel, 'وحدة الشراء');
  if (!UNITS[unit]) throw new Error('وحدة غير صالحة');
  const mn = num(minQty, { what: 'الحد الأدنى' }), cost = Math.round(num(unitCost, { max: 1e6, what: 'التكلفة' }) * 100 * 1e6) / 1e6;
  const dup = S().prepare('SELECT id FROM ingredients WHERE LOWER(name)=LOWER(?)').get(name);
  if (dup && dup.id !== id) throw new Error('يوجد مكوّن بنفس الاسم');
  S().transaction(() => {
    if (id) {
      const cur = ingRow(id);
      if (cur.unit !== unit && S().prepare('SELECT 1 FROM stock_moves WHERE ingredient_id=? LIMIT 1').get(id)) throw new Error('لا يمكن تغيير وحدة مكوّن له حركات');
      S().prepare('UPDATE ingredients SET name=?, unit=?, min_qty=?, unit_cost=?, active=?, category=COALESCE(?,category), supplier=COALESCE(?,supplier), pack_label=COALESCE(?,pack_label) WHERE id=?').run(name, unit, mn, cost, active ? 1 : 0, cat ?? null, sup ?? null, pk ?? null, id);
    } else {
      id = crypto.randomUUID();
      S().prepare('INSERT INTO ingredients(id,name,unit,qty,min_qty,unit_cost,active,created_at,category,supplier,pack_label) VALUES(?,?,?,0,?,?,?,?,?,?,?)').run(id, name, unit, mn, cost, active ? 1 : 0, new Date().toISOString(), cat || '', sup || '', pk || '');
      const q = num(qty, { what: 'الكمية' });
      if (q > 0) move(ingRow(id), q, 'initial', { note: 'رصيد افتتاحي' });
    }
  })();
  auth.audit('ingredient_save', name);
  return pub(ingRow(id));
}
function remove(id) {
  const r = ingRow(id);
  if (S().prepare('SELECT 1 FROM stock_moves WHERE ingredient_id=? LIMIT 1').get(id) || S().prepare('SELECT 1 FROM recipe_lines WHERE ingredient_id=? LIMIT 1').get(id) || S().prepare('SELECT 1 FROM po_lines WHERE ingredient_id=? LIMIT 1').get(id))
    throw new Error('المكوّن مستخدم (وصفة أو حركات)؛ عطّله بدلاً من حذفه');
  S().prepare('DELETE FROM ingredients WHERE id=?').run(id);
  auth.audit('ingredient_delete', r.name);
}

// ---------- تعديل يدوي / هدر / جرد ----------
function adjust(id, type, qty, note) {
  if (type !== 'add' && type !== 'waste') throw new Error('نوع غير صالح');
  const q = num(qty, { what: 'الكمية' }); if (q <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر');
  note = String(note ?? '').trim().slice(0, 120);
  if (type === 'waste' && !note) throw new Error('اكتب سبب الهدر');
  const ing = ingRow(id);
  S().transaction(() => move(ing, type === 'add' ? q : -q, type === 'add' ? 'adjust' : 'waste', { note }))();
  auth.audit(type === 'add' ? 'stock_add' : 'stock_waste', `${ing.name}: ${q}${note ? ' — ' + note : ''}`);
  return pub(ingRow(id));
}
// counts: [{ id, counted }] — يُنشئ حركة «جرد» بالفرق فقط
function count(counts) {
  if (!Array.isArray(counts) || !counts.length) throw new Error('لا توجد كميات للجرد');
  const diffs = [];
  S().transaction(() => {
    for (const c of counts) {
      const ing = ingRow(c.id), counted = r3(num(c.counted, { what: `كمية «${ing.name}»` })), d = r3(counted - ing.qty);
      if (d === 0) continue;
      move(ing, d, 'count', { note: `جرد: ${ing.qty} ← ${counted}` });
      diffs.push({ id: ing.id, name: ing.name, unit: ing.unit, before: ing.qty, counted, diff: d, valueCents: Math.round(d * ing.unit_cost) });
    }
  })();
  const tot = diffs.reduce((s, x) => s + x.valueCents, 0);
  auth.audit('stock_count', `${counts.length} مكوّن، ${diffs.length} فرق، قيمة الفروق ${(tot / 100).toFixed(2)}`);
  return { checked: counts.length, diffs, totalCents: tot };
}

// ---------- الوصفات ----------
function recipeSave(itemId, lines, variantId) {
  const item0 = db.get().items.find((i) => i.id === itemId);
  if (!item0) throw new Error('الصنف غير موجود');
  if (variantId && !(item0.variants || []).some((v) => v.id === variantId)) throw new Error('النوع غير موجود');
  const key = variantId ? `${itemId}#${variantId}` : itemId;
  if (!Array.isArray(lines) || lines.length > 30) throw new Error('وصفة غير صالحة');
  const seen = new Set();
  const L = lines.map((l) => {
    const ing = ingRow(l.ingredientId);
    if (seen.has(ing.id)) throw new Error(`«${ing.name}» مكرر في الوصفة`);
    seen.add(ing.id);
    const q = num(l.qty, { max: 1e7, what: `كمية «${ing.name}»` }); if (q <= 0) throw new Error(`كمية «${ing.name}» يجب أن تكون أكبر من صفر`);
    return { ing, q };
  });
  S().transaction(() => {
    S().prepare('DELETE FROM recipe_lines WHERE item_id=?').run(key);
    L.forEach(({ ing, q }) => S().prepare('INSERT INTO recipe_lines(item_id,ingredient_id,qty) VALUES(?,?,?)').run(key, ing.id, q));
  })();
  auth.audit('recipe_save', `${item0.name}${variantId ? ' · ' + item0.variants.find((v) => v.id === variantId).name : ''} (${L.length} مكوّن)`);
  return list().recipes[key] || [];
}

// ---------- الخصم التلقائي (يُستدعى من orders.pay / orders.voidOrder) ----------
function onPaid(orderId) {
  if (!ready) return;
  if (S().prepare("SELECT 1 FROM stock_moves WHERE order_id=? AND reason='sale' LIMIT 1").get(orderId)) return; // لا خصم مرتين
  const o = orders.get(orderId), need = new Map(), cache = {};
  const items = db.get().items;
  for (const l of o.lines) {
    if (items.find((i) => i.id === l.itemId)?.stockMode === 'manual') continue; // خصم يدوي: لا خصم تلقائي
    const k = l.variantId ? `${l.itemId}#${l.variantId}` : l.itemId;
    cache[k] ||= S().prepare('SELECT ingredient_id, qty FROM recipe_lines WHERE item_id=?').all(k);
    if (!cache[k].length && l.variantId) cache[k] = cache[l.itemId] ||= S().prepare('SELECT ingredient_id, qty FROM recipe_lines WHERE item_id=?').all(l.itemId);
    cache[k].forEach((r) => need.set(r.ingredient_id, (need.get(r.ingredient_id) || 0) + r.qty * l.qty));
  }
  if (!need.size) return;
  S().transaction(() => need.forEach((q, id) => move(ingRow(id), -q, 'sale', { orderId, note: `طلب #${o.number}` })))();
}
function onVoid(orderId) {
  if (!ready) return;
  if (S().prepare("SELECT 1 FROM stock_moves WHERE order_id=? AND reason='void' LIMIT 1").get(orderId)) return;
  const rows = S().prepare("SELECT ingredient_id, SUM(delta) AS d, SUM(cost_cents) AS c FROM stock_moves WHERE order_id=? AND reason='sale' GROUP BY ingredient_id").all(orderId);
  if (!rows.length) return;
  const n = orders.get(orderId).number;
  S().transaction(() => rows.forEach((r) => move(ingRow(r.ingredient_id), -r.d, 'void', { orderId, note: `إلغاء طلب #${n}`, costCents: -r.c })))();
}

// ---------- أوامر الشراء ----------
const poLine = (l) => {
  const unitCost = l.totalPrice !== undefined ? (num(l.totalPrice, { max: 1e8, what: 'السعر' }) * 100) / Math.max(1e-9, num(l.qty, { what: 'الكمية' })) : null;
  return unitCost;
};
function checkLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('أضف صنفاً واحداً على الأقل');
  if (lines.length > 60) throw new Error('عدد الأصناف كبير');
  return lines.map((l) => {
    const ing = ingRow(l.ingredientId), q = num(l.qty, { what: `كمية «${ing.name}»` });
    if (q <= 0) throw new Error(`كمية «${ing.name}» يجب أن تكون أكبر من صفر`);
    return { ing, q, unitCost: poLine(l) ?? ing.unit_cost };
  });
}
function poGet(id) {
  const p = S().prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
  if (!p) throw new Error('أمر الشراء غير موجود');
  const lines = S().prepare('SELECT l.id, l.ingredient_id AS ingredientId, i.name, i.unit, l.qty, l.unit_cost AS unitCostCents, l.received_qty AS receivedQty FROM po_lines l JOIN ingredients i ON i.id=l.ingredient_id WHERE l.po_id=? ORDER BY l.id').all(id);
  const total = lines.reduce((s, l) => s + Math.round((l.receivedQty ?? l.qty) * l.unitCostCents), 0);
  return { id: p.id, number: p.number, supplier: p.supplier, note: p.note, status: p.status, createdAt: p.created_at, orderedAt: p.ordered_at, receivedAt: p.received_at, userName: p.user_name, lines, totalCents: total };
}
const poList = () => S().prepare('SELECT id FROM purchase_orders ORDER BY id DESC LIMIT 100').all().map((r) => poGet(r.id));

function poSave({ id, supplier, note, lines }) {
  const L = checkLines(lines);
  supplier = String(supplier ?? '').trim().slice(0, 80); note = String(note ?? '').trim().slice(0, 200);
  const pid = S().transaction(() => {
    if (id) {
      const cur = S().prepare('SELECT status FROM purchase_orders WHERE id=?').get(id);
      if (!cur) throw new Error('أمر الشراء غير موجود');
      if (cur.status !== 'draft') throw new Error('لا يُعدَّل إلا أمر الشراء المسودة');
      S().prepare('UPDATE purchase_orders SET supplier=?, note=? WHERE id=?').run(supplier, note, id);
      S().prepare('DELETE FROM po_lines WHERE po_id=?').run(id);
    } else {
      const n = S().prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM purchase_orders').get().n;
      id = Number(S().prepare("INSERT INTO purchase_orders(number,supplier,note,status,created_at,user_name) VALUES(?,?,?,'draft',?,?)").run(n, supplier, note, new Date().toISOString(), auth.current()?.name || null).lastInsertRowid);
    }
    L.forEach((l) => S().prepare('INSERT INTO po_lines(po_id,ingredient_id,qty,unit_cost) VALUES(?,?,?,?)').run(id, l.ing.id, l.q, l.unitCost));
    return id;
  })();
  const p = poGet(pid); auth.audit(id ? 'po_save' : 'po_create', `أمر شراء #${p.number}${supplier ? ' — ' + supplier : ''}`);
  return p;
}
function poStatus(id, to) {
  const p = poGet(id);
  const ok = (to === 'ordered' && p.status === 'draft') || (to === 'cancelled' && (p.status === 'draft' || p.status === 'ordered'));
  if (!ok) throw new Error('لا يمكن تغيير الحالة من هذه الحالة');
  S().prepare('UPDATE purchase_orders SET status=?, ordered_at=COALESCE(?, ordered_at) WHERE id=?').run(to, to === 'ordered' ? new Date().toISOString() : null, id);
  auth.audit('po_' + to, `أمر شراء #${p.number}`);
  return poGet(id);
}
// استلام: يضيف للمخزون ويحدّث تكلفة المكوّن بالمتوسط المرجّح. received: [{ lineId, qty, totalPrice }] (اختياري؛ الافتراضي ما طُلب)
function poReceive(id, received) {
  const p = poGet(id);
  if (p.status !== 'draft' && p.status !== 'ordered') throw new Error('لا يمكن استلام أمر شراء مستلَم أو ملغى');
  const by = new Map((Array.isArray(received) ? received : []).map((x) => [x.lineId, x]));
  const plan = p.lines.map((l) => {
    const x = by.get(l.id);
    const q = x ? num(x.qty, { what: `كمية «${l.name}»` }) : l.qty;
    const unitCost = x && q > 0 && x.totalPrice !== undefined ? (num(x.totalPrice, { max: 1e8, what: 'السعر' }) * 100) / q : l.unitCostCents;
    return { l, q, unitCost };
  });
  S().transaction(() => {
    for (const { l, q, unitCost } of plan) {
      S().prepare('UPDATE po_lines SET received_qty=?, unit_cost=? WHERE id=?').run(q, unitCost, l.id);
      if (q <= 0) continue;
      const ing = ingRow(l.ingredientId), onHand = Math.max(0, ing.qty);
      const avg = onHand + q > 0 ? (onHand * ing.unit_cost + q * unitCost) / (onHand + q) : unitCost;
      move(ing, q, 'purchase', { poId: id, note: `أمر شراء #${p.number}`, costCents: q * unitCost });
      S().prepare('UPDATE ingredients SET unit_cost=? WHERE id=?').run(avg, ing.id);
    }
    S().prepare("UPDATE purchase_orders SET status='received', received_at=? WHERE id=?").run(new Date().toISOString(), id);
  })();
  auth.audit('po_receive', `أمر شراء #${p.number}`);
  return poGet(id);
}

function moves(ingredientId, limit = 100) {
  const q = `SELECT m.id, m.ingredient_id AS ingredientId, i.name, i.unit, m.delta, m.reason, m.order_id AS orderId, m.note, m.created_at AS createdAt, m.user_name AS userName
    FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id ${ingredientId ? 'WHERE m.ingredient_id=?' : ''} ORDER BY m.id DESC LIMIT ?`;
  const lim = Math.max(1, Math.min(+limit || 100, 500));
  return ingredientId ? S().prepare(q).all(ingredientId, lim) : S().prepare(q).all(lim);
}

module.exports = { init, list, lowCount, save, remove, adjust, count, recipeSave, onPaid, onVoid, poList, poSave, poStatus, poReceive, moves };
