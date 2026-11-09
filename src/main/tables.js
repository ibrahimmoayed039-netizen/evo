// الطاولات (مخطط الصالة). الحالة (فاضية/مشغولة) تُشتق من الطلبات المفتوحة، لا تُخزَّن.
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const orders = require('./orders');

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// أقرب حجز (محجوز) لكل طاولة يبدأ خلال الساعتين القادمتين أو بدأ ولم يصل صاحبه (حتى 30 د بعد الموعد)
function upcomingReservations() {
  const out = {};
  try {
    const d = new Date(), pad = (n) => String(n).padStart(2, '0'), ymd = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    const rows = orders.raw().prepare("SELECT id, name, party, date, time, table_id FROM reservations WHERE status='booked' AND table_id IS NOT NULL AND date IN (?,?) ORDER BY date, time").all(ymd(d), ymd(new Date(d.getTime() + 864e5)));
    for (const r of rows) {
      const start = new Date(`${r.date}T${r.time}:00`).getTime(), diff = (start - d.getTime()) / 60000;
      if (diff > 120 || diff < -30 || out[r.table_id]) continue;
      out[r.table_id] = { id: r.id, name: r.name, party: r.party, time: r.time, late: diff < 0 };
    }
  } catch { /* جدول الحجوزات غير موجود بعد */ }
  return out;
}

const SHAPES = ['square', 'round', 'rect'], SIZES = ['s', 'm', 'l'];
const minIso = (a) => a.reduce((m, x) => (x && (!m || x < m) ? x : m), null);
// الحالة تُشتق من الطلبات المفتوحة: free فاضية | busy مشغولة | bill تنتظر الحساب (أي طلب مفتوح عليها طُلب حسابه).
// seatedAt = أقدم طلب مفتوح (بداية الجلوس)، billAt = أقدم «طلب حساب». الطاولات القديمة بلا شكل تُعرض مستطيلة كما كانت.
function floor() {
  const by = orders.openByTable(), rs = upcomingReservations();
  return db.get().tables.map((t) => {
    const os = by[t.id] || [], billAt = minIso(os.map((o) => o.billAt));
    return { ...t, shape: SHAPES.includes(t.shape) ? t.shape : 'rect', size: SIZES.includes(t.size) ? t.size : 'm', orders: os, reservation: rs[t.id] || null,
      status: !os.length ? 'free' : billAt ? 'bill' : 'busy', seatedAt: minIso(os.map((o) => o.createdAt)), billAt, totalCents: os.reduce((s, o) => s + o.totalCents, 0) };
  });
}

function save(t) {
  const d = db.get();
  const name = String(t.name ?? '').trim().slice(0, 20);
  if (!name) throw new Error('اسم الطاولة مطلوب');
  if (d.tables.some((x) => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error('اسم الطاولة مستخدم');
  const n = d.tables.length;
  const rec = {
    id: t.id || crypto.randomUUID(), name,
    area: String(t.area ?? '').trim().slice(0, 30) || 'الصالة',
    seats: Math.round(num(t.seats, 1, 50, 4)),
    shape: SHAPES.includes(t.shape) ? t.shape : 'rect', size: SIZES.includes(t.size) ? t.size : 'm',
    x: num(t.x, 3, 97, 12 + ((n * 14) % 76)), y: num(t.y, 6, 94, 15 + (Math.floor((n * 14) / 76) * 22) % 70),
  };
  const i = d.tables.findIndex((x) => x.id === rec.id);
  if (t.id && i < 0) throw new Error('الطاولة غير موجودة');
  if (i >= 0) { d.tables[i] = rec; orders.relabel(rec.id, rec.name); } else d.tables.push(rec);
  db.save();
  auth.audit(i >= 0 ? 'table_update' : 'table_create', rec.name);
  return rec;
}

function remove(id) {
  const d = db.get(), t = d.tables.find((x) => x.id === id);
  if (!t) throw new Error('الطاولة غير موجودة');
  if ((orders.openByTable()[id] || []).length) throw new Error('عليها طلبات مفتوحة، أغلقها أو انقلها أولاً');
  d.tables = d.tables.filter((x) => x.id !== id);
  db.save();
  auth.audit('table_delete', t.name);
}

module.exports = { floor, save, remove };
