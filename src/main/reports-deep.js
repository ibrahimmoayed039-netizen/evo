// تقارير أعمق: ربحية الأصناف، أداء الفريق، أوقات الذروة. المبالغ بالهللات (قبل الضريبة).
// التكلفة تقدير: كمية الوصفة × تكلفة المكوّن الحالية (متوسط الشراء). الأصناف بلا وصفة تظهر بلا ربح ولا تُحتسب في الهامش.
const orders = require('./orders');
const db = require('./db');
const reports = require('./reports');

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// أيام الفترة محلياً: عدد كل يوم أسبوع (لحساب المتوسط لكل يوم لا المجموع)
function dayCounts(from, to) {
  const occ = Array(7).fill(0); let n = 0;
  for (let d = new Date(from + 'T00:00:00'); reports.ymd(d) <= to; d.setDate(d.getDate() + 1)) { occ[d.getDay()]++; n++; }
  return { occ, n };
}

function deep({ from, to } = {}) {
  const [a, b] = reports.range(from, to), sql = orders.raw();
  const valid = sql.prepare("SELECT * FROM orders WHERE status='paid' AND paid_at>=? AND paid_at<?").all(a, b);
  let rc = {};
  try { sql.prepare('SELECT r.item_id, SUM(r.qty * i.unit_cost) AS c FROM recipe_lines r JOIN ingredients i ON i.id = r.ingredient_id GROUP BY r.item_id').all().forEach((r) => (rc[r.item_id] = r.c)); } catch {}

  // ---- ربحية الأصناف (الإيراد بعد توزيع خصم الطلب بالتناسب) ----
  const items = {};
  for (const o of valid) {
    const k = o.subtotal_cents > 0 ? (o.subtotal_cents - o.discount_cents) / o.subtotal_cents : 1;
    for (const l of JSON.parse(o.lines)) {
      const rk = l.variantId && rc[l.itemId + '#' + l.variantId] != null ? l.itemId + '#' + l.variantId : l.itemId;
      const it = (items[rk + '|' + (l.variantId || '')] ||= { itemId: l.itemId, rk, name: l.name, qty: 0, rev: 0, hasRecipe: rc[rk] != null });
      it.qty += l.qty; it.rev += l.totalCents * k;
    }
  }
  const list = Object.values(items).map((x) => {
    const revenueCents = Math.round(x.rev), costCents = x.hasRecipe ? Math.round(rc[x.rk] * x.qty) : null;
    const profitCents = x.hasRecipe ? revenueCents - costCents : null;
    return { itemId: x.itemId, name: x.name, qty: x.qty, revenueCents, costCents, profitCents, marginPct: x.hasRecipe ? pct(profitCents, revenueCents) : null, hasRecipe: x.hasRecipe, cls: null };
  });
  const rec = list.filter((x) => x.hasRecipe), recRev = sum(rec, (x) => x.revenueCents), recProfit = sum(rec, (x) => x.profitCents), avgQty = rec.length ? sum(rec, (x) => x.qty) / rec.length : 0, avgMargin = recRev ? (recProfit / recRev) * 100 : 0;
  // هندسة المنيو: شعبية (كمية ≥ المتوسط) × ربحية (هامش ≥ المتوسط المرجّح)
  rec.forEach((x) => { const pop = x.qty >= avgQty, prof = (x.marginPct ?? 0) >= avgMargin; x.cls = pop ? (prof ? 'star' : 'horse') : (prof ? 'puzzle' : 'dog'); });
  list.sort((x, y) => (y.profitCents ?? -Infinity) - (x.profitCents ?? -Infinity) || y.revenueCents - x.revenueCents);
  const allRev = sum(list, (x) => x.revenueCents);
  const itemsSummary = { revenueCents: allRev, recipeRevenueCents: recRev, costCents: sum(rec, (x) => x.costCents), profitCents: recProfit, marginPct: pct(recProfit, recRev), coveragePct: pct(recRev, allRev), noRecipeCount: list.length - rec.length };

  // ---- أداء الفريق (حسب المستخدم الذي أنشأ/دفع الطلب) ----
  const role = {}; (db.get().users || []).forEach((u) => (role[u.name] = u.role));
  const staff = {}, S = (n) => (staff[n || '-'] ||= { name: n || '-', role: role[n] || null, orders: 0, totalCents: 0, discountOrders: 0, discountCents: 0, voidCount: 0, voidCents: 0 });
  for (const o of valid) { const s = S(o.user_name); s.orders++; s.totalCents += o.total_cents; if (o.discount_cents > 0) { s.discountOrders++; s.discountCents += o.discount_cents; } }
  sql.prepare("SELECT user_name, paid_at, total_cents FROM orders WHERE status='void' AND voided_at>=? AND voided_at<? AND COALESCE(void_reason,'') NOT LIKE 'مدموج%'").all(a, b)
    .forEach((o) => { const s = S(o.user_name); s.voidCount++; if (o.paid_at) s.voidCents += o.total_cents; });
  const staffList = Object.values(staff).map((s) => ({ ...s, avgCents: s.orders ? Math.round(s.totalCents / s.orders) : 0, discountPct: pct(s.discountCents, s.totalCents + s.discountCents), voidPct: pct(s.voidCents, s.totalCents) })).sort((x, y) => y.totalCents - x.totalCents);

  // ---- أوقات الذروة ----
  const { occ, n: days } = dayCounts(from, to);
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, totalCents: 0, avgPerDay: 0 }));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0)), dow = DAYS.map((label, i) => ({ dow: i, label, orders: 0, totalCents: 0, avgOrdersPerDay: 0 }));
  for (const o of valid) { const d = new Date(o.paid_at), h = d.getHours(), w = d.getDay(); hours[h].count++; hours[h].totalCents += o.total_cents; heat[w][h]++; dow[w].orders++; dow[w].totalCents += o.total_cents; }
  const r1 = (x) => Math.round(x * 10) / 10;
  hours.forEach((x) => (x.avgPerDay = r1(x.count / days)));
  dow.forEach((x) => (x.avgOrdersPerDay = occ[x.dow] ? r1(x.orders / occ[x.dow]) : 0));
  const heatAvg = heat.map((row, w) => row.map((c) => (occ[w] ? r1(c / occ[w]) : 0)));
  const max = Math.max(0, ...hours.map((x) => x.avgPerDay)), peaks = [];
  if (max > 0) { // كتل متصلة من الساعات ≥ 60% من أعلى ساعة
    let cur = null;
    for (const x of hours) {
      if (x.avgPerDay >= max * 0.6) { if (cur && cur.to === x.hour - 1) { cur.to = x.hour; cur.sum += x.avgPerDay; cur.n++; } else peaks.push((cur = { from: x.hour, to: x.hour, sum: x.avgPerDay, n: 1 })); }
    }
  }
  return {
    from, to, days, validCount: valid.length,
    items: { summary: itemsSummary, rows: list, avgQty: r1(avgQty), avgMarginPct: r1(avgMargin) },
    staff: staffList,
    peaks: { hours: hours.filter((x) => x.count), dow, heat: heatAvg, maxPerHour: max, blocks: peaks.map((p) => ({ from: p.from, to: p.to + 1, avgPerHour: r1(p.sum / p.n) })), lowConfidence: days < 14 },
  };
}

const num = (c) => (c / 100).toFixed(2);
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const CLS = { star: 'نجم', horse: 'حصان عمل', puzzle: 'لغز', dog: 'ضعيف' };
function toCsv(r) {
  const rows = [
    ['تقارير أعمق', `${r.from} → ${r.to}`], [],
    ['الصنف', 'الكمية', 'الإيراد (بعد الخصم، بلا ضريبة)', 'التكلفة', 'الربح', 'الهامش %', 'التصنيف'],
    ...r.items.rows.map((x) => [x.name, x.qty, num(x.revenueCents), x.hasRecipe ? num(x.costCents) : 'بلا وصفة', x.hasRecipe ? num(x.profitCents) : '', x.marginPct ?? '', CLS[x.cls] || '']), [],
    ['المستخدم', 'الدور', 'الطلبات', 'المبيعات', 'متوسط الفاتورة', 'طلبات بخصم', 'مبلغ الخصومات', 'إلغاءات', 'مبلغ المرتجع'],
    ...r.staff.map((s) => [s.name, s.role || '', s.orders, num(s.totalCents), num(s.avgCents), s.discountOrders, num(s.discountCents), s.voidCount, num(s.voidCents)]), [],
    ['الساعة', 'طلبات (المجموع)', 'متوسط الطلبات/يوم', 'المبيعات'],
    ...r.peaks.hours.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.count, h.avgPerDay, num(h.totalCents)]), [],
    ['اليوم', 'الطلبات', 'متوسط الطلبات لليوم الواحد', 'المبيعات'], ...r.peaks.dow.map((d) => [d.label, d.orders, d.avgOrdersPerDay, num(d.totalCents)]),
  ];
  return '\uFEFF' + rows.map((r2) => r2.map(cell).join(',')).join('\r\n');
}

module.exports = { deep, toCsv };
