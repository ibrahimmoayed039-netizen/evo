// الحجوزات: موعد + عدد أشخاص + طاولة اختيارية. تخزين SQLite في orders.db.
// الحجز يمنع غيره على نفس الطاولة في نفس الفترة (محجوز أو جالس فقط). الوقت محلي (التاريخ YYYY-MM-DD والساعة HH:MM).
const orders = require('./orders');
const db = require('./db');
const auth = require('./auth');
const crm = require('./crm');

const sqlite = () => orders.raw();
const text = (s, max) => String(s ?? '').trim().slice(0, max);
const STATUS = { booked: 'محجوز', seated: 'جلس', completed: 'منتهي', cancelled: 'ملغي', no_show: 'لم يحضر' };
const NEXT = { booked: ['seated', 'cancelled', 'no_show'], seated: ['completed'], cancelled: ['booked'], no_show: ['booked'], completed: [] };
const BLOCKING = "('booked','seated')";

function init() {
  sqlite().exec(`
   CREATE TABLE IF NOT EXISTS reservations(
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, party INTEGER NOT NULL,
     date TEXT NOT NULL, time TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 90, table_id TEXT, note TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','seated','completed','cancelled','no_show')),
     customer_id TEXT, created_at TEXT NOT NULL, created_by TEXT);
   CREATE INDEX IF NOT EXISTS idx_res_date ON reservations(date, time);`);
}

const startOf = (date, time) => new Date(`${date}T${time}:00`);
const validDate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const x = new Date(d + 'T00:00:00');
  return !Number.isNaN(x.getTime()) && x.getDate() === +d.slice(8);
};
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const tableName = (id) => db.get().tables.find((t) => t.id === id)?.name || '';

const toRes = (r) => r && {
  id: r.id, name: r.name, phone: r.phone, party: r.party, date: r.date, time: r.time, durationMin: r.duration_min,
  tableId: r.table_id, table: r.table_id ? tableName(r.table_id) : '', note: r.note, status: r.status, customerId: r.customer_id,
  createdAt: r.created_at, createdBy: r.created_by,
};
function get(id) {
  const r = toRes(sqlite().prepare('SELECT * FROM reservations WHERE id=?').get(id));
  if (!r) throw new Error('الحجز غير موجود');
  return r;
}
const list = ({ date } = {}) => {
  if (!validDate(date)) throw new Error('تاريخ غير صالح');
  return sqlite().prepare('SELECT * FROM reservations WHERE date=? ORDER BY time, id').all(date).map(toRes);
};

// يتحقق من تعارض الطاولة (يستثني الحجز نفسه)
function checkTable(tableId, party, date, time, dur, selfId) {
  if (!tableId) return;
  const t = db.get().tables.find((x) => x.id === tableId);
  if (!t) throw new Error('الطاولة غير موجودة');
  if (party > t.seats) throw new Error(`${t.name} تتسع ${t.seats} فقط`);
  const s = startOf(date, time).getTime(), e = s + dur * 60000;
  const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  for (const r of sqlite().prepare(`SELECT * FROM reservations WHERE table_id=? AND date IN (?,?,?) AND status IN ${BLOCKING} AND id<>?`)
    .all(tableId, date, day(s - 864e5), day(s + 864e5), selfId || 0)) {
    const rs = startOf(r.date, r.time).getTime(), re = rs + r.duration_min * 60000;
    if (s < re && rs < e) throw new Error(`${t.name} محجوزة في هذا الوقت (${r.name} ${r.time})`);
  }
}

function save(p) {
  const name = text(p.name, 60); if (!name) throw new Error('اسم صاحب الحجز مطلوب');
  const phone = crm.normPhone(p.phone);
  const party = Number(p.party); if (!Number.isInteger(party) || party < 1 || party > 50) throw new Error('عدد الأشخاص غير صالح');
  if (!validDate(p.date)) throw new Error('تاريخ غير صالح');
  if (!validTime(p.time)) throw new Error('وقت غير صالح');
  const dur = p.durationMin === undefined || p.durationMin === '' ? 90 : Number(p.durationMin);
  if (!Number.isInteger(dur) || dur < 15 || dur > 480) throw new Error('مدة الحجز بين 15 و480 دقيقة');
  const tableId = p.tableId || null;
  let cur = null;
  if (p.id) { cur = sqlite().prepare('SELECT * FROM reservations WHERE id=?').get(p.id); if (!cur) throw new Error('الحجز غير موجود'); }
  if (cur && (cur.status === 'completed' || cur.status === 'seated')) throw new Error('لا يمكن تعديل حجز جلس أو انتهى');
  if (!cur && startOf(p.date, p.time).getTime() < Date.now() - 15 * 60000) throw new Error('وقت الحجز في الماضي');
  checkTable(tableId, party, p.date, p.time, dur, p.id);
  const cust = crm.findByPhone(phone);
  const vals = [name, phone, party, p.date, p.time, dur, tableId, text(p.note, 200), cust?.id || null];
  let id = p.id;
  if (id) sqlite().prepare('UPDATE reservations SET name=?, phone=?, party=?, date=?, time=?, duration_min=?, table_id=?, note=?, customer_id=? WHERE id=?').run(...vals, id);
  else id = Number(sqlite().prepare('INSERT INTO reservations(name,phone,party,date,time,duration_min,table_id,note,customer_id,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(...vals, new Date().toISOString(), auth.current()?.name || null).lastInsertRowid);
  auth.audit(p.id ? 'reservation_update' : 'reservation_create', `#${id} ${name} — ${p.date} ${p.time} (${party})`);
  return get(id);
}

// tableId اختياري: يُستخدم لتعيين/تغيير الطاولة عند الجلوس
function setStatus(id, to, tableId) {
  const r = get(id);
  if (!STATUS[to]) throw new Error('حالة غير صالحة');
  if (!NEXT[r.status].includes(to)) throw new Error(`لا يمكن الانتقال من «${STATUS[r.status]}» إلى «${STATUS[to]}»`);
  const tid = tableId || r.tableId;
  if (to === 'seated') {
    if (!tid) throw new Error('حدّد طاولة لجلوس العميل');
    checkTable(tid, r.party, r.date, r.time, r.durationMin, id);
    const busy = orders.openByTable()[tid];
    if (busy?.length) throw new Error(`${tableName(tid)} عليها طلب مفتوح الآن`);
  }
  if (to === 'booked') checkTable(r.tableId, r.party, r.date, r.time, r.durationMin, id); // استعادة حجز ملغي قد تتعارض
  sqlite().prepare('UPDATE reservations SET status=?, table_id=? WHERE id=?').run(to, to === 'seated' ? tid : r.tableId, id);
  auth.audit('reservation_status', `#${id} ${r.name}: ${STATUS[r.status]} ← ${STATUS[to]}`);
  return get(id);
}

// عدد حجوزات اليوم التي لم يصل أصحابها بعد (لشارة القائمة)
const pendingToday = () => {
  const d = new Date(), ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return sqlite().prepare("SELECT COUNT(*) AS n FROM reservations WHERE date=? AND status='booked'").get(ymd).n;
};

// بيانات تعبئة الكاشير عند الإجلاس: الطاولة والعميل (المسجّل أو بيانات الحجز)
function seatPrefill(id) {
  const r = get(id);
  if (r.status !== 'seated') throw new Error('الحجز لم يُجلَس بعد');
  const c = r.customerId ? crm.findByPhone(r.phone) : null;
  return { reservationId: r.id, tableId: r.tableId, table: r.table, party: r.party, name: r.name, phone: r.phone, customer: c ? { id: c.id, name: c.name, phone: c.phone, points: c.points } : null };
}

module.exports = { seatPrefill, init, list, get, save, setStatus, pendingToday };
