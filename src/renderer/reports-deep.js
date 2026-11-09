// تبويبات التقارير الأعمق (تعتمد على esc و money من الصفحات الأخرى)
const CLS_L = { star: ['نجم', '#15803d'], horse: ['حصان عمل', '#b45309'], puzzle: ['لغز', '#2563eb'], dog: ['ضعيف', '#b91c1c'] };
const pc = (v) => (v == null ? '—' : v + '%');
const dcard = (t, v, c = '') => `<div class="stat ${c}"><small>${t}</small><b>${v}</b></div>`;
const hh = (h) => `${String(h % 24).padStart(2, '0')}:00`;

function deepItems(d) {
  const s = d.items.summary, rows = d.items.rows;
  return `<div class="stats">${dcard('إيراد الأصناف (بعد الخصم)', money(s.revenueCents))}${dcard('التكلفة (وصفات)', money(s.costCents))}${dcard('الربح', money(s.profitCents), s.profitCents >= 0 ? 'good' : 'bad')}
   ${dcard('الهامش', pc(s.marginPct))}${dcard('تغطية الوصفات', pc(s.coveragePct), s.coveragePct != null && s.coveragePct < 80 ? 'bad' : '')}</div>
   ${s.noRecipeCount ? `<p class="muted">${s.noRecipeCount} صنف بلا وصفة: لا يظهر له ربح ولا يدخل في الهامش. أضف وصفاته من «المخزون» لتكتمل الصورة.</p>` : ''}
   <div class="card"><table><tr><th>الصنف</th><th>الكمية</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th><th>الهامش</th><th>التصنيف</th></tr>
   ${rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${money(x.revenueCents)}</td><td>${x.hasRecipe ? money(x.costCents) : '<span class="muted">بلا وصفة</span>'}</td>
    <td style="color:${x.profitCents < 0 ? '#b91c1c' : 'inherit'}">${x.hasRecipe ? money(x.profitCents) : '—'}</td><td>${pc(x.marginPct)}</td>
    <td>${x.cls ? `<b style="color:${CLS_L[x.cls][1]}">${CLS_L[x.cls][0]}</b>` : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">—</td></tr>'}</table></div>
   <p class="muted">التصنيف (للأصناف ذات الوصفة): <b>نجم</b> مبيعاته وهامشه فوق المتوسط — حافظ عليه • <b>حصان عمل</b> يُباع كثيراً بهامش منخفض — ارفع سعره أو خفّض تكلفته • <b>لغز</b> هامشه عالٍ ويُباع قليلاً — روّج له • <b>ضعيف</b> فكّر في حذفه أو تعديله. المتوسطات: ${d.items.avgQty} قطعة و${d.items.avgMarginPct}% هامش.
   التكلفة تقدير بسعر المكوّن الحالي ولا تشمل الإضافات، والإيراد قبل الضريبة بعد توزيع الخصم بالتناسب.</p>`;
}

function deepStaff(d) {
  return `<div class="card"><table><tr><th>المستخدم</th><th>الدور</th><th>الطلبات</th><th>المبيعات</th><th>متوسط الفاتورة</th><th>خصومات</th><th>إلغاءات</th></tr>
   ${d.staff.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(({ owner: 'مالك', manager: 'مدير', cashier: 'كاشير', waiter: 'نادل', accountant: 'محاسب' })[s.role] || s.role || '—')}</td><td>${s.orders}</td><td>${money(s.totalCents)}</td><td>${money(s.avgCents)}</td>
    <td style="color:${s.discountPct > 15 ? '#b91c1c' : 'inherit'}">${s.discountOrders ? `${s.discountOrders} (${money(s.discountCents)} • ${pc(s.discountPct)})` : '—'}</td>
    <td style="color:${s.voidPct > 5 ? '#b91c1c' : 'inherit'}">${s.voidCount ? `${s.voidCount}${s.voidCents ? ` (${money(s.voidCents)} • ${pc(s.voidPct)})` : ''}` : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">—</td></tr>'}</table></div>
   <p class="muted">تُنسب الطلبات للمستخدم الذي أنشأها. الخصومات = نسبة المخصوم من مبيعات المستخدم قبل الخصم، والإلغاءات تشمل المدفوع بعد دفعه والملغي قبل الدفع (نسبة المرتجع من المبيعات). تُلوَّن القيم المرتفعة (خصم فوق 15% أو مرتجع فوق 5%) للمراجعة وليست اتهاماً.</p>`;
}

function deepPeaks(d, cap) {
  const P = d.peaks, need = (v) => Math.max(1, Math.ceil(v / cap));
  if (!P.hours.length) return '<div class="card muted">لا مبيعات في هذه الفترة.</div>';
  const lo = P.hours[0].hour, hi = P.hours[P.hours.length - 1].hour, cols = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const hmax = Math.max(0.1, ...P.heat.flat());
  return `<div class="card"><div class="drow"><label>طلبات يعالجها الموظف الواحد في الساعة</label><input type="number" id="rpCap" min="1" max="60" value="${cap}" style="width:90px"></div></div>
   ${P.lowConfidence ? '<p class="muted">الفترة أقل من 14 يوماً، فالمتوسطات تقريبية. اختر 30 يوماً أو أكثر لقرارات الورديات.</p>' : ''}
   <div class="cols"><div class="card"><b>فترات الذروة</b>${P.blocks.length ? `<table class="tt">${P.blocks.map((b) => `<tr><td>${hh(b.from)} – ${hh(b.to)}</td><td>${b.avgPerHour} طلب/ساعة</td><td><b>${need(b.avgPerHour)} موظف</b></td></tr>`).join('')}</table>` : '<div class="muted">—</div>'}
     <b>أيام الأسبوع (متوسط طلبات اليوم)</b>${bars(d.peaks.dow, (x) => x.label, (x) => x.avgOrdersPerDay, (v) => v)}</div>
    <div class="card"><b>الساعات (متوسط الطلبات في اليوم)</b><table class="tt">${P.hours.map((x) => `<tr><td style="width:60px">${hh(x.hour)}</td><td><div class="bar"><i style="width:${Math.max(2, Math.round((x.avgPerDay / P.maxPerHour) * 100))}%"></i></div></td><td style="width:50px">${x.avgPerDay}</td><td style="width:70px">${need(x.avgPerDay)} موظف</td></tr>`).join('')}</table></div></div>
   <div class="card" style="overflow-x:auto"><b>خريطة الازدحام (متوسط الطلبات: اليوم × الساعة)</b><table class="heat"><tr><th></th>${cols.map((h) => `<th>${String(h).padStart(2, '0')}</th>`).join('')}</tr>
   ${P.dow.map((w) => `<tr><th>${w.label}</th>${cols.map((h) => { const v = P.heat[w.dow][h]; return `<td style="background:rgba(37,99,235,${v ? 0.12 + 0.88 * (v / hmax) : 0});color:${v / hmax > 0.55 ? '#fff' : '#222'}">${v || ''}</td>`; }).join('')}</tr>`).join('')}</table></div>
   <p class="muted">الذروة = ساعات متصلة طلباتها ≥ 60% من أعلى ساعة. «موظفون مقترحون» = متوسط الطلبات ÷ طاقة الموظف (حدٌّ أدنى موظف واحد)، فاضبط الطاقة بحسب نوع مطعمك.</p>`;
}

function deepBody(d, tab, cap) {
  if (!d) return '';
  return tab === 'items' ? deepItems(d) : tab === 'staff' ? deepStaff(d) : tab === 'peaks' ? deepPeaks(d, cap) : '';
}
