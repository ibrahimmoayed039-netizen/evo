// اللوحة الرئيسية: مبيعات اليوم، عدد الطلبات، أكثر الأصناف مبيعاً، أوقات الذروة (تعتمد على $ و esc و errMsg من renderer.js، و money من pos.js)
// تستخدم قناة التقارير الموجودة (report:sales) فلا تحتاج صلاحيات أو قنوات جديدة.
const dbYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dbOff = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dbYmd(d); };
const DB_RANGES = [['today', 'اليوم', 0], ['week', 'آخر 7 أيام', -6], ['month', 'آخر 30 يوماً', -29]];
let DBS = { range: 'today' };

// مقارنة بنسبة مئوية: ▲ ارتفاع / ▼ انخفاض (لا تُعرض إن لم تكن هناك قيمة سابقة)
const dbDelta = (now, before, label) => {
  if (!before) return `<span class="dbd">${label}: —</span>`;
  const p = Math.round(((now - before) / before) * 100);
  if (p === 0) return `<span class="dbd">= بلا تغيير ${label}</span>`;
  return `<span class="dbd ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% ${label}</span>`;
};

function dbHoursChart(byHour) {
  const by = {}; byHour.forEach((h) => (by[h.hour] = h));
  const act = byHour.filter((h) => h.count > 0).map((h) => h.hour);
  if (!act.length) return { html: '<div class="muted">لا توجد طلبات في هذه الفترة بعد</div>', peak: null };
  const start = Math.min(10, ...act), end = Math.max(22, ...act);
  const max = Math.max(...act.map((h) => by[h].count));
  const peak = act.reduce((a, h) => (by[h].count > by[a].count ? h : a), act[0]);
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  let cols = '';
  for (let h = start; h <= end; h++) {
    const x = by[h] || { count: 0, totalCents: 0 };
    cols += `<div class="dbh-c${h === peak ? ' pk' : ''}" title="${hh(h)} — ${x.count} طلب — ${money(x.totalCents)}"><span>${x.count || ''}</span><i style="height:${x.count ? Math.max(4, Math.round((x.count / max) * 120)) : 2}px"></i><small>${String(h).padStart(2, '0')}</small></div>`;
  }
  return { html: `<div class="dbh">${cols}</div>`, peak: { hour: peak, label: `${hh(peak)} – ${hh((peak + 1) % 24)}`, count: by[peak].count } };
}

function dbItemsChart(items) {
  const top = (items || []).slice(0, 5);
  if (!top.length) return '<div class="muted">لا توجد مبيعات في هذه الفترة بعد</div>';
  const max = Math.max(1, ...top.map((x) => x.qty));
  return `<div class="dbi">${top.map((x, i) => `<div class="dbi-r"><span class="dbi-n">${i + 1}</span><div class="dbi-m"><div class="dbi-t"><b>${esc(x.name)}</b><small>${money(x.totalCents)}</small></div><div class="bar"><i style="width:${Math.max(3, Math.round((x.qty / max) * 100))}%"></i></div></div><span class="dbi-q">${x.qty}</span></div>`).join('')}</div>`;
}

async function viewDashboard() {
  $('content').classList.add('wide');
  const today = dbOff(0), cur = DB_RANGES.find((r) => r[0] === DBS.range) || DB_RANGES[0];
  let t, y, c, err = '';
  try {
    [t, y] = await Promise.all([api.reportSales({ from: today, to: today }), api.reportSales({ from: dbOff(-1), to: dbOff(-1) })]);
    c = cur[0] === 'today' ? t : await api.reportSales({ from: dbOff(cur[2]), to: today });
  } catch (e) { err = errMsg(e); }
  const now = new Date(), hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateTxt = now.toLocaleDateString('ar-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const head = `<div class="dbhead"><div><h2>لوحة التحكم</h2><small class="muted-l">${esc(dateTxt)} — آخر تحديث ${hm}</small></div><button id="dbRefresh" class="sm sec">↻ تحديث</button></div>`;
  if (err || !t) { $('content').innerHTML = `${head}<div class="card err">${esc(err || 'تعذّر تحميل البيانات')}</div>`; if ($('dbRefresh')) $('dbRefresh').onclick = viewDashboard; return; }
  const hrs = dbHoursChart(c.byHour);
  const kpi = (title, val, sub, cls = '') => `<div class="dbk ${cls}"><small>${title}</small><b>${val}</b><div>${sub}</div></div>`;
  const refund = t.refunds.count ? `<span class="dbd down">مرتجعات: ${money(t.refunds.totalCents)}</span>` : '';
  $('content').innerHTML = `${head}
   <div class="dbks">
    ${kpi('مبيعات اليوم', money(t.netCents), `${dbDelta(t.netCents, y.netCents, 'عن أمس')} ${refund}`, 'main')}
    ${kpi('عدد الطلبات', t.validCount, dbDelta(t.validCount, y.validCount, 'عن أمس'))}
    ${kpi('متوسط الفاتورة', money(t.avgCents), dbDelta(t.avgCents, y.avgCents, 'عن أمس'))}
   </div>
   <div class="tabs dbr">${DB_RANGES.map(([k, l]) => `<button class="${DBS.range === k ? 'on' : ''}" data-dbr="${k}">${l}</button>`).join('')}<span class="muted-l">الرسوم أدناه حسب الفترة المختارة</span></div>
   <div class="cols">
    <div class="card"><b>أكثر الأصناف مبيعاً</b><small class="muted-l"> (حسب الكمية — ${cur[1]})</small>${dbItemsChart(c.topItemsQty)}</div>
    <div class="card"><b>أوقات الذروة</b><small class="muted-l"> (عدد الطلبات لكل ساعة — ${cur[1]})</small>${hrs.html}
     ${hrs.peak ? `<div class="dbpk">🔥 ذروة الطلبات: <b>${hrs.peak.label}</b> (${hrs.peak.count} طلب)</div>` : ''}</div>
   </div>`;
  $('dbRefresh').onclick = viewDashboard;
  document.querySelectorAll('[data-dbr]').forEach((b) => (b.onclick = () => { DBS.range = b.dataset.dbr; viewDashboard(); }));
}
