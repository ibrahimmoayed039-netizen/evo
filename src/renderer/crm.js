// صفحة العملاء: عملاء + كروت هدايا + إعدادات الولاء (تعتمد على $ و esc و errMsg و can من renderer.js، و money/dlgOpen/dlgClose/flash من pos.js)
let CRM = { tab: 'cust', q: '' };
const REASON_PTS = { earn: 'اكتساب', redeem: 'استرداد', void_earn: 'عكس اكتساب (إلغاء)', void_redeem: 'إرجاع نقاط (إلغاء)', adjust: 'تعديل يدوي' };
const GIFT_MOVE = { issue: 'إصدار', redeem: 'استخدام', refund: 'استرجاع (إلغاء طلب)', void: 'إلغاء الكرت' };
const dt = (x) => (x ? new Date(x).toLocaleString('ar-SA') : '—');
const crmFail = (e) => { const x = $('crmErr'); if (x) x.textContent = errMsg(e); };
const giftState = (c) => (c.status === 'void' ? 'ملغي' : c.expired ? 'منتهي' : 'نشط');

async function viewCustomers() {
  $('content').classList.add('wide');
  const T = [['cust', 'العملاء'], ['gift', 'كروت الهدايا']];
  if (can('settings')) T.push(['loy', 'برنامج الولاء']);
  if (!T.some(([k]) => k === CRM.tab)) CRM.tab = 'cust';
  $('content').innerHTML = `<h2>العملاء</h2><div class="tabs">${T.map(([k, l]) => `<button data-ct="${k}" class="${CRM.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
   <div id="crmBody"></div><div id="crmErr" class="err"></div>`;
  document.querySelectorAll('[data-ct]').forEach((b) => (b.onclick = () => { CRM.tab = b.dataset.ct; viewCustomers(); }));
  try { await ({ cust: tabCust, gift: tabGift, loy: tabLoy }[CRM.tab])(); } catch (e) { crmFail(e); }
}

// ---------- العملاء ----------
async function tabCust() {
  const [rows, L] = await Promise.all([api.custList(CRM.q), api.loyaltyGet()]);
  $('crmBody').innerHTML = `<div class="drow"><input id="cQ" placeholder="بحث بالاسم أو الجوال" value="${esc(CRM.q)}"><button id="cGo" class="sm">بحث</button><button id="cNew" class="sm">+ عميل جديد</button></div>
   ${L.enabled ? '' : '<div class="muted">برنامج الولاء غير مفعّل — لا تُكتسب نقاط حالياً.</div>'}
   <table><tr><th>الاسم</th><th>الجوال</th><th>النقاط</th><th>الزيارات</th><th>الإنفاق</th><th>آخر زيارة</th><th></th></tr>
   ${rows.map((c) => `<tr class="${c.active ? '' : 'so'}"><td>${esc(c.name)}${c.active ? '' : ' (معطّل)'}</td><td dir="ltr">${esc(c.phone)}</td><td>${c.points}</td><td>${c.visits}</td><td>${money(c.spentCents)}</td><td>${c.lastVisit ? dt(c.lastVisit) : '—'}</td>
    <td><button class="sm sec" data-cd="${esc(c.id)}">تفاصيل</button></td></tr>`).join('')}</table>
   ${rows.length ? '' : '<div class="card">لا يوجد عملاء.</div>'}`;
  const go = () => { CRM.q = $('cQ').value; viewCustomers(); };
  $('cGo').onclick = go; $('cQ').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('cNew').onclick = () => custForm(null);
  document.querySelectorAll('[data-cd]').forEach((b) => (b.onclick = () => custDetails(b.dataset.cd)));
}

function custForm(c, after = viewCustomers) {
  const d = dlgOpen(`<h3>${c?.id ? 'تعديل عميل' : 'عميل جديد'}</h3><label>الاسم</label><input id="cfN" value="${esc(c?.name)}"><label>الجوال</label><input id="cfP" dir="ltr" inputmode="tel" value="${esc(c?.phone)}">
   <label>ملاحظة</label><input id="cfNote" value="${esc(c?.note)}"><div id="cfE" class="err"></div><button id="cfOk">حفظ</button><button class="sec" id="cfNo">إلغاء</button>`);
  d.querySelector('#cfNo').onclick = dlgClose;
  d.querySelector('#cfOk').onclick = async () => {
    try { const r = await api.custSave({ id: c?.id, name: d.querySelector('#cfN').value, phone: d.querySelector('#cfP').value, note: d.querySelector('#cfNote').value }); dlgClose(); flash('تم حفظ العميل'); await after(r); }
    catch (e) { d.querySelector('#cfE').textContent = errMsg(e); }
  };
}

async function custDetails(id) {
  const c = await api.custGet(id);
  const d = dlgOpen(`<h3>${esc(c.name)}</h3><div dir="ltr" style="text-align:right">${esc(c.phone)}</div>${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}
   <div class="stats"><div class="stat"><small>النقاط</small><b class="${c.points < 0 ? 'bad' : ''}">${c.points}</b></div><div class="stat"><small>الزيارات</small><b>${c.visits}</b></div><div class="stat"><small>الإنفاق</small><b>${money(c.spentCents)}</b></div></div>
   <b>آخر الطلبات</b><table class="tt">${c.orders.map((o) => `<tr><td>#${o.number}${o.status === 'void' ? ' (ملغي)' : ''}</td><td>${dt(o.paidAt)}</td><td>${money(o.totalCents)}</td></tr>`).join('') || '<tr><td>لا توجد طلبات</td></tr>'}</table>
   <b>حركات النقاط</b><table class="tt">${c.moves.map((m) => `<tr><td>${REASON_PTS[m.reason]}${m.note ? ' — ' + esc(m.note) : ''}</td><td>${dt(m.createdAt)}</td><td dir="ltr">${m.points > 0 ? '+' : ''}${m.points}</td></tr>`).join('') || '<tr><td>لا توجد حركات</td></tr>'}</table>
   <div id="cdE" class="err"></div>
   <button id="cdEdit" class="sm">تعديل</button>${can('crm.manage') ? `<button id="cdPts" class="sm sec">تعديل النقاط</button><button id="cdAct" class="sm ${c.active ? 'danger' : ''}">${c.active ? 'تعطيل' : 'تفعيل'}</button>${c.active ? '<button id="cdMerge" class="sm sec">دمج في عميل آخر</button>' : ''}` : ''}<button class="sm sec" id="cdNo">إغلاق</button>`);
  d.querySelector('#cdNo').onclick = dlgClose;
  d.querySelector('#cdEdit').onclick = () => custForm(c);
  const act = d.querySelector('#cdAct');
  if (act) act.onclick = async () => { try { await api.custActive(id, !c.active); dlgClose(); viewCustomers(); } catch (e) { d.querySelector('#cdE').textContent = errMsg(e); } };
  const mb = d.querySelector('#cdMerge');
  if (mb) mb.onclick = () => {
    const m = dlgOpen(`<h3>دمج ${esc(c.name)} في عميل آخر</h3><p class="muted">تُنقل كل طلباته ونقاطه وحجوزاته إلى العميل الهدف، ويُعطَّل هذا السجل. لا يمكن التراجع.</p>
     <label>جوال العميل الهدف (الذي سيبقى)</label><input id="mgP" dir="ltr" inputmode="tel"><div id="mgT" class="muted"></div>
     <div id="mgE" class="err"></div><button class="danger" id="mgOk">دمج</button><button class="sec" id="mgNo">رجوع</button>`);
    m.querySelector('#mgNo').onclick = () => custDetails(id);
    m.querySelector('#mgOk').onclick = async () => {
      try {
        const t = await api.custFind(m.querySelector('#mgP').value);
        if (!t) throw new Error('لا يوجد عميل نشط بهذا الجوال');
        if (!confirm(`دمج «${c.name}» في «${t.name}»؟`)) return;
        await api.custMerge(id, t.id); dlgClose(); flash('تم دمج العميلين'); viewCustomers();
      } catch (e) { m.querySelector('#mgE').textContent = errMsg(e); }
    };
  };
  const pb = d.querySelector('#cdPts');
  if (pb) pb.onclick = () => {
    const p = dlgOpen(`<h3>تعديل نقاط ${esc(c.name)}</h3><label>عدد النقاط (سالب للخصم)</label><input id="ptN" type="number" step="1" value="0"><label>السبب</label><input id="ptR">
     <div id="ptE" class="err"></div><button id="ptOk">حفظ</button><button class="sec" id="ptNo">رجوع</button>`);
    p.querySelector('#ptNo').onclick = () => custDetails(id);
    p.querySelector('#ptOk').onclick = async () => {
      try { await api.custPoints(id, +p.querySelector('#ptN').value, p.querySelector('#ptR').value); dlgClose(); flash('تم تعديل النقاط'); viewCustomers(); }
      catch (e) { p.querySelector('#ptE').textContent = errMsg(e); }
    };
  };
}

// ---------- كروت الهدايا ----------
async function tabGift() {
  const rows = await api.giftList();
  let liab = null; if (can('crm.manage')) { try { liab = await api.giftLiab(); } catch {} }
  $('crmBody').innerHTML = `${liab ? `<div class="card"><b>التزامات الكروت (أرصدة غير مستخدمة)</b><div class="stats"><div class="stat"><small>نشطة (${liab.activeCount})</small><b>${money(liab.activeCents)}</b></div><div class="stat"><small>منتهية برصيد (${liab.expiredCount})</small><b>${money(liab.expiredCents)}</b></div><div class="stat"><small>المُصدر</small><b>${money(liab.issuedCents)}</b></div><div class="stat"><small>المستخدم (صافي)</small><b>${money(liab.usedCents)}</b></div></div></div>` : ''}<div class="card"><b>إصدار كرت هدية</b>
   <div class="drow"><label>المبلغ</label><input id="gA" type="number" min="1" step="0.01" inputmode="decimal"><label>الدفع</label><select id="gM"><option value="cash">نقدي</option><option value="card">بطاقة</option></select></div>
   <div class="drow"><label>ملاحظة</label><input id="gN" placeholder="اسم المشتري (اختياري)"><label>صلاحية (يوم)</label><input id="gE" type="number" min="1" placeholder="بلا حد"></div>
   <button id="gIssue">إصدار</button></div>
   <div class="drow"><input id="gQ" placeholder="رمز الكرت للتحقق من الرصيد" dir="ltr"><button id="gChk" class="sm">تحقق</button></div>
   <table><tr><th>الرمز</th><th>الرصيد</th><th>الأصلي</th><th>الحالة</th><th>الإصدار</th><th></th></tr>
   ${rows.map((c) => `<tr class="${c.status === 'void' || c.expired ? 'so' : ''}"><td dir="ltr">${esc(c.code)}</td><td>${money(c.balanceCents)}</td><td>${money(c.initialCents)}</td><td>${giftState(c)}</td><td>${dt(c.issuedAt)}</td>
    <td><button class="sm sec" data-gd="${esc(c.code)}">تفاصيل</button></td></tr>`).join('')}</table>${rows.length ? '' : '<div class="card">لا توجد كروت.</div>'}`;
  $('gIssue').onclick = async () => {
    try {
      const c = await api.giftIssue({ amount: $('gA').value, method: $('gM').value, buyerNote: $('gN').value, expiryDays: $('gE').value });
      const d = dlgOpen(`<h3>تم إصدار الكرت</h3><div class="big" dir="ltr">${esc(c.code)}</div><div class="big">${money(c.balanceCents)} ر.س</div><div class="muted">سلّم الرمز للعميل — لا يمكن استعادته لاحقاً إلا من هذه الصفحة.</div>${can('print') ? '<button id="gPr" class="sec">طباعة القسيمة</button>' : ''}<button id="gOk">تم</button>`);
      d.querySelector('#gOk').onclick = () => { dlgClose(); viewCustomers(); };
      if (d.querySelector('#gPr')) d.querySelector('#gPr').onclick = () => { dlgClose(); showVoucher(c.code, viewCustomers); };
    } catch (e) { crmFail(e); }
  };
  $('gChk').onclick = () => giftDetails($('gQ').value);
  document.querySelectorAll('[data-gd]').forEach((b) => (b.onclick = () => giftDetails(b.dataset.gd)));
}

async function giftDetails(code) {
  let c; try { c = await api.giftGet(code); } catch (e) { return crmFail(e); }
  const d = dlgOpen(`<h3 dir="ltr" style="text-align:right">${esc(c.code)}</h3>
   <div class="stats"><div class="stat"><small>الرصيد</small><b>${money(c.balanceCents)}</b></div><div class="stat"><small>الأصلي</small><b>${money(c.initialCents)}</b></div><div class="stat"><small>الحالة</small><b>${giftState(c)}</b></div></div>
   ${c.expiresAt ? `<div class="muted">ينتهي: ${dt(c.expiresAt)}</div>` : ''}${c.buyerNote ? `<div class="muted">${esc(c.buyerNote)}</div>` : ''}
   <table class="tt">${c.moves.map((m) => `<tr><td>${GIFT_MOVE[m.type]}${m.orderId ? ' (طلب ' + m.orderId + ')' : ''}</td><td>${dt(m.createdAt)}</td><td>${money(m.amountCents)}</td></tr>`).join('')}</table>
   <div id="gdE" class="err"></div>${can('crm.manage') && c.status === 'active' ? '<button class="sm danger" id="gdVoid">إلغاء الكرت</button>' : ''}${can('print') && c.status === 'active' ? '<button class="sm sec" id="gdPr">طباعة القسيمة</button>' : ''}<button class="sm sec" id="gdNo">إغلاق</button>`);
  d.querySelector('#gdNo').onclick = dlgClose;
  if (d.querySelector('#gdPr')) d.querySelector('#gdPr').onclick = () => { dlgClose(); showVoucher(code, null); };
  const v = d.querySelector('#gdVoid');
  if (v) v.onclick = () => {
    const r = dlgOpen(`<h3>إلغاء الكرت</h3><p>سيُصفَّر الرصيد (${money(c.balanceCents)}) ولا يمكن التراجع. أي ردّ للمبلغ للعميل يتم يدوياً.</p><label>السبب</label><input id="gvR">
     <div id="gvE" class="err"></div><button class="danger" id="gvOk">تأكيد الإلغاء</button><button class="sec" id="gvNo">رجوع</button>`);
    r.querySelector('#gvNo').onclick = () => giftDetails(code);
    r.querySelector('#gvOk').onclick = async () => { try { await api.giftVoid(code, r.querySelector('#gvR').value); dlgClose(); flash('أُلغي الكرت'); viewCustomers(); } catch (e) { r.querySelector('#gvE').textContent = errMsg(e); } };
  };
}

// معاينة وطباعة قسيمة الكرت (نفس نافذة معاينة الإيصال)
async function showVoucher(code, after) {
  const o = loadPrintOpts(); o.silent = false;
  $('frame').style.width = (o.width === 58 ? 260 : 340) + 'px';
  try { $('frame').srcdoc = await api.giftHtml(code, o); } catch (e) { return flash(errMsg(e)); }
  $('msg').textContent = ''; $('modal').classList.add('open');
  $('printBtn').onclick = async () => {
    try { $('msg').style.color = '#2563eb'; $('msg').textContent = 'جاري الطباعة...'; await api.giftPrint(code, o); $('msg').style.color = '#16a34a'; $('msg').textContent = 'تمت الطباعة ✓'; }
    catch (e) { $('msg').style.color = '#b91c1c'; $('msg').textContent = 'فشلت الطباعة: ' + errMsg(e) + ' (اضبط الطابعة من صفحة «الطباعة»)'; }
  };
}

// ---------- إعدادات الولاء ----------
async function tabLoy() {
  const L = await api.loyaltyGet();
  $('crmBody').innerHTML = `<div class="card"><label class="chk"><input type="checkbox" id="lyOn" ${L.enabled ? 'checked' : ''}> تفعيل برنامج الولاء</label>
   <label>نقاط لكل 1 ريال (قبل الضريبة وبعد الخصم)</label><input id="lyE" type="number" min="0" max="100" step="0.1" value="${L.earnPerRiyal}">
   <label>قيمة النقطة بالهللة</label><input id="lyV" type="number" min="1" max="1000" step="1" value="${L.pointValueCents}">
   <div class="muted" id="lyHint"></div><button id="lySave">حفظ</button></div>`;
  const hint = () => { $('lyHint').textContent = `100 نقطة = ${money(100 * (+$('lyV').value || 0))} ر.س`; };
  $('lyV').oninput = hint; hint();
  $('lySave').onclick = async () => {
    try { await api.loyaltySet({ enabled: $('lyOn').checked, earnPerRiyal: +$('lyE').value, pointValueCents: +$('lyV').value }); flash('تم حفظ إعدادات الولاء'); $('crmErr').textContent = ''; }
    catch (e) { crmFail(e); }
  };
}
