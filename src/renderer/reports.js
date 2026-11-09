// صفحة التقارير (تعتمد على $ و esc و errMsg من renderer.js، و money/flash من pos.js)
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOff = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymdLocal(d); };
let RP = { from: dayOff(0), to: dayOff(0), tab: 'overview', cap: 8 };

const bars = (rows, label, val, fmt = money) => {
  const max = Math.max(1, ...rows.map(val));
  return `<table class="tt">${rows.map((r) => `<tr><td style="width:110px">${esc(label(r))}</td><td><div class="bar"><i style="width:${Math.max(2, Math.round((val(r) / max) * 100))}%"></i></div></td><td style="width:90px">${fmt(val(r))}</td></tr>`).join('')}</table>`;
};

async function viewReports() {
  $('content').classList.add('wide');
  RP.tab ||= 'overview'; RP.cap ||= 8;
  let r, d, err = '';
  try { if (RP.tab === 'overview') r = await api.reportSales({ from: RP.from, to: RP.to }); else d = await api.reportDeep({ from: RP.from, to: RP.to }); } catch (e) { err = errMsg(e); }
  const TABS = [['overview', 'نظرة عامة'], ['items', 'ربحية الأصناف'], ['staff', 'أداء الفريق'], ['peaks', 'أوقات الذروة']];
  const tabsHtml = `<div class="tabs">${TABS.map(([k, l]) => `<button class="${RP.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
  const Q = [['اليوم', 0, 0], ['أمس', -1, -1], ['آخر 7 أيام', -6, 0], ['آخر 30 يوماً', -29, 0]];
  const card = (t, v, c = '') => `<div class="stat ${c}"><small>${t}</small><b>${v}</b></div>`;
  $('content').innerHTML = `<h2>التقارير</h2>
   <div class="card"><div class="tabs">${Q.map(([l, a, b]) => `<button class="${RP.from === dayOff(a) && RP.to === dayOff(b) ? 'on' : ''}" data-q="${a},${b}">${l}</button>`).join('')}
    <button class="${RP.from === ymdLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) && RP.to === dayOff(0) ? 'on' : ''}" data-q="month">هذا الشهر</button></div>
    <div class="drow"><label>من</label><input type="date" id="rpFrom" value="${esc(RP.from)}"><label>إلى</label><input type="date" id="rpTo" value="${esc(RP.to)}">
     <button id="rpGo" class="sm">عرض</button><button id="rpCsv" class="sm sec">تصدير CSV</button></div><div id="rpErr" class="err">${esc(err)}</div></div>
   ${tabsHtml}${r ? `<div class="stats">${card('إجمالي المبيعات', money(r.sales.totalCents))}${card('المرتجعات', '-' + money(r.refunds.totalCents), r.refunds.count ? 'bad' : '')}${card('الصافي', money(r.netCents), 'good')}
     ${card('عدد الطلبات', r.sales.count)}${card('متوسط الفاتورة', money(r.avgCents))}${card('الضريبة', money(r.sales.vatCents))}${card('الخصومات', money(r.sales.discountCents))}${r.deliveryFeeCents ? card('أجور التوصيل', money(r.deliveryFeeCents)) : ''}${card('ملغاة غير مدفوعة', r.cancelledUnpaid)}${r.cogsCents ? card('تكلفة البضاعة (تقديرية)', money(r.cogsCents)) + card('هامش إجمالي (بلا ضريبة)', money(r.grossProfitCents), r.grossProfitCents >= 0 ? 'good' : 'bad') : ''}</div>
    <p class="muted">إجمالي المبيعات يشمل كل ما دُفع في الفترة، والمرتجعات هي الطلبات التي أُلغيت بعد دفعها في الفترة؛ الصافي = الفرق بينهما. الجداول التالية تخص الطلبات السارية فقط (${r.validCount}).${r.cogsCents ? ' التكلفة والهامش تقديران من وصفات المخزون وتشمل الأصناف التي لها وصفة فقط.' : ''}</p>
    <div class="cols">
     <div class="card"><b>طرق الدفع (صافي)</b><table class="tt">${['cash', 'card', 'other'].map((k) => `<tr><td>${PAY_L[k]}</td><td>${money(r.payments[k].netCents)}</td></tr>`).join('')}</table>
      <b>نوع الطلب</b>${r.byType.length ? bars(r.byType, (x) => `${x.label} (${x.count})`, (x) => x.totalCents) : '<div class="muted">—</div>'}</div>
     <div class="card"><b>المبيعات حسب الساعة</b>${r.byHour.length ? bars(r.byHour, (x) => `${String(x.hour).padStart(2, '0')}:00`, (x) => x.totalCents) : '<div class="muted">—</div>'}</div>
    </div>
    ${r.daily.length > 1 ? `<div class="card"><b>المبيعات اليومية</b>${bars(r.daily, (x) => x.date, (x) => x.totalCents)}</div>` : ''}
    <div class="cols">
     <div class="card"><b>الأكثر مبيعاً</b><table><tr><th>الصنف</th><th>الكمية</th><th>المبلغ</th></tr>${r.topItems.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${money(x.totalCents)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}</table></div>
     <div class="card"><b>حسب التصنيف</b><table><tr><th>التصنيف</th><th>الكمية</th><th>المبلغ</th></tr>${r.byCategory.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${money(x.totalCents)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}</table>
      <b>حسب المستخدم</b><table><tr><th>الاسم</th><th>الطلبات</th><th>المبلغ</th></tr>${r.byUser.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.count}</td><td>${money(x.totalCents)}</td></tr>`).join('')}</table></div>
    </div><p class="muted">مبالغ الأصناف قبل الخصم والضريبة.</p>` : ''}${deepBody(d, RP.tab, RP.cap)}`;
  document.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
    if (b.dataset.q === 'month') { const n = new Date(); RP = { ...RP, from: ymdLocal(new Date(n.getFullYear(), n.getMonth(), 1)), to: dayOff(0) }; }
    else { const [a, c] = b.dataset.q.split(',').map(Number); RP = { ...RP, from: dayOff(a), to: dayOff(c) }; }
    viewReports();
  }));
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { RP.tab = b.dataset.tab; viewReports(); }));
  if ($('rpCap')) $('rpCap').onchange = () => { RP.cap = Math.min(60, Math.max(1, Math.floor(Number($('rpCap').value)) || 8)); viewReports(); };
  $('rpGo').onclick = () => { RP = { ...RP, from: $('rpFrom').value, to: $('rpTo').value }; viewReports(); };
  $('rpCsv').onclick = async () => {
    try { if (await (RP.tab === 'overview' ? api.reportExport : api.reportExportDeep)({ from: $('rpFrom').value, to: $('rpTo').value })) flash('تم حفظ الملف'); } catch (e) { $('rpErr').textContent = errMsg(e); }
  };
}
