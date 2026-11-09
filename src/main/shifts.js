// الورديات وجرد الصندوق. وردية واحدة مفتوحة في الوقت نفسه. المبالغ بالهللات.
// المتوقع في الدرج = رصيد الافتتاح + النقدي المقبوض (بعد خصم الباقي) − النقدي المرتجع + إيداعات − مصروفات.
const orders = require('./orders');
const db = require('./db');
const auth = require('./auth');
const { ledger } = require('./reports');

const text = (s, max) => String(s ?? '').trim().slice(0, max);
const cents = (v, max = 10000000) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < 0 || n > max) throw new Error('مبلغ غير صالح');
  return Math.round(n * 100);
};

function init() {
  const sql = orders.raw();
  sql.exec(`
   CREATE TABLE IF NOT EXISTS shifts(
     id INTEGER PRIMARY KEY AUTOINCREMENT, opened_at TEXT NOT NULL, opened_by TEXT, opened_by_id TEXT, opening_cents INTEGER NOT NULL DEFAULT 0,
     closed_at TEXT, closed_by TEXT, counted_cents INTEGER, expected_cents INTEGER, diff_cents INTEGER, close_note TEXT, snapshot TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_shift ON shifts((1)) WHERE closed_at IS NULL;
   CREATE TABLE IF NOT EXISTS cash_moves(
     id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER NOT NULL REFERENCES shifts(id), type TEXT NOT NULL CHECK(type IN ('in','out')),
     amount_cents INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, user_name TEXT);`);
  if (!sql.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'shift_id')) sql.exec('ALTER TABLE orders ADD COLUMN shift_id INTEGER');
  if (!sql.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'void_shift_id')) sql.exec('ALTER TABLE orders ADD COLUMN void_shift_id INTEGER');
  sql.exec('CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shift_id)');
}

const sqlite = () => orders.raw();
const openRow = () => sqlite().prepare('SELECT * FROM shifts WHERE closed_at IS NULL').get() || null;
const currentId = () => openRow()?.id ?? null;
const requireShift = () => !!db.get().settings.requireShift;
function setRequireShift(v) { db.get().settings.requireShift = !!v; db.save(); auth.audit('settings', `اشتراط الوردية: ${v ? 'نعم' : 'لا'}`); }

function open(openingCash) {
  const u = auth.current();
  if (openRow()) throw new Error('توجد وردية مفتوحة بالفعل');
  const c = cents(openingCash ?? 0);
  const id = Number(sqlite().prepare('INSERT INTO shifts(opened_at,opened_by,opened_by_id,opening_cents) VALUES(?,?,?,?)').run(new Date().toISOString(), u?.name || null, u?.id || null, c).lastInsertRowid);
  auth.audit('shift_open', `وردية #${id} — رصيد الافتتاح ${(c / 100).toFixed(2)}`);
  return summary(id);
}

function addMove(type, amount, reason) {
  const s = openRow();
  if (!s) throw new Error('لا توجد وردية مفتوحة');
  if (type !== 'in' && type !== 'out') throw new Error('نوع غير صالح');
  const c = cents(amount); if (c <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  reason = text(reason, 120); if (!reason) throw new Error('اكتب السبب');
  sqlite().prepare('INSERT INTO cash_moves(shift_id,type,amount_cents,reason,created_at,user_name) VALUES(?,?,?,?,?,?)').run(s.id, type, c, reason, new Date().toISOString(), auth.current()?.name || null);
  auth.audit(type === 'in' ? 'cash_in' : 'cash_out', `وردية #${s.id}: ${(c / 100).toFixed(2)} — ${reason}`);
  return summary(s.id);
}

// ملخص وردية (مفتوحة أو مغلقة). المغلقة تُقرأ من لقطة الإغلاق لتبقى أرقامها ثابتة.
function summary(id) {
  const sql = sqlite(), s = sql.prepare('SELECT * FROM shifts WHERE id=?').get(id);
  if (!s) throw new Error('الوردية غير موجودة');
  if (s.closed_at && s.snapshot) return JSON.parse(s.snapshot);
  return build(s);
}
function build(s) {
  const sql = sqlite();
  const S = sql.prepare('SELECT * FROM orders WHERE shift_id=? AND paid_at IS NOT NULL').all(s.id);
  const R = sql.prepare("SELECT * FROM orders WHERE status='void' AND paid_at IS NOT NULL AND void_shift_id=?").all(s.id);
  const L = ledger(S, R);
  const moves = sql.prepare('SELECT type, amount_cents AS amountCents, reason, created_at AS createdAt, user_name AS userName FROM cash_moves WHERE shift_id=? ORDER BY id').all(s.id);
  const movesIn = moves.filter((m) => m.type === 'in').reduce((a, m) => a + m.amountCents, 0);
  const movesOut = moves.filter((m) => m.type === 'out').reduce((a, m) => a + m.amountCents, 0);
  const expectedCents = s.opening_cents + L.payments.cash.netCents + movesIn - movesOut;
  return {
    id: s.id, restaurant: db.get().settings.restaurant, openedAt: s.opened_at, openedBy: s.opened_by, closedAt: s.closed_at, closedBy: s.closed_by,
    openingCents: s.opening_cents, ...L, moves, movesInCents: movesIn, movesOutCents: movesOut, expectedCents,
    countedCents: s.counted_cents, diffCents: s.diff_cents, note: s.close_note || '',
    openOrders: s.closed_at ? 0 : sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='open'").get().n,
  };
}

function close(countedCash, note) {
  const s = openRow(), u = auth.current();
  if (!s) throw new Error('لا توجد وردية مفتوحة');
  const counted = cents(countedCash);
  const sql = sqlite();
  const out = sql.transaction(() => {
    const closedAt = new Date().toISOString();
    const b = build({ ...s, closed_at: closedAt });
    b.countedCents = counted; b.diffCents = counted - b.expectedCents; b.closedAt = closedAt; b.closedBy = u?.name || null; b.note = text(note, 200);
    sql.prepare('UPDATE shifts SET closed_at=?, closed_by=?, counted_cents=?, expected_cents=?, diff_cents=?, close_note=?, snapshot=? WHERE id=? AND closed_at IS NULL')
      .run(closedAt, b.closedBy, counted, b.expectedCents, b.diffCents, b.note, JSON.stringify(b), s.id);
    return b;
  })();
  auth.audit('shift_close', `وردية #${s.id} — المتوقع ${(out.expectedCents / 100).toFixed(2)}، المعدود ${(counted / 100).toFixed(2)}، الفرق ${(out.diffCents / 100).toFixed(2)}`);
  return out;
}

function list(limit = 60) {
  return sqlite().prepare('SELECT id, opened_at AS openedAt, opened_by AS openedBy, closed_at AS closedAt, closed_by AS closedBy, opening_cents AS openingCents, expected_cents AS expectedCents, counted_cents AS countedCents, diff_cents AS diffCents FROM shifts ORDER BY id DESC LIMIT ?')
    .all(Math.max(1, Math.min(+limit || 60, 200)));
}
const current = () => { const s = openRow(); return s ? build(s) : null; };

module.exports = { init, currentId, requireShift, setRequireShift, open, addMove, close, current, summary, list };
