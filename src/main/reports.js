// التقارير + حساب دفتر المبيعات (مشترك مع الورديات). المبالغ بالهللات.
// دفتر المبيعات: المبيعات تُحسب في فترة الدفع، والمرتجعات (إلغاء طلب بعد دفعه) في فترة الإلغاء. الصافي = المبيعات − المرتجعات.
const orders = require('./orders');
const db = require('./db');

const METHODS = ['cash', 'card', 'other'];
const TYPES = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };
const zero = () => ({ cash: 0, card: 0, other: 0 });
const sumBy = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

// مبلغ كل طريقة دفع لكل طلب، مع خصم الباقي من النقدي (فيكون مجموعها = إجمالي الطلب)
function payParts(rows) {
  const map = new Map();
  const sql = orders.raw();
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.id);
    sql.prepare(`SELECT order_id, method, SUM(amount_cents) AS a FROM payments WHERE order_id IN (${ids.map(() => '?').join(',')}) GROUP BY order_id, method`)
      .all(...ids).forEach((x) => { const m = map.get(x.order_id) || zero(); m[x.method] += x.a; map.set(x.order_id, m); });
  }
  rows.forEach((r) => { const m = map.get(r.id); if (m) m.cash -= r.change_cents; });
  return map;
}

function ledger(sales, refunds) {
  const sp = payParts(sales), rp = payParts(refunds), payments = {};
  for (const m of METHODS) {
    const inCents = sales.reduce((s, r) => s + (sp.get(r.id)?.[m] || 0), 0);
    const refundCents = refunds.reduce((s, r) => s + (rp.get(r.id)?.[m] || 0), 0);
    payments[m] = { inCents, refundCents, netCents: inCents - refundCents };
  }
  const S = { count: sales.length, subtotalCents: sumBy(sales, 'subtotal_cents'), discountCents: sumBy(sales, 'discount_cents'), vatCents: sumBy(sales, 'vat_cents'), totalCents: sumBy(sales, 'total_cents') };
  const R = { count: refunds.length, totalCents: sumBy(refunds, 'total_cents'), vatCents: sumBy(refunds, 'vat_cents') };
  return { sales: S, refunds: R, netCents: S.totalCents - R.totalCents, payments };
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function range(from, to) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && ymd(new Date(s + 'T00:00:00')) === s;
  if (!ok(from) || !ok(to)) throw new Error('تاريخ غير صالح');
  const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
  b.setDate(b.getDate() + 1);
  if (!(a < b)) throw new Error('تاريخ النهاية قبل البداية');
  if (b - a > 367 * 86400000) throw new Error('الفترة أطول من سنة');
  return [a.toISOString(), b.toISOString()];
}

function sales({ from, to } = {}) {
  const [a, b] = range(from, to), sql = orders.raw();
  const S = sql.prepare('SELECT * FROM orders WHERE paid_at>=? AND paid_at<?').all(a, b);
  const R = sql.prepare("SELECT * FROM orders WHERE status='void' AND paid_at IS NOT NULL AND voided_at>=? AND voided_at<?").all(a, b);
  const cancelled = sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='void' AND paid_at IS NULL AND voided_at>=? AND voided_at<? AND COALESCE(void_reason,'') NOT LIKE 'مدموج%'").get(a, b).n;
  const valid = S.filter((o) => o.status === 'paid'); // التفصيل للطلبات السارية فقط
  const d = db.get(), catOf = {}, catName = {};
  d.items.forEach((i) => { catOf[i.id] = i.categoryId; });
  d.categories.forEach((c) => { catName[c.id] = c.name; });

  const byType = {}, byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, totalCents: 0 })), daily = {}, byUser = {}, items = {}, cats = {};
  for (const o of valid) {
    const t = (byType[o.type] ||= { type: o.type, label: TYPES[o.type] || o.type, count: 0, totalCents: 0 }); t.count++; t.totalCents += o.total_cents;
    const dt = new Date(o.paid_at), h = byHour[dt.getHours()]; h.count++; h.totalCents += o.total_cents;
    const k = ymd(dt), dd = (daily[k] ||= { date: k, count: 0, totalCents: 0 }); dd.count++; dd.totalCents += o.total_cents;
    const u = (byUser[o.user_name || '-'] ||= { name: o.user_name || '-', count: 0, totalCents: 0 }); u.count++; u.totalCents += o.total_cents;
    for (const l of JSON.parse(o.lines)) {
      const it = (items[l.itemId] ||= { name: l.name, qty: 0, totalCents: 0 }); it.qty += l.qty; it.totalCents += l.totalCents;
      const cn = catName[catOf[l.itemId]] || 'غير مصنف', c = (cats[cn] ||= { name: cn, qty: 0, totalCents: 0 }); c.qty += l.qty; c.totalCents += l.totalCents;
    }
  }
  const top = (o, n) => Object.values(o).sort((x, y) => y.totalCents - x.totalCents).slice(0, n);
  const L = ledger(S, R);
  // تكلفة البضاعة التقديرية من حركات المخزون (بيع − إرجاع) للأصناف التي لها وصفة فقط
  let cogs = 0;
  try { cogs = Math.round(-sql.prepare("SELECT COALESCE(SUM(cost_cents),0) AS c FROM stock_moves WHERE reason IN ('sale','void') AND created_at>=? AND created_at<?").get(a, b).c); } catch {}
  const revenueExVat = L.sales.totalCents - L.sales.vatCents - (L.refunds.totalCents - L.refunds.vatCents);
  return {
    from, to, ...L, deliveryFeeCents: sumBy(valid, 'delivery_fee_cents'), cogsCents: cogs, revenueExVatCents: revenueExVat, grossProfitCents: cogs ? revenueExVat - cogs : null, cancelledUnpaid: cancelled, validCount: valid.length,
    avgCents: valid.length ? Math.round(sumBy(valid, 'total_cents') / valid.length) : 0,
    byType: Object.values(byType), byHour: byHour.filter((h) => h.count), daily: Object.values(daily).sort((x, y) => x.date.localeCompare(y.date)),
    byUser: top(byUser, 20), topItems: top(items, 15), topItemsQty: Object.values(items).sort((x, y) => y.qty - x.qty || y.totalCents - x.totalCents).slice(0, 15), byCategory: top(cats, 30),
  };
}

// CSV بترميز UTF-8 مع BOM ليفتح العربي صحيحاً في Excel
const num = (c) => (c / 100).toFixed(2);
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(r) {
  const rows = [
    ['تقرير المبيعات', `${r.from} → ${r.to}`], [],
    ['عدد الطلبات المدفوعة', r.sales.count], ['المجموع قبل الخصم', num(r.sales.subtotalCents)], ['الخصومات', num(r.sales.discountCents)],
    ['الضريبة', num(r.sales.vatCents)], ['إجمالي المبيعات', num(r.sales.totalCents)], ['المرتجعات (عدد)', r.refunds.count], ['المرتجعات (مبلغ)', num(r.refunds.totalCents)],
    ['الصافي', num(r.netCents)], ['تكلفة البضاعة التقديرية', num(r.cogsCents || 0)], ['هامش إجمالي (بدون ضريبة)', r.grossProfitCents == null ? '' : num(r.grossProfitCents)], [],
    ['طريقة الدفع', 'مقبوض', 'مرتجع', 'الصافي'], ...['cash', 'card', 'other'].map((m) => [{ cash: 'نقدي', card: 'بطاقة', other: 'أخرى' }[m], num(r.payments[m].inCents), num(r.payments[m].refundCents), num(r.payments[m].netCents)]), [],
    ['اليوم', 'عدد الطلبات', 'المبلغ'], ...r.daily.map((x) => [x.date, x.count, num(x.totalCents)]), [],
    ['الصنف', 'الكمية', 'المبلغ'], ...r.topItems.map((x) => [x.name, x.qty, num(x.totalCents)]), [],
    ['التصنيف', 'الكمية', 'المبلغ'], ...r.byCategory.map((x) => [x.name, x.qty, num(x.totalCents)]),
  ];
  return '\uFEFF' + rows.map((r2) => r2.map(cell).join(',')).join('\r\n');
}

module.exports = { ledger, sales, toCsv, range, ymd };
