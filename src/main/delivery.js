// إدارة التوصيل: أجرة التوصيل (منطقة/افتراضية/مجاني فوق مبلغ)، السائقون وأجورهم، حالة الطلب (تجهيز ← في الطريق ← تم التسليم).
// المبالغ بالهللات. الإعدادات والسائقون في data.json، وحالة التوصيل على صف الطلب في orders.db.
const db = require('./db');
const auth = require('./auth');
const orders = require('./orders');
const reports = require('./reports');

const STATUSES = ['preparing', 'on_the_way', 'delivered'];
const STATUS_L = { preparing: 'قيد التجهيز', on_the_way: 'في الطريق', delivered: 'تم التسليم' };
const text = (s, max) => String(s ?? '').trim().slice(0, max);
const toCents = (v, max, what) => {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n < 0 || n > max) throw new Error(`${what} غير صالح`);
  return Math.round(n * 100);
};
const uid = () => 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const cfg = () => (db.get().settings.delivery ||= { baseFeeCents: 0, freeOverCents: 0, zones: [] });

// ---------- إعدادات الأجرة ----------
function config() { const c = cfg(); return { baseFeeCents: c.baseFeeCents || 0, freeOverCents: c.freeOverCents || 0, zones: (c.zones || []).map((z) => ({ ...z })) }; }
// zones: [{ id?, name, fee }] — المبالغ بالعملة (تُحوَّل إلى هللات هنا)
function saveConfig({ baseFee, freeOver, zones } = {}) {
  const base = toCents(baseFee ?? 0, 10000, 'الأجرة الافتراضية'), free = toCents(freeOver ?? 0, 10000000, 'حد التوصيل المجاني');
  if (!Array.isArray(zones) || zones.length > 60) throw new Error('قائمة المناطق غير صالحة');
  const seen = new Set(), old = new Map((cfg().zones || []).map((z) => [z.id, z]));
  const Z = zones.map((z) => {
    const name = text(z.name, 40); if (!name) throw new Error('اسم المنطقة مطلوب');
    if (seen.has(name)) throw new Error(`المنطقة «${name}» مكررة`); seen.add(name);
    const id = z.id && old.has(z.id) ? z.id : uid();
    return { id, name, feeCents: toCents(z.fee, 10000, `أجرة «${name}»`) };
  });
  db.get().settings.delivery = { baseFeeCents: base, freeOverCents: free, zones: Z };
  db.save();
  auth.audit('delivery_config', `أجرة افتراضية ${(base / 100).toFixed(2)}، ${Z.length} منطقة${free ? '، مجاني فوق ' + (free / 100).toFixed(2) : ''}`);
  return config();
}

// حساب الأجرة من الخلفية فقط. netCents = المجموع بعد الخصم وقبل الضريبة (لحد التوصيل المجاني)
function feeFor({ zoneId, netCents = 0 } = {}) {
  const c = cfg();
  let zone = null;
  if (zoneId) { zone = (c.zones || []).find((z) => z.id === zoneId); if (!zone) throw new Error('منطقة التوصيل غير موجودة'); }
  const raw = zone ? zone.feeCents : c.baseFeeCents || 0;
  const free = !!(c.freeOverCents > 0 && netCents >= c.freeOverCents && raw > 0);
  return { feeCents: free ? 0 : raw, rawCents: raw, free, zoneId: zone ? zone.id : null, zoneName: zone ? zone.name : null };
}

// ---------- السائقون ----------
const drv = () => (db.get().drivers ||= []);
const publicDriver = (d) => ({ id: d.id, name: d.name, phone: d.phone, active: d.active, wageMode: d.wageMode, wageCents: d.wageCents, wagePct: d.wagePct });
const drivers = () => drv().map(publicDriver);
// wageMode: 'fixed' (مبلغ ثابت لكل توصيلة) | 'percent' (نسبة من أجرة التوصيل)؛ wage بالعملة أو بالنسبة
function saveDriver(p = {}) {
  const name = text(p.name, 40); if (!name) throw new Error('اسم السائق مطلوب');
  const mode = p.wageMode === 'percent' ? 'percent' : 'fixed';
  let wageCents = 0, wagePct = 0;
  if (mode === 'fixed') wageCents = toCents(p.wage ?? 0, 10000, 'أجر السائق');
  else { wagePct = Number(p.wage ?? 0); if (!Number.isFinite(wagePct) || wagePct < 0 || wagePct > 100) throw new Error('نسبة أجر السائق غير صالحة'); }
  if (drv().some((d) => d.name === name && d.id !== p.id)) throw new Error('يوجد سائق بنفس الاسم');
  let d = p.id ? drv().find((x) => x.id === p.id) : null;
  if (p.id && !d) throw new Error('السائق غير موجود');
  if (!d) { d = { id: uid(), active: true }; drv().push(d); }
  Object.assign(d, { name, phone: text(p.phone, 20), wageMode: mode, wageCents, wagePct });
  if (typeof p.active === 'boolean') d.active = p.active;
  db.save();
  auth.audit('driver_save', `${name}${d.active ? '' : ' (معطّل)'}`);
  return publicDriver(d);
}
function removeDriver(id) {
  const d = drv().find((x) => x.id === id); if (!d) throw new Error('السائق غير موجود');
  if (orders.raw().prepare('SELECT 1 FROM orders WHERE driver_id=? LIMIT 1').get(id)) throw new Error('للسائق طلبات مسجّلة؛ عطّله بدل حذفه');
  db.get().drivers = drv().filter((x) => x.id !== id); db.save();
  auth.audit('driver_delete', d.name);
}

// ---------- لوحة التوصيل ----------
function row(o) {
  return {
    id: o.id, number: o.number, createdAt: o.createdAt, customer: o.customer, totalCents: o.totalCents, feeCents: o.deliveryFeeCents, zone: o.deliveryZone,
    paid: o.status === 'paid', status: o.deliveryStatus, driverId: o.driverId, driverName: o.driverName, outAt: o.outAt, deliveredAt: o.deliveredAt,
    items: o.lines.reduce((s, l) => s + l.qty, 0), note: o.note,
  };
}
// الطلبات المفتوحة/غير المسلّمة تظهر دائماً (حتى القديمة)، والمسلّمة حسب الأيام
function board({ days = 1 } = {}) {
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (Math.max(1, Math.min(+days || 1, 30)) - 1));
  const ids = orders.raw().prepare("SELECT id FROM orders WHERE type='delivery' AND status!='void' AND (created_at>=? OR COALESCE(delivery_status,'preparing')!='delivered') ORDER BY id DESC LIMIT 300").all(from.toISOString());
  return ids.map((r) => row(orders.get(r.id)));
}
function mustDelivery(id) {
  const o = orders.get(id);
  if (o.type !== 'delivery') throw new Error('هذا ليس طلب توصيل');
  if (o.status === 'void') throw new Error('الطلب ملغي');
  return o;
}
function assign(id, driverId) {
  const o = mustDelivery(id);
  if (o.deliveryStatus === 'delivered') throw new Error('الطلب مُسلَّم؛ أرجعه إلى «في الطريق» أولاً لتغيير السائق');
  let d = null;
  if (driverId) { d = drv().find((x) => x.id === driverId); if (!d || !d.active) throw new Error('السائق غير متاح'); }
  else if (o.deliveryStatus === 'on_the_way') throw new Error('الطلب في الطريق؛ اختر سائقاً آخر بدل إزالته');
  orders.raw().prepare('UPDATE orders SET driver_id=?, driver_name=? WHERE id=?').run(d ? d.id : null, d ? d.name : null, id);
  auth.audit('delivery_assign', `#${o.number} ← ${d ? d.name : 'بلا سائق'}`);
  return row(orders.get(id));
}
const wageOf = (d, feeCents) => (!d ? 0 : d.wageMode === 'percent' ? Math.round((feeCents * (d.wagePct || 0)) / 100) : d.wageCents || 0);
// الانتقال بين الحالات المتجاورة فقط. «في الطريق» تتطلب سائقاً. أجر السائق يُثبَّت لحظة التسليم (لا يتغير بتعديل الإعداد لاحقاً)
function setStatus(id, to) {
  const o = mustDelivery(id), a = STATUSES.indexOf(o.deliveryStatus), b = STATUSES.indexOf(to);
  if (b < 0) throw new Error('حالة غير صالحة');
  if (a === b) return row(o);
  if (Math.abs(a - b) !== 1) throw new Error('انتقل خطوة واحدة في كل مرة');
  const sql = orders.raw(), now = new Date().toISOString();
  if (to === 'on_the_way') {
    if (!o.driverId) throw new Error('عيّن سائقاً أولاً');
    sql.prepare("UPDATE orders SET delivery_status='on_the_way', out_at=?, delivered_at=NULL, driver_wage_cents=NULL WHERE id=?").run(now, id);
  } else if (to === 'delivered') {
    const d = drv().find((x) => x.id === o.driverId);
    sql.prepare("UPDATE orders SET delivery_status='delivered', delivered_at=?, driver_wage_cents=? WHERE id=?").run(now, wageOf(d, o.deliveryFeeCents), id);
  } else sql.prepare("UPDATE orders SET delivery_status='preparing', out_at=NULL WHERE id=?").run(id);
  auth.audit('delivery_status', `#${o.number}: ${STATUS_L[o.deliveryStatus]} ← ${STATUS_L[to]}${o.driverName ? ' — ' + o.driverName : ''}`);
  return row(orders.get(id));
}

// ---------- أجور السائقين (حسب تاريخ التسليم؛ الملغاة مستثناة) ----------
function report({ from, to } = {}) {
  const [a, b] = reports.range(from, to);
  const rows = orders.raw().prepare("SELECT * FROM orders WHERE type='delivery' AND status!='void' AND delivery_status='delivered' AND delivered_at>=? AND delivered_at<?").all(a, b);
  const by = {};
  for (const r of rows) {
    const k = r.driver_id || '-', s = (by[k] ||= { driverId: r.driver_id, name: r.driver_name || 'بلا سائق', deliveries: 0, feeCents: 0, wageCents: 0, unpaidCents: 0, unpaidCount: 0, mins: 0, minsN: 0 });
    s.deliveries++; s.feeCents += r.delivery_fee_cents; s.wageCents += r.driver_wage_cents || 0;
    if (r.status === 'open') { s.unpaidCents += r.total_cents; s.unpaidCount++; }
    if (r.out_at && r.delivered_at) { s.mins += (new Date(r.delivered_at) - new Date(r.out_at)) / 60000; s.minsN++; }
  }
  const list = Object.values(by).map((s) => ({ driverId: s.driverId, name: s.name, deliveries: s.deliveries, feeCents: s.feeCents, wageCents: s.wageCents, netFeeCents: s.feeCents - s.wageCents, unpaidCents: s.unpaidCents, unpaidCount: s.unpaidCount, avgMinutes: s.minsN ? Math.round(s.mins / s.minsN) : null }))
    .sort((x, y) => y.deliveries - x.deliveries || x.name.localeCompare(y.name));
  const sum = (k) => list.reduce((t, x) => t + x[k], 0);
  return { from, to, drivers: list, totals: { deliveries: sum('deliveries'), feeCents: sum('feeCents'), wageCents: sum('wageCents'), netFeeCents: sum('netFeeCents'), unpaidCents: sum('unpaidCents') } };
}

module.exports = { config, saveConfig, feeFor, drivers, saveDriver, removeDriver, board, assign, setStatus, report };
