// صفحة الوردية: فتح/إغلاق، إيداع/مصروف، تقرير X/Z، وسجل الورديات (تعتمد على $ و esc و errMsg و can من renderer.js، و money/dlgOpen/dlgClose/flash/loadPrintOpts من pos.js)
const MV_L = { in: 'إيداع', out: 'مصروف' };
const fmtT = (iso) => (iso ? new Date(iso).toLocaleString('ar-SA') : '-');
const PAY_L = { cash: 'نقدي', card: 'بطاقة', other: 'أخرى' };

function shiftBox(s) {
  const R = (a, b, cls = '') => `<tr class="${cls}"><td>${a}</td><td>${b}</td></tr>`;
  const diff = s.diffCents;
  return `<table class="tt">
   ${R('عدد الطلبات', s.sales.count)}${R('المجموع قبل الخصم', money(s.sales.subtotalCents))}${R('الخصومات', '-' + money(s.sales.discountCents))}${R('الضريبة', money(s.sales.vatCents))}
   ${R('إجمالي المبيعات', money(s.sales.totalCents), 'g')}${R(`المرتجعات (${s.refunds.count})`, '-' + money(s.refunds.totalCents))}${R('الصافي', money(s.netCents), 'g')}</table>
   <b>طرق الدفع (صافي)</b><table class="tt">${['cash', 'card', 'other'].map((k) => R(PAY_L[k], money(s.payments[k].netCents))).join('')}</table>
   <b>الصندوق (نقدي)</b><table class="tt">
   ${R('رصيد الافتتاح', money(s.openingCents))}${R('نقدي المبيعات', money(s.payments.cash.inCents))}${s.payments.cash.refundCents ? R('نقدي المرتجعات', '-' + money(s.payments.cash.refundCents)) : ''}
   ${s.moves.map((m) => R(`${MV_L[m.type]}: ${esc(m.reason)}`, (m.type === 'in' ? '+' : '-') + money(m.amountCents))).join('')}
   ${s.expectedCents == null ? '' : R('المتوقع في الدرج', money(s.expectedCents), 'g')}
   ${s.closedAt ? R('المعدود فعلياً', money(s.countedCents), 'g') + (s.expectedCents == null ? '' : R(diff === 0 ? 'الفرق' : diff > 0 ? 'زيادة' : 'عجز', `<span class="${diff < 0 ? 'err' : diff > 0 ? 'ok' : ''}">${money(Math.abs(diff))}</span>`)) : ''}</table>
   ${s.note ? `<p class="muted">ملاحظة: ${esc(s.note)}</p>` : ''}`;
}

async function showShiftPrint(id) {
  const o = loadPrintOpts(); o.silent = false;
  $('frame').style.width = (o.width === 58 ? 260 : 340) + 'px';
  try { $('frame').srcdoc = await api.shiftHtml(id, o); } catch (e) { return flash(errMsg(e)); }
  $('msg').textContent = ''; $('modal').classList.add('open');
  $('printBtn').onclick = async () => {
    try { $('msg').style.color = '#2563eb'; $('msg').textContent = 'جاري الطباعة...'; await api.shiftPrint(id, o); $('msg').style.color = '#16a34a'; $('msg').textContent = 'تمت الطباعة ✓'; }
    catch (e) { $('msg').style.color = '#b91c1c'; $('msg').textContent = 'فشلت الطباعة: ' + errMsg(e) + ' (اضبط الطابعة من صفحة «الطباعة»)'; }
  };
}

function shiftDialog(s, title) {
  const d = dlgOpen(`<h3>${title || (s.closedAt ? 'تقرير إغلاق الوردية' : 'تقرير الوردية')} #${s.id}</h3>
   <p class="muted">فتح: ${esc(fmtT(s.openedAt))} — ${esc(s.openedBy || '-')}${s.closedAt ? `<br>إغلاق: ${esc(fmtT(s.closedAt))} — ${esc(s.closedBy || '-')}` : ''}</p>
   ${shiftBox(s)}<div class="acts">${can('print') ? '<button id="shPrint" class="sec">طباعة</button>' : ''}<button id="shX">إغلاق</button></div>`);
  d.querySelector('#shX').onclick = dlgClose;
  if (d.querySelector('#shPrint')) d.querySelector('#shPrint').onclick = () => { dlgClose(); showShiftPrint(s.id); };
}

function cashMoveDialog(type) {
  const d = dlgOpen(`<h3>${MV_L[type]} نقدي</h3><label>المبلغ</label><input id="mvAmt" type="number" min="0" step="0.01" inputmode="decimal">
   <label>السبب</label><input id="mvWhy" maxlength="120" placeholder="${type === 'out' ? 'مثال: شراء ثلج' : 'مثال: تغذية الصندوق'}">
   <div id="mvErr" class="err"></div><div class="acts"><button id="mvOk">حفظ</button><button class="sec" id="mvNo">إلغاء</button></div>`);
  d.querySelector('#mvNo').onclick = dlgClose;
  d.querySelector('#mvOk').onclick = async () => {
    try { await api.shiftMove(type, d.querySelector('#mvAmt').value, d.querySelector('#mvWhy').value); dlgClose(); viewShift(); }
    catch (e) { d.querySelector('#mvErr').textContent = errMsg(e); }
  };
}

function closeShiftDialog(s) {
  const d = dlgOpen(`<h3>إغلاق الوردية #${s.id}</h3>
   ${s.openOrders ? `<p class="err">تنبيه: يوجد ${s.openOrders} طلب مفتوح غير مدفوع. سيبقى مفتوحاً وسيُنسب دفعه للوردية التالية.</p>` : ''}
   <p>عُدّ النقد الموجود فعلياً في الدرج وأدخله:</p>
   <label>النقد المعدود</label><input id="clAmt" type="number" min="0" step="0.01" inputmode="decimal" autofocus>
   <label>ملاحظة (اختياري)</label><input id="clNote" maxlength="200">
   <div id="clErr" class="err"></div><div class="acts"><button id="clOk" class="danger">إغلاق الوردية</button><button class="sec" id="clNo">إلغاء</button></div>`);
  d.querySelector('#clNo').onclick = dlgClose;
  d.querySelector('#clOk').onclick = async () => {
    try { const z = await api.shiftClose(d.querySelector('#clAmt').value, d.querySelector('#clNote').value); shiftDialog(z, 'تم إغلاق الوردية'); viewShift(); }
    catch (e) { d.querySelector('#clErr').textContent = errMsg(e); }
  };
}

async function viewShift() {
  $('content').classList.remove('wide');
  const { shift: s, requireShift } = await api.shiftCurrent();
  let history = [];
  if (can('reports')) { try { history = await api.shiftList(); } catch {} }
  $('content').innerHTML = `<h2>الوردية</h2>
   ${s ? `<div class="card"><p>وردية #${s.id} مفتوحة منذ ${esc(fmtT(s.openedAt))} — ${esc(s.openedBy || '-')}</p>${shiftBox(s)}
      <div class="acts"><button id="shIn" class="sec">+ إيداع</button><button id="shOut" class="sec">− مصروف</button>${can('print') ? '<button id="shPrintX" class="sec">طباعة X</button>' : ''}<button id="shClose" class="danger">إغلاق الوردية</button></div></div>`
     : `<div class="card"><p>لا توجد وردية مفتوحة.</p><label>رصيد الافتتاح (النقد في الدرج)</label><input id="shOpen" type="number" min="0" step="0.01" value="0" inputmode="decimal">
      <div id="shErr" class="err"></div><button id="shOpenBtn">فتح الوردية</button></div>`}
   ${can('settings') ? `<div class="card"><label class="chk"><input type="checkbox" id="shReq" ${requireShift ? 'checked' : ''}> اشتراط وردية مفتوحة قبل أي دفع</label></div>` : ''}
   ${history.length ? `<h3>الورديات السابقة</h3><table><tr><th>#</th><th>الفتح</th><th>الإغلاق</th><th>المتوقع</th><th>المعدود</th><th>الفرق</th><th></th></tr>
     ${history.map((h) => `<tr><td>${h.id}</td><td>${esc(fmtT(h.openedAt))}<br><small>${esc(h.openedBy || '')}</small></td><td>${h.closedAt ? esc(fmtT(h.closedAt)) : 'مفتوحة'}</td>
      <td>${h.closedAt ? money(h.expectedCents) : '-'}</td><td>${h.closedAt ? money(h.countedCents) : '-'}</td>
      <td>${h.closedAt ? `<span class="${h.diffCents < 0 ? 'err' : h.diffCents > 0 ? 'ok' : ''}">${h.diffCents > 0 ? '+' : ''}${money(h.diffCents)}</span>` : '-'}</td>
      <td><button class="sm sec" data-sh="${h.id}">عرض</button></td></tr>`).join('')}</table>` : ''}<div id="shErr2" class="err"></div>`;
  if ($('shOpenBtn')) $('shOpenBtn').onclick = async () => {
    try { await api.shiftOpen($('shOpen').value); viewShift(); } catch (e) { $('shErr').textContent = errMsg(e); }
  };
  if ($('shIn')) { $('shIn').onclick = () => cashMoveDialog('in'); $('shOut').onclick = () => cashMoveDialog('out'); $('shClose').onclick = () => closeShiftDialog(s); }
  if ($('shPrintX')) $('shPrintX').onclick = () => showShiftPrint(s.id);
  if ($('shReq')) $('shReq').onchange = async () => { try { await api.shiftRequire($('shReq').checked); flash('تم الحفظ'); } catch (e) { $('shErr2').textContent = errMsg(e); } };
  document.querySelectorAll('[data-sh]').forEach((b) => (b.onclick = async () => { try { shiftDialog(await api.shiftGet(+b.dataset.sh)); } catch (e) { $('shErr2').textContent = errMsg(e); } }));
}
