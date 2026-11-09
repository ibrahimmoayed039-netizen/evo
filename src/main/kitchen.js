// المطبخ: محطات + تذاكر (KOT) + حالة التحضير. تُشتق الكميات غير المرسلة من sentQty في سطور الطلب.
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const orders = require('./orders');

const TYPES = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };
const stations = () => db.get().stations;
const enabled = () => stations().length > 0;
const station = (id) => stations().find((s) => s.id === id);
const sql = () => orders.raw();

const row = (r) => r && ({
  id: r.id, orderId: r.order_id, orderNumber: r.order_number, stationId: r.station_id, stationName: r.station_name, batch: r.batch,
  type: r.type, tableLabel: r.table_label, items: JSON.parse(r.items), status: r.status,
  createdAt: r.created_at, startedAt: r.started_at, readyAt: r.ready_at,
});
const ticket = (id) => { const t = row(sql().prepare('SELECT * FROM tickets WHERE id=?').get(id)); if (!t) throw new Error('التذكرة غير موجودة'); return t; };

// ---------- المحطات ----------
function saveStation(s) {
  const d = db.get();
  const name = String(s.name ?? '').trim().slice(0, 20);
  if (!name) throw new Error('اسم المحطة مطلوب');
  if (d.stations.some((x) => x.id !== s.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error('اسم المحطة مستخدم');
  const pr = s.printer || {};
  const printer = {
    mode: pr.mode === 'escpos' ? 'escpos' : 'system', width: +pr.width === 58 ? 58 : 80,
    deviceName: String(pr.deviceName ?? '').trim().slice(0, 120), host: String(pr.host ?? '').trim().slice(0, 60),
  };
  if (!/^[\w.\-:]*$/.test(printer.host)) throw new Error('عنوان الطابعة غير صالح');
  const autoPrint = !!s.autoPrint;
  if (autoPrint && printer.mode === 'system' && !printer.deviceName) throw new Error('اختر الطابعة للطباعة التلقائية');
  if (autoPrint && printer.mode === 'escpos' && !printer.host) throw new Error('أدخل عنوان IP للطابعة');
  const i = d.stations.findIndex((x) => x.id === s.id);
  if (s.id && i < 0) throw new Error('المحطة غير موجودة');
  const rec = { id: s.id || crypto.randomUUID(), name, autoPrint, printer };
  if (i >= 0) d.stations[i] = rec; else d.stations.push(rec);
  db.save(); auth.audit(i >= 0 ? 'station_update' : 'station_create', name);
  return rec;
}
function deleteStation(id) {
  const d = db.get(), s = station(id);
  if (!s) throw new Error('المحطة غير موجودة');
  if (sql().prepare("SELECT COUNT(*) c FROM tickets WHERE station_id=? AND status IN ('new','preparing','ready','cancelled')").get(id).c) throw new Error('عليها تذاكر نشطة، أنهِها أولاً');
  d.stations = d.stations.filter((x) => x.id !== id);
  d.items.forEach((it) => { if (it.stationId === id) it.stationId = ''; });
  db.save(); auth.audit('station_delete', s.name);
}

// ---------- الإرسال ----------
// يُنشئ تذكرة لكل محطة بالأصناف التي لم تُرسل بعد. الصنف بلا محطة يذهب لأول محطة.
function send(orderId) {
  if (!enabled()) throw new Error('لم تُعرَّف محطات مطبخ');
  const o = orders.get(orderId), d = db.get();
  if (!['open', 'paid'].includes(o.status)) throw new Error('لا يمكن الإرسال لطلب ملغي');
  const by = new Map(), lines = o.lines.map((l) => ({ ...l }));
  for (const l of lines) {
    const delta = l.qty - (l.sentQty || 0);
    if (delta <= 0) continue;
    const st = station(d.items.find((x) => x.id === l.itemId)?.stationId) || d.stations[0];
    if (!by.has(st.id)) by.set(st.id, { st, items: [] });
    by.get(st.id).items.push({ name: l.name, qty: delta, mods: l.mods.map((m) => m.name), note: l.note });
    l.sentQty = l.qty;
  }
  if (!by.size) throw new Error('لا توجد أصناف جديدة للإرسال');
  const now = new Date().toISOString(), db3 = sql();
  const ids = db3.transaction(() => {
    const batch = db3.prepare('SELECT COALESCE(MAX(batch),0)+1 b FROM tickets WHERE order_id=?').get(orderId).b;
    const ins = db3.prepare("INSERT INTO tickets(order_id,order_number,station_id,station_name,batch,type,table_label,items,status,created_at) VALUES(?,?,?,?,?,?,?,?,'new',?)");
    const out = [...by.values()].map(({ st, items }) => Number(ins.run(orderId, o.number, st.id, st.name, batch, TYPES[o.type], o.table || '', JSON.stringify(items), now).lastInsertRowid));
    db3.prepare('UPDATE orders SET lines=? WHERE id=?').run(JSON.stringify(lines), orderId);
    return out;
  })();
  auth.audit('kitchen_send', `#${o.number} → ${[...by.values()].map((x) => x.st.name).join('، ')}`);
  return ids.map(ticket);
}

// ---------- الشاشة ----------
const board = (stationId) => {
  const q = "SELECT * FROM tickets WHERE status IN ('new','preparing','ready','cancelled')" + (stationId ? ' AND station_id=?' : '') + ' ORDER BY id';
  return (stationId ? sql().prepare(q).all(stationId) : sql().prepare(q).all()).map(row);
};
const FLOW = {
  start: { from: ['new'], to: 'preparing', col: 'started_at' },
  ready: { from: ['new', 'preparing'], to: 'ready', col: 'ready_at' },
  done: { from: ['ready'], to: 'done', col: 'done_at' },
  ack: { from: ['cancelled'], to: 'ack' },
};
function bump(id, action) {
  const t = ticket(id);
  if (action === 'back') {
    const to = { ready: 'preparing', preparing: 'new' }[t.status];
    if (!to) throw new Error('لا يمكن التراجع');
    sql().prepare('UPDATE tickets SET status=? WHERE id=?').run(to, id);
  } else {
    const f = FLOW[action];
    if (!f || !f.from.includes(t.status)) throw new Error('إجراء غير صالح لحالة التذكرة');
    sql().prepare(`UPDATE tickets SET status=?${f.col ? `, ${f.col}=?` : ''} WHERE id=?`).run(...[f.to, ...(f.col ? [new Date().toISOString()] : []), id]);
  }
  return ticket(id);
}

module.exports = { enabled, stations, station, saveStation, deleteStation, send, board, bump, ticket };
