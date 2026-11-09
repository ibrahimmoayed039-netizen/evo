// صفحة التوصيل: لوحة الحالات + السائقون + أجور السائقين + أسعار التوصيل
// (تعتمد على $ و esc و errMsg و can من renderer.js، و money و flash و resume من pos.js)
const DS_L = { preparing: 'قيد التجهيز', on_the_way: 'في الطريق', delivered: 'تم التسليم' };
const dvYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dvOff = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dvYmd(d); };
let DV = { tab: 'board', days: 1, from: dvOff(0), to: dvOff(0), edit: null };
const dvHm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

async function viewDelivery() {
  $('content').classList.add('wide');
  const mgr = can('delivery.manage');
  if (!mgr && DV.tab !== 'board') DV.tab = 'board';
  const TABS = [['board', 'لوحة التوصيل'], ...(mgr ? [['drivers', 'السائقون'], ['wages', 'أجور السائقين'], ['pricing', 'أسعار التوصيل']] : [])];
  $('content').innerHTML = `<h2>التوصيل</h2><div class="tabs">${TABS.map(([k, l]) => `<button class="${DV.tab === k ? 'on' : ''}" data-dvt="${k}">${l}</button>`).join('')}</div><div id="dvBody"></div>`;
  document.querySelectorAll('[data-dvt]').forEach((b) => (b.onclick = () => { DV.tab = b.dataset.dvt; DV.edit = null; viewDelivery(); }));
  try { await ({ board: dvBoard, drivers: dvDrivers, wages: dvWages, pricing: dvPricing }[DV.tab] || dvBoard)(); }
  catch (e) { $('dvBody').innerHTML = `<div class="card err">${esc(errMsg(e))}</div>`; }
}

// ---------- لوحة الحالات ----------
async function dvBoard() {
  const [rows, drivers] = await Promise.all([api.deliveryBoard({ days: DV.days }), api.deliveryDrivers()]);
  const act = drivers.filter((d) => d.active);
  const card = (r) => {
    const opts = (r.driverId && !act.some((d) => d.id === r.driverId) ? [{ id: r.driverId, name: r.driverName + ' (معطّل)' }] : []).concat(act);
    const owed = r.status === 'delivered' && !r.paid;
    return `<div class="dvc ${r.status}${owed ? ' owed' : ''}">
     <div class="dvh"><b>#${r.number}</b><span class="badge ${r.paid ? 'paid' : 'unpaid'}">${r.paid ? 'مدفوع' : 'غير مدفوع'}</span><small class="muted-l">${dvHm(r.createdAt)}</small></div>
     <div><b>${esc(r.customer.name || 'عميل')}</b> <span dir="ltr">${esc(r.customer.phone)}</span></div>
     ${r.customer.address || r.zone ? `<div class="muted-l">${esc(r.customer.address || '')}${r.zone ? ` — ${esc(r.zone)}` : ''}</div>` : ''}
     <div class="dvm"><span>${r.items} صنف</span><span>الإجمالي <b>${money(r.totalCents)}</b></span>${r.feeCents ? `<span>توصيل ${money(r.feeCents)}</span>` : ''}</div>
     ${r.note ? `<div class="muted-l">ملاحظة: ${esc(r.note)}</div>` : ''}
     ${r.status === 'delivered' ? `<div class="dvm"><span>السائق: <b>${esc(r.driverName || '—')}</b></span>${r.deliveredAt ? `<span>سُلّم ${dvHm(r.deliveredAt)}</span>` : ''}</div>`
       : `<select data-as="${r.id}"><option value="">— اختر سائقاً —</option>${opts.map((d) => `<option value="${esc(d.id)}" ${d.id === r.driverId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`}
     ${owed ? '<div class="err">⚠ مسلَّم وغير مدفوع — حصّل المبلغ</div>' : ''}
     <div class="ba">${r.status === 'preparing' ? `<button data-go="${r.id}" data-to="on_the_way">خرج للتوصيل ◀</button>` : ''}
      ${r.status === 'on_the_way' ? `<button data-go="${r.id}" data-to="delivered" style="background:#16a34a">تم التسليم ✓</button><button class="sec" data-go="${r.id}" data-to="preparing" title="رجوع">↩</button>` : ''}
      ${r.status === 'delivered' ? `<button class="sec" data-go="${r.id}" data-to="on_the_way" title="رجوع">↩</button>` : ''}
      ${!r.paid ? `<button class="sec" data-open="${r.id}">فتح في الكاشير</button>` : ''}</div></div>`;
  };
  const col = (st) => { const rs = rows.filter((r) => r.status === st); return `<div class="dvcol ${st}"><h3>${DS_L[st]} <span>${rs.length}</span></h3>${rs.map(card).join('') || '<div class="muted">لا توجد طلبات</div>'}</div>`; };
  $('dvBody').innerHTML = `<div class="drow" style="margin-bottom:10px"><select id="dvDays" style="max-width:170px"><option value="1" ${DV.days === 1 ? 'selected' : ''}>اليوم</option><option value="7" ${DV.days === 7 ? 'selected' : ''}>آخر 7 أيام</option></select>
    <button id="dvRef" class="sm sec">↻ تحديث</button><small class="muted-l">الطلبات غير المسلَّمة تظهر دائماً مهما كان تاريخها. أنشئ طلب التوصيل من «الكاشير» بنوع «توصيل».</small></div>
   <div class="dvcols">${['preparing', 'on_the_way', 'delivered'].map(col).join('')}</div><div id="dvErr" class="err"></div>`;
  const run = async (fn) => { try { await fn(); viewDelivery(); } catch (e) { $('dvErr').textContent = errMsg(e); } };
  $('dvDays').onchange = () => { DV.days = +$('dvDays').value; viewDelivery(); };
  $('dvRef').onclick = viewDelivery;
  document.querySelectorAll('[data-as]').forEach((s) => (s.onchange = () => run(() => api.deliveryAssign(+s.dataset.as, s.value || null))));
  document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => run(() => api.deliveryStatus(+b.dataset.go, b.dataset.to))));
  document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = async () => { try { resume(await api.orderGet(+b.dataset.open)); } catch (e) { $('dvErr').textContent = errMsg(e); } }));
}

// ---------- السائقون ----------
async function dvDrivers() {
  const list = await api.deliveryDrivers(), e = list.find((d) => d.id === DV.edit) || null;
  const wtxt = (d) => (d.wageMode === 'percent' ? `${d.wagePct}% من أجرة التوصيل` : `${money(d.wageCents)} لكل توصيلة`);
  $('dvBody').innerHTML = `<div class="card"><b>${e ? 'تعديل سائق' : 'إضافة سائق'}</b>
    <div class="dvf"><div><label>الاسم *</label><input id="drName" value="${esc(e?.name || '')}"></div><div><label>الجوال</label><input id="drPhone" dir="ltr" value="${esc(e?.phone || '')}"></div>
     <div><label>طريقة الأجر</label><select id="drMode"><option value="fixed" ${e?.wageMode !== 'percent' ? 'selected' : ''}>مبلغ ثابت لكل توصيلة</option><option value="percent" ${e?.wageMode === 'percent' ? 'selected' : ''}>نسبة من أجرة التوصيل</option></select></div>
     <div><label id="drWl">${e?.wageMode === 'percent' ? 'النسبة %' : 'المبلغ'}</label><input id="drWage" type="number" min="0" step="0.01" value="${e ? (e.wageMode === 'percent' ? e.wagePct : e.wageCents / 100) : ''}"></div></div>
    <div id="drErr" class="err"></div><button id="drSave">${e ? 'حفظ' : 'إضافة'}</button>${e ? '<button class="sec" id="drCancel">إلغاء التعديل</button>' : ''}</div>
   <table><tr><th>الاسم</th><th>الجوال</th><th>الأجر</th><th>الحالة</th><th></th></tr>
   ${list.map((d) => `<tr><td>${esc(d.name)}</td><td dir="ltr">${esc(d.phone)}</td><td>${wtxt(d)}</td><td>${d.active ? 'مفعّل' : 'معطّل'}</td>
    <td><button class="sm" data-de="${esc(d.id)}">تعديل</button> <button class="sm ${d.active ? 'sec' : ''}" data-dt="${esc(d.id)}">${d.active ? 'تعطيل' : 'تفعيل'}</button> <button class="sm danger" data-dd="${esc(d.id)}">حذف</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">لا يوجد سائقون بعد</td></tr>'}</table>
   <p class="muted-l">أجر السائق يُثبَّت لحظة «تم التسليم»، فتعديله لا يغيّر أجور التوصيلات السابقة. الحذف غير ممكن لسائق له طلبات (عطّله بدلاً من ذلك).</p><div id="dvErr" class="err"></div>`;
  $('drMode').onchange = () => { $('drWl').textContent = $('drMode').value === 'percent' ? 'النسبة %' : 'المبلغ'; };
  const run = async (fn, el = 'dvErr') => { try { await fn(); viewDelivery(); } catch (x) { $(el).textContent = errMsg(x); } };
  $('drSave').onclick = () => run(async () => { const d = { id: DV.edit || undefined, name: $('drName').value, phone: $('drPhone').value, wageMode: $('drMode').value, wage: $('drWage').value === '' ? 0 : $('drWage').value }; if (e) d.active = e.active; await api.deliverySaveDriver(d); DV.edit = null; }, 'drErr');
  if ($('drCancel')) $('drCancel').onclick = () => { DV.edit = null; viewDelivery(); };
  document.querySelectorAll('[data-de]').forEach((b) => (b.onclick = () => { DV.edit = b.dataset.de; viewDelivery(); }));
  document.querySelectorAll('[data-dt]').forEach((b) => (b.onclick = () => run(() => { const d = list.find((x) => x.id === b.dataset.dt); return api.deliverySaveDriver({ id: d.id, name: d.name, phone: d.phone, wageMode: d.wageMode, wage: d.wageMode === 'percent' ? d.wagePct : d.wageCents / 100, active: !d.active }); })));
  document.querySelectorAll('[data-dd]').forEach((b) => (b.onclick = () => { if (confirm('حذف السائق نهائياً؟')) run(() => api.deliveryRemoveDriver(b.dataset.dd)); }));
}

// ---------- أجور السائقين ----------
async function dvWages() {
  const Q = [['اليوم', 0, 0], ['أمس', -1, -1], ['آخر 7 أيام', -6, 0], ['آخر 30 يوماً', -29, 0]];
  let r, err = '';
  try { r = await api.deliveryReport({ from: DV.from, to: DV.to }); } catch (e) { err = errMsg(e); }
  const T = r?.totals;
  $('dvBody').innerHTML = `<div class="card"><div class="tabs">${Q.map(([l, a, b]) => `<button class="${DV.from === dvOff(a) && DV.to === dvOff(b) ? 'on' : ''}" data-dq="${a},${b}">${l}</button>`).join('')}</div>
    <div class="drow"><label>من</label><input type="date" id="dvFrom" value="${esc(DV.from)}"><label>إلى</label><input type="date" id="dvTo" value="${esc(DV.to)}"><button id="dvGo" class="sm">عرض</button></div><div class="err">${esc(err)}</div></div>
   ${r ? `<div class="stats"><div class="stat"><small>عدد التوصيلات</small><b>${T.deliveries}</b></div><div class="stat"><small>أجور التوصيل المحصّلة</small><b>${money(T.feeCents)}</b></div>
     <div class="stat"><small>أجور السائقين</small><b>${money(T.wageCents)}</b></div><div class="stat ${T.netFeeCents >= 0 ? 'good' : 'bad'}"><small>صافي أجرة التوصيل</small><b>${money(T.netFeeCents)}</b></div>
     <div class="stat ${T.unpaidCents ? 'bad' : ''}"><small>مسلَّم غير مدفوع</small><b>${money(T.unpaidCents)}</b></div></div>
    <table class="dvt"><tr><th>السائق</th><th>التوصيلات</th><th>أجرة التوصيل</th><th>أجر السائق</th><th>الصافي</th><th>غير مدفوع (بذمته)</th><th>متوسط المدة</th></tr>
    ${r.drivers.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.deliveries}</td><td>${money(d.feeCents)}</td><td>${money(d.wageCents)}</td><td>${money(d.netFeeCents)}</td><td>${d.unpaidCount ? `${money(d.unpaidCents)} (${d.unpaidCount})` : '—'}</td><td>${d.avgMinutes == null ? '—' : d.avgMinutes + ' د'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">لا توجد توصيلات مسلَّمة في هذه الفترة</td></tr>'}</table>
    <p class="muted-l">تُحسب التوصيلات حسب تاريخ التسليم، وتُستثنى الطلبات الملغاة. «غير مدفوع» = طلب سُلّم ولم يُدفع بعد في الكاشير (غالباً دفع عند الاستلام بيد السائق). مدة التوصيل من «خرج للتوصيل» إلى «تم التسليم».</p>` : ''}`;
  document.querySelectorAll('[data-dq]').forEach((b) => (b.onclick = () => { const [a, c] = b.dataset.dq.split(',').map(Number); DV.from = dvOff(a); DV.to = dvOff(c); viewDelivery(); }));
  $('dvGo').onclick = () => { DV.from = $('dvFrom').value; DV.to = $('dvTo').value; viewDelivery(); };
}

// ---------- أسعار التوصيل ----------
async function dvPricing() {
  const c = await api.deliveryConfig();
  $('dvBody').innerHTML = `<div class="card"><b>أجرة التوصيل</b>
    <div class="dvf"><div><label>الأجرة الافتراضية (لمن لم تُحدد منطقته)</label><input id="pcBase" type="number" min="0" step="0.01" value="${c.baseFeeCents / 100}"></div>
     <div><label>توصيل مجاني عند مجموع (بعد الخصم) ≥ (0 = معطّل)</label><input id="pcFree" type="number" min="0" step="0.01" value="${c.freeOverCents / 100}"></div></div>
    <label>المناطق — سطر لكل منطقة بصيغة: <span dir="ltr">الاسم | الأجرة</span></label>
    <textarea id="pcZones" rows="7" style="width:100%;font:inherit;padding:8px;border:1px solid #ccc;border-radius:6px">${esc(c.zones.map((z) => `${z.name} | ${z.feeCents / 100}`).join('\n'))}</textarea>
    <div id="pcErr" class="err"></div><button id="pcSave">حفظ</button></div>
   <p class="muted-l">الأجرة تُضاف بعد الخصم والضريبة (لا يُفرض عليها خصم ولا ضريبة). الأجرة الافتراضية 0 تعني بلا أجرة. تغيير الأسعار لا يمس الطلبات المحفوظة سابقاً إلا عند إعادة حفظها. يستطيع المالك/المدير تحديد أجرة مخصصة لطلب بعينه من الكاشير.</p>`;
  $('pcSave').onclick = async () => {
    try {
      const old = new Map(c.zones.map((z) => [z.name, z.id]));
      const zones = $('pcZones').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.lastIndexOf('|'); const name = (i < 0 ? l : l.slice(0, i)).trim(); return { id: old.get(name), name, fee: i < 0 ? '' : l.slice(i + 1).trim() }; });
      await api.deliverySaveConfig({ baseFee: $('pcBase').value === '' ? 0 : $('pcBase').value, freeOver: $('pcFree').value === '' ? 0 : $('pcFree').value, zones });
      flash('تم حفظ أسعار التوصيل'); viewDelivery();
    } catch (e) { $('pcErr').textContent = errMsg(e); }
  };
}
