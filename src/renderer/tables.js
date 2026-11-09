// واجهة الطاولات: مخطط الصالة + نقل/دمج/تقسيم (تعتمد على $ و esc و errMsg و can و open من renderer.js، و dlgOpen/dlgClose/money/flash/resume/resetPos/P من pos.js)
let TA = { area: '', edit: false, timer: null };
const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 60 ? `${m} د` : `${Math.floor(m / 60)}س ${m % 60}د`; };
// أبعاد الأشكال (px) بحجم «متوسط» ومعامل الحجم
const T_DIM = { square: [100, 100, 'sq'], round: [112, 112, 'rd'], rect: [150, 92, 'rc'] }, T_SCALE = { s: 0.85, m: 1, l: 1.25 }, T_SHAPE_L = { square: 'مربعة', round: 'دائرية', rect: 'مستطيلة' }, T_SIZE_L = { s: 'صغيرة', m: 'متوسطة', l: 'كبيرة' };

// مواضع الكراسي حول الطاولة (إزاحة بالبكسل عن المركز): دائري على محيط الدائرة، وغيره على محيط المستطيل. الحد 12 كرسياً للوضوح
function tblChairs(shape, seats, w, h) {
  const n = Math.min(Math.max(1, seats | 0), 12), g = 10, out = [];
  if (shape === 'round') { const r = w / 2 + g; for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n - Math.PI / 2; out.push([Math.cos(a) * r, Math.sin(a) * r]); } return out; }
  const W = w + 2 * g, H = h + 2 * g, P = 2 * (W + H);
  for (let i = 0; i < n; i++) {
    let d = ((i + 0.5) / n) * P, x, y;
    if (d < W) { x = -W / 2 + d; y = -H / 2; } else if ((d -= W) < H) { x = W / 2; y = -H / 2 + d; } else if ((d -= H) < W) { x = W / 2 - d; y = H / 2; } else { d -= W; x = -W / 2; y = H / 2 - d; }
    out.push([x, y]);
  }
  return out;
}

function tblCard(t, manage) {
  const [bw, bh, cls] = T_DIM[t.shape] || T_DIM.rect, sc = T_SCALE[t.size] || 1, busy = t.status !== 'free', rv = t.reservation, n = t.orders.length;
  const chairs = tblChairs(t.shape, t.seats, bw * sc, bh * sc).map(([x, y]) => `<i class="ch" style="left:calc(50% + ${x.toFixed(1)}px);top:calc(50% + ${y.toFixed(1)}px)"></i>`).join('');
  return `<div class="tbl ${cls} ${t.status} ${rv ? 'rsv' : ''}" data-t="${esc(t.id)}" style="left:${t.x}%;top:${t.y}%;--s:${sc}">${chairs}<b>${esc(t.name)}</b>
    ${busy ? `<span>${money(t.totalCents)}</span><small class="tm" data-pre="⏱ " data-since="${esc(t.seatedAt)}">⏱ ${ago(t.seatedAt)}</small>${t.status === 'bill' ? `<small class="bl" title="تنتظر الحساب منذ" data-pre="🧾 " data-since="${esc(t.billAt)}">🧾 ${ago(t.billAt)}</small>` : ''}${n > 1 ? `<small>${n} طلبات</small>` : ''}` : `<small>${t.seats} مقاعد</small>`}
    ${rv ? `<small class="rv">🕒 ${esc(rv.time)} — ${esc(rv.name)}${rv.late ? ' (متأخر)' : ''}</small>` : ''}</div>`;
}

// تحديث عدّادات المدة كل 15 ثانية؛ يتوقف تلقائياً حين تغادر الصفحة
function tblTick() {
  if (!document.getElementById('floor')) { clearInterval(TA.timer); TA.timer = null; return; }
  document.querySelectorAll('[data-since]').forEach((e) => { e.textContent = (e.dataset.pre || '') + ago(e.dataset.since); });
}

async function viewTables() {
  $('content').classList.remove('wide');
  const fl = await api.tablesFloor();
  const areas = [...new Set(fl.map((t) => t.area))];
  if (!areas.includes(TA.area)) TA.area = areas[0] || '';
  const mine = fl.filter((t) => t.area === TA.area), manage = can('tables.manage');
  const cnt = (s) => fl.filter((t) => t.status === s).length, seats = (ts) => ts.reduce((a, t) => a + t.seats, 0);
  $('content').innerHTML = `<h2>الطاولات</h2>
   <div class="tabs">${areas.map((a) => `<button data-ar="${esc(a)}" class="${a === TA.area ? 'on' : ''}">${esc(a)}</button>`).join('')}
    ${manage ? `<button class="sec" id="taEdit">${TA.edit ? 'إنهاء التعديل' : 'تعديل المخطط'}</button>${TA.edit ? '<button id="taAdd">+ طاولة</button>' : ''}` : ''}</div>
   <div class="legend"><span class="dot free"></span> فاضية (${cnt('free')}) &nbsp; <span class="dot busy"></span> مشغولة (${cnt('busy')}) &nbsp; <span class="dot bill"></span> تنتظر الحساب (${cnt('bill')}) &nbsp; <span class="dot rsv"></span> عليها حجز قريب
    ${fl.length ? ` &nbsp;|&nbsp; مقاعد مشغولة: ${seats(fl.filter((t) => t.status !== 'free'))} / ${seats(fl)}` : ''}${TA.edit ? ' — اسحب الطاولة لتحريكها، أو اضغطها لتعديلها' : ''}</div>
   <div id="floor" class="floor ${TA.edit ? 'editing' : ''}">${mine.map((t) => tblCard(t, manage)).join('')}${fl.length ? '' : `<div class="muted">لا توجد طاولات بعد.${manage ? ' اضغط «تعديل المخطط» ثم «+ طاولة».' : ' اطلب من المدير إضافتها.'}</div>`}</div><div id="taErr" class="err"></div>`;
  clearInterval(TA.timer); TA.timer = setInterval(tblTick, 15000);

  document.querySelectorAll('[data-ar]').forEach((b) => (b.onclick = () => { TA.area = b.dataset.ar; viewTables(); }));
  if ($('taEdit')) $('taEdit').onclick = () => { TA.edit = !TA.edit; viewTables(); };
  if ($('taAdd')) $('taAdd').onclick = () => tableEditDialog(null, fl);
  document.querySelectorAll('.tbl').forEach((el) => {
    const t = mine.find((x) => x.id === el.dataset.t);
    if (!TA.edit) return (el.onclick = () => tableDialog(t, fl));
    el.addEventListener('pointerdown', (e) => {
      const box = $('floor').getBoundingClientRect(), sx = e.clientX, sy = e.clientY; let moved = false;
      const move = (ev) => {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true;
        if (!moved) return;
        el.dataset.x = Math.min(97, Math.max(3, ((ev.clientX - box.left) / box.width) * 100));
        el.dataset.y = Math.min(94, Math.max(6, ((ev.clientY - box.top) / box.height) * 100));
        el.style.left = el.dataset.x + '%'; el.style.top = el.dataset.y + '%';
      };
      const up = async () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (!moved) return tableEditDialog(t, fl);
        try { await api.tableSave({ ...t, x: +el.dataset.x, y: +el.dataset.y }); } catch (err) { $('taErr').textContent = errMsg(err); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); e.preventDefault();
    });
  });
}

function tableEditDialog(t, fl) {
  const areas = [...new Set(fl.map((x) => x.area))];
  const d = dlgOpen(`<h3>${t ? 'تعديل الطاولة' : 'طاولة جديدة'}</h3>
   <label>الاسم / الرقم</label><input id="teName" maxlength="20" value="${esc(t?.name || '')}">
   <label>المنطقة</label><input id="teArea" list="teAreas" maxlength="30" value="${esc(t?.area || TA.area || 'الصالة')}"><datalist id="teAreas">${areas.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
   <label>عدد المقاعد</label><input id="teSeats" type="number" min="1" max="50" value="${t?.seats || 4}">
   <label>الشكل</label><select id="teShape">${Object.entries(T_SHAPE_L).map(([k, l]) => `<option value="${k}" ${(t?.shape || 'square') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
   <label>الحجم</label><select id="teSize">${Object.entries(T_SIZE_L).map(([k, l]) => `<option value="${k}" ${(t?.size || 'm') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
   <div id="teErr" class="err"></div><button id="teOk">حفظ</button>${t ? '<button class="danger" id="teDel">حذف</button>' : ''}<button class="sec" id="teNo">إلغاء</button>`);
  d.querySelector('#teNo').onclick = dlgClose;
  d.querySelector('#teOk').onclick = async () => {
    try {
      await api.tableSave({ ...(t || {}), name: d.querySelector('#teName').value, area: d.querySelector('#teArea').value, seats: +d.querySelector('#teSeats').value, shape: d.querySelector('#teShape').value, size: d.querySelector('#teSize').value });
      TA.area = d.querySelector('#teArea').value.trim() || TA.area; dlgClose(); viewTables();
    } catch (e) { d.querySelector('#teErr').textContent = errMsg(e); }
  };
  if (t) d.querySelector('#teDel').onclick = async () => {
    if (!confirm(`حذف الطاولة «${t.name}»؟`)) return;
    try { await api.tableDelete(t.id); dlgClose(); viewTables(); } catch (e) { d.querySelector('#teErr').textContent = errMsg(e); }
  };
}

const allOrders = (fl) => fl.flatMap((t) => t.orders.map((o) => ({ ...o, table: t.name, tableId: t.id })));

function tableDialog(t, fl) {
  const many = allOrders(fl).length > 1;
  const d = dlgOpen(`<h3>${esc(t.name)} <small>(${t.seats} مقاعد)</small></h3>
   ${t.status !== 'free' ? `<p class="muted">جلوس منذ <b>${ago(t.seatedAt)}</b>${t.status === 'bill' ? ` — تنتظر الحساب منذ <b>${ago(t.billAt)}</b>` : ''}</p>` : ''}
   ${t.orders.map((o) => `<div class="orow"><b>#${o.number}</b> ${money(o.totalCents)} <small>${ago(o.createdAt)}</small>${o.billAt ? ' <span class="badge unpaid">🧾 طلب الحساب</span>' : ''}
     <button class="sm" data-res="${o.id}">متابعة</button><button class="sm ${o.billAt ? 'sec' : ''}" data-bl="${o.id}" data-on="${o.billAt ? 0 : 1}">${o.billAt ? 'إلغاء طلب الحساب' : 'طلب الحساب'}</button><button class="sm sec" data-sp="${o.id}">تقسيم</button><button class="sm sec" data-mv="${o.id}">نقل</button>${many ? `<button class="sm sec" data-mg="${o.id}">دمج</button>` : ''}</div>`).join('') || '<div class="muted">الطاولة فاضية</div>'}
   <p><button id="taNew">${t.orders.length ? 'طلب جديد على الطاولة' : 'بدء طلب'}</button><button class="sec" id="taClose">إغلاق</button></p>`);
  const refresh = () => viewTables();
  d.querySelector('#taClose').onclick = dlgClose;
  d.querySelector('#taNew').onclick = () => { dlgClose(); resetPos(); P.type = 'dine_in'; P.tableId = t.id; open('pos'); };
  d.querySelectorAll('[data-res]').forEach((b) => (b.onclick = async () => { try { const o = await api.orderGet(+b.dataset.res); dlgClose(); resume(o); } catch (e) { flash(errMsg(e)); } }));
  d.querySelectorAll('[data-bl]').forEach((b) => (b.onclick = async () => { try { await api.orderBill(+b.dataset.bl, b.dataset.on === '1'); dlgClose(); refresh(); } catch (e) { flash(errMsg(e)); } }));
  d.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => splitDialog(+b.dataset.sp, refresh)));
  d.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => moveDialog(+b.dataset.mv, t.id, fl, refresh)));
  d.querySelectorAll('[data-mg]').forEach((b) => (b.onclick = () => mergeDialog(+b.dataset.mg, fl, refresh)));
}

async function splitDialog(id, after) {
  let o;
  try { o = await api.orderGet(id); } catch (e) { return flash(errMsg(e)); }
  const pick = o.lines.map(() => 0);
  const d = dlgOpen('');
  const draw = () => {
    const n = pick.reduce((s, q) => s + q, 0), all = o.lines.every((l, i) => pick[i] === l.qty);
    d.innerHTML = `<h3>تقسيم طلب #${o.number}</h3><p class="muted">حدّد ما ينتقل إلى فاتورة جديدة</p>
     ${o.lines.map((l, i) => `<div class="sp-row"><span class="n">${esc(l.name)}${l.mods.length ? ` <small>+ ${esc(l.mods.map((m) => m.name).join('، '))}</small>` : ''} <small>× ${l.qty}</small></span>
       <button class="sm sec" data-sm="${i}">−</button><b>${pick[i]}</b><button class="sm sec" data-sa="${i}">+</button></div>`).join('')}
     <div id="spErr" class="err">${all ? 'اترك صنفاً واحداً على الأقل في الطلب الأصلي' : ''}</div>
     <button id="spOk" ${!n || all ? 'disabled' : ''}>إنشاء فاتورة جديدة</button><button class="sec" id="spNo">إلغاء</button>`;
    d.querySelectorAll('[data-sm]').forEach((b) => (b.onclick = () => { pick[+b.dataset.sm] = Math.max(0, pick[+b.dataset.sm] - 1); draw(); }));
    d.querySelectorAll('[data-sa]').forEach((b) => (b.onclick = () => { const i = +b.dataset.sa; pick[i] = Math.min(o.lines[i].qty, pick[i] + 1); draw(); }));
    d.querySelector('#spNo').onclick = dlgClose;
    d.querySelector('#spOk').onclick = async () => {
      try {
        const r = await api.orderSplit(id, pick.map((q, i) => ({ i, qty: q })).filter((p) => p.qty > 0));
        dlgClose(); flash(`تم إنشاء الطلب #${r.created.number}`); after();
      } catch (e) { d.querySelector('#spErr').textContent = errMsg(e); }
    };
  };
  draw();
}

function moveDialog(orderId, fromTableId, fl, after) {
  const opts = fl.filter((t) => t.id !== fromTableId);
  if (!opts.length) return flash('لا توجد طاولة أخرى');
  const d = dlgOpen(`<h3>نقل الطلب</h3><label>إلى الطاولة</label><select id="mvTo">${opts.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} — ${esc(t.area)}${t.orders.length ? ' (مشغولة)' : ''}</option>`).join('')}</select>
   <div id="mvErr" class="err"></div><button id="mvOk">نقل</button><button class="sec" id="mvNo">إلغاء</button>`);
  d.querySelector('#mvNo').onclick = dlgClose;
  d.querySelector('#mvOk').onclick = async () => {
    try { await api.orderMove(orderId, d.querySelector('#mvTo').value); dlgClose(); flash('تم النقل'); after(); } catch (e) { d.querySelector('#mvErr').textContent = errMsg(e); }
  };
}

function mergeDialog(sourceId, fl, after) {
  const opts = allOrders(fl).filter((o) => o.id !== sourceId);
  if (!opts.length) return flash('لا يوجد طلب آخر للدمج');
  const d = dlgOpen(`<h3>دمج الطلب</h3><p class="muted">تُنقل أصناف هذا الطلب إلى الطلب المختار ويُغلق هذا الطلب</p>
   <label>دمج في</label><select id="mgTo">${opts.map((o) => `<option value="${o.id}">#${o.number} — ${esc(o.table)} — ${money(o.totalCents)}</option>`).join('')}</select>
   <div id="mgErr" class="err"></div><button id="mgOk">دمج</button><button class="sec" id="mgNo">إلغاء</button>`);
  d.querySelector('#mgNo').onclick = dlgClose;
  d.querySelector('#mgOk').onclick = async () => {
    try { await api.orderMerge(sourceId, +d.querySelector('#mgTo').value); dlgClose(); flash('تم الدمج'); after(); } catch (e) { d.querySelector('#mgErr').textContent = errMsg(e); }
  };
}
