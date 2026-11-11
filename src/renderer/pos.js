// واجهة الكاشير + قائمة الطلبات (تعتمد على $ و esc و errMsg و me و can و open من renderer.js)
const money = (c) => (c / 100).toFixed(2);
const TYPE_L = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };
const STATUS_L = { open: 'مفتوح', paid: 'مدفوع', void: 'ملغي' };
const METHOD_L = { cash: 'نقدي', card: 'بطاقة', other: 'أخرى' };
let P = null, PM = null, qSeq = 0, LOY = { enabled: false };

const freshPos = () => ({ cat: '', cart: [], type: 'dine_in', table: '', tableId: '', floor: [], cust: { name: '', phone: '', address: '' }, note: '', disc: { type: 'percent', value: '' }, orderId: null, number: null, quote: null, crm: null, zoneId: '', feeOv: undefined });
function resetPos() { const f = P?.floor, k = P?.kitchen, dc = P?.dcfg; P = freshPos(); if (f) P.floor = f; P.kitchen = !!k; if (dc) P.dcfg = dc; }
// بعد حفظ/إرسال/دفع: نبدأ طلباً جديداً ونحدّث حالة الطاولات
async function afterOrder() { resetPos(); try { P.floor = await api.tablesFloor(); } catch {} drawPos(); }

// إعدادات الطباعة تُحفظ على هذا الجهاز فقط
const loadPrintOpts = () => { try { return { width: 80, mode: 'system', deviceName: '', host: '', ...JSON.parse(localStorage.getItem('printOpts') || '{}') }; } catch { return { width: 80, mode: 'system', deviceName: '', host: '' }; } };
const savePrintOpts = (o) => { try { localStorage.setItem('printOpts', JSON.stringify({ width: o.width, mode: o.mode, deviceName: o.deviceName, host: o.host })); } catch {} };

// ---------- نافذة منبثقة عامة ----------
function dlgOpen(html) { const d = $('posDlg'); d.innerHTML = html; if (!d.open) d.showModal(); return d; }
const dlgClose = () => { const d = $('posDlg'); if (d.open) d.close(); };

// ---------- شاشة الكاشير ----------
async function viewPos() {
  if (!P) resetPos();
  $('content').classList.add('wide');
  PM = await api.menuGet();
  try { P.floor = await api.tablesFloor(); } catch { P.floor = []; }
  P.kitchen = !!(PM.stations && PM.stations.length);
  try { LOY = await api.loyaltyGet(); } catch { LOY = { enabled: false }; }
  try { P.dcfg = await api.deliveryConfig(); } catch { P.dcfg = { baseFeeCents: 0, zones: [] }; }
  drawPos();
}

// لون شريط البلاطة = لون تصنيف الصنف (إن كان صالحاً)
const tileColor = (i) => { const c = (PM.categories.find((x) => x.id === i.categoryId) || {}).color || ''; return /^#[0-9a-fA-F]{6}$/.test(c) ? ` style="--cc:${c}"` : ''; };
const tileOut = (i) => i.soldOut || ((i.variants || []).length > 0 && i.variants.every((v) => v.soldOut));
function drawPos() {
  const cats = PM.categories.filter((c) => c.active !== false);
  const shown = new Set(cats.map((c) => c.id));
  if (P.cat && !shown.has(P.cat)) P.cat = '';
  const items = PM.items.filter((i) => i.active && shown.has(i.categoryId) && (!P.cat || i.categoryId === P.cat));
  $('content').innerHTML = `
  <div class="pos">
   <div>
    <div class="cats"><button data-c="" class="${P.cat ? '' : 'on'}">الكل</button>${cats.map((c) => `<button data-c="${esc(c.id)}" class="${P.cat === c.id ? 'on' : ''}" ${/^#[0-9a-fA-F]{6}$/.test(c.color || '') ? `style="border-inline-start:6px solid ${c.color}"` : ''}>${esc(c.name)}</button>`).join('')}</div>
    <div class="grid">${items.map((i) => `<button class="tile ${tileOut(i) ? 'off' : ''}" data-i="${esc(i.id)}" ${tileOut(i) ? 'disabled' : ''}${tileColor(i)}>
      ${i.image ? `<img src="${esc(i.image)}">` : `<div class="ph">${esc([...String(i.name || '').trim()][0] || '')}</div>`}<span>${esc(i.name)}</span><small>${(i.variants || []).length > 1 ? 'من ' + money(Math.min(...i.variants.map((v) => v.priceCents))) : money(i.priceCents)}${tileOut(i) ? ' — نفد' : ''}</small></button>`).join('') || '<div class="card">لا توجد أصناف. أضفها من صفحة المنيو.</div>'}</div>
   </div>
   <div class="card cart">
    <div class="head"><b>${P.number ? `طلب #${P.number} (مفتوح)` : 'طلب جديد'}</b></div>
    <div class="seg">${Object.entries(TYPE_L).map(([k, l]) => `<button data-t="${k}" class="${P.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="pFields"></div>
    ${can('customers') ? '<div id="pCrm" class="pcrm"></div>' : ''}
    <div id="pLines" class="lines"></div>
    ${can('discount') ? `<div class="drow"><label>خصم</label><select id="dType"><option value="percent" ${P.disc.type === 'percent' ? 'selected' : ''}>%</option><option value="fixed" ${P.disc.type === 'fixed' ? 'selected' : ''}>مبلغ</option></select><input id="dVal" type="number" min="0" step="0.01" value="${esc(P.disc.value)}"></div>` : ''}
    <div id="pTot"></div><div id="pErr" class="err"></div>
    <div class="acts"><button id="pPay">دفع</button><button class="sec" id="pSave">حفظ كمفتوح</button>${P.kitchen ? '<button class="sec" id="pKit">إرسال للمطبخ</button>' : ''}<button class="sec" id="pClear">${P.orderId ? 'طلب جديد' : 'مسح'}</button></div>
   </div>
  </div>`;
  document.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { P.cat = b.dataset.c; drawPos(); }));
  document.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => pickItem(PM.items.find((i) => i.id === b.dataset.i))));
  document.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { readFields(); P.type = b.dataset.t; drawPos(); }));
  drawFields(); drawCrm(); drawCart();
  if ($('dType')) { $('dType').onchange = () => { P.disc.type = $('dType').value; requote(); }; $('dVal').oninput = () => { P.disc.value = $('dVal').value; requote(); }; }
  $('pPay').onclick = () => checkout(true);
  $('pSave').onclick = () => checkout(false);
  if ($('pKit')) $('pKit').onclick = sendKitchenNow;
  $('pClear').onclick = () => { if (!P.cart.length || confirm('مسح الطلب الحالي؟')) { resetPos(); drawPos(); } };
}

function drawFields() {
  const f = $('pFields');
  if (P.type === 'dine_in' && P.floor.length) f.innerHTML = `<select id="fTable"><option value="">اختر الطاولة</option>${P.floor.map((t) => `<option value="${esc(t.id)}" ${P.tableId === t.id ? 'selected' : ''}>${esc(t.name)} — ${esc(t.area)}${t.orders.length ? ' • مشغولة' : ''}</option>`).join('')}</select>`;
  else if (P.type === 'dine_in') f.innerHTML = `<input id="fTable" placeholder="رقم الطاولة" value="${esc(P.table)}">`;
  else if (P.type === 'delivery') {
    const dc = P.dcfg || { baseFeeCents: 0, zones: [] };
    if (!dc.zones.some((z) => z.id === P.zoneId)) P.zoneId = ''; // منطقة محذوفة من الإعدادات
    const zone = dc.zones.length ? `<select id="fZone"><option value="">منطقة التوصيل — الأجرة الافتراضية ${money(dc.baseFeeCents)}</option>${dc.zones.map((z) => `<option value="${esc(z.id)}" ${P.zoneId === z.id ? 'selected' : ''}>${esc(z.name)} — ${money(z.feeCents)}</option>`).join('')}</select>` : '';
    const fee = can('discount') ? `<input id="fFee" type="number" min="0" step="0.01" placeholder="أجرة توصيل مخصصة (فارغ = تلقائي)" value="${P.feeOv == null ? '' : esc(P.feeOv)}">` : '';
    f.innerHTML = `<input id="fName" placeholder="اسم العميل" value="${esc(P.cust.name)}"><input id="fPhone" placeholder="الجوال *" dir="ltr" value="${esc(P.cust.phone)}"><input id="fAddr" placeholder="العنوان" value="${esc(P.cust.address)}">${zone}${fee}`;
    if ($('fZone')) $('fZone').onchange = () => { P.zoneId = $('fZone').value; requote(); };
    if ($('fFee')) $('fFee').oninput = () => { P.feeOv = $('fFee').value; requote(); };
  } else f.innerHTML = '';
}
function readFields() {
  if ($('fTable')) { if ($('fTable').tagName === 'SELECT') P.tableId = $('fTable').value; else P.table = $('fTable').value; }
  if ($('fName')) { P.cust = { name: $('fName').value, phone: $('fPhone').value, address: $('fAddr').value }; }
  if ($('fZone')) P.zoneId = $('fZone').value;
}

// ---------- ربط العميل (اختياري) ----------
const setCrm = (c) => { P.crm = { id: c.id, name: c.name, phone: c.phone, points: c.points }; drawCrm(); };
function drawCrm() {
  const el = $('pCrm'); if (!el) return;
  if (P.crm) {
    el.innerHTML = `👤 <b>${esc(P.crm.name)}</b>${LOY.enabled ? ` — ${P.crm.points} نقطة` : ''} <button class="sm sec" id="cRm">✕</button>`;
    $('cRm').onclick = () => { P.crm = null; drawCrm(); };
    return;
  }
  el.innerHTML = '<div class="drow"><input id="cPh" dir="ltr" inputmode="tel" placeholder="جوال العميل (اختياري)"><button class="sm sec" id="cFind">بحث</button></div><div id="cMsg" class="muted" style="padding:2px"></div>';
  const find = async () => {
    if (!$('cPh').value.trim()) return;
    try {
      const c = await api.custFind($('cPh').value);
      if (c) return setCrm(c);
      $('cMsg').innerHTML = 'غير مسجّل — <a href="#" id="cAdd" class="lnk">إضافة عميل</a>';
      $('cAdd').onclick = (e) => { e.preventDefault(); custForm({ phone: $('cPh').value }, setCrm); };
    } catch (e) { $('cMsg').textContent = errMsg(e); }
  };
  $('cFind').onclick = find; $('cPh').onkeydown = (e) => { if (e.key === 'Enter') find(); };
}

// ---------- السلة ----------
const lineKey = (l) => l.itemId + '|' + (l.variantId || '') + '|' + l.mods.map((m) => m.g + ':' + m.o).sort().join(',');
function addLine(item, mods, vr) {
  const l = { itemId: item.id, name: vr ? `${item.name} · ${vr.name}` : item.name, qty: 1, mods, note: '', noteOpen: false, sent: 0, ...(vr ? { variantId: vr.id } : {}) };
  const ex = P.cart.find((x) => lineKey(x) === lineKey(l) && !x.note);
  if (ex) ex.qty = Math.min(99, ex.qty + 1); else P.cart.push(l);
  drawCart();
}
function pickItem(item) {
  const groups = (item.modifierGroupIds || []).map((id) => PM.modGroups.find((g) => g.id === id)).filter(Boolean);
  const vars = item.variants || [];
  if (!groups.length && vars.length <= 1) return addLine(item, [], vars[0]);
  const defV = vars.find((v) => v.isDefault && !v.soldOut) || vars.find((v) => !v.soldOut);
  const d = dlgOpen(`<h3>${esc(item.name)}</h3>${vars.length > 1 ? `<fieldset><legend>الحجم / النوع *</legend>${vars.map((v) => `<label class="chk"><input type="radio" name="vr" data-v="${esc(v.id)}" ${v.soldOut ? 'disabled' : ''} ${defV && defV.id === v.id ? 'checked' : ''}>${esc(v.name)} <small>${money(v.priceCents)}${v.soldOut ? ' — نفد' : ''}</small></label>`).join('')}</fieldset>` : ''}${groups.map((g) => `<fieldset><legend>${esc(g.name)}${g.required ? ' *' : ''}${g.multi ? ' (اختيار متعدد)' : ''}</legend>
    ${g.options.map((o, i) => `<label class="chk"><input type="${g.multi ? 'checkbox' : 'radio'}" name="g_${esc(g.id)}" data-g="${esc(g.id)}" data-o="${i}" ${!g.multi && g.required && i === 0 ? 'checked' : ''}>${esc(o.name)}${o.priceCents ? ` <small>+${money(o.priceCents)}</small>` : ''}</label>`).join('')}</fieldset>`).join('')}
    <div id="mErr2" class="err"></div><button id="mOk">إضافة</button><button class="sec" id="mNo">إلغاء</button>`);
  d.querySelector('#mNo').onclick = dlgClose;
  d.querySelector('#mOk').onclick = () => {
    const mods = [];
    for (const g of groups) {
      const sel = [...d.querySelectorAll(`[data-g="${g.id}"]:checked`)].map((c) => +c.dataset.o);
      if (g.required && !sel.length) return (d.querySelector('#mErr2').textContent = `اختر من «${g.name}»`);
      sel.forEach((o) => mods.push({ g: g.id, o, name: g.options[o].name }));
    }
    let vr = vars[0];
    if (vars.length > 1) {
      const c = d.querySelector('[data-v]:checked');
      if (!c) return (d.querySelector('#mErr2').textContent = 'اختر الحجم / النوع');
      vr = vars.find((v) => v.id === c.dataset.v);
    }
    dlgClose(); addLine(item, mods, vr);
  };
}

// تقليل صنف أُرسل للمطبخ لا يُبلغ المطبخ — ننبّه الكاشير
const okReduce = (l, to) => !(l.sent && to < l.sent) || confirm('هذا الصنف أُرسل للمطبخ بالفعل، وتقليله لن يُبلغ المطبخ. متابعة؟');
function drawCart() {
  $('pLines').innerHTML = P.cart.map((l, i) => `<div class="ln"><div class="top"><b>${esc(l.name)}</b>
    <span class="qty"><button class="sm sec" data-m="${i}">−</button> ${l.qty} <button class="sm sec" data-p="${i}">+</button></span>
    <span class="amt" data-a="${i}"></span><button class="sm danger" data-x="${i}">✕</button></div>
    ${l.mods.length ? `<small>+ ${esc(l.mods.map((m) => m.name).join('، '))}</small>` : ''}${l.sent ? ` <small class="sentb">✓ أُرسل ${l.sent}</small>` : ''}
    ${l.noteOpen || l.note ? `<input class="nt" data-n="${i}" placeholder="ملاحظة" value="${esc(l.note)}">` : `<a href="#" data-no="${i}" class="lnk">ملاحظة</a>`}</div>`).join('') || '<div class="muted">السلة فارغة</div>';
  document.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { const l = P.cart[+b.dataset.m]; if (!okReduce(l, l.qty - 1)) return; if (--l.qty < 1) P.cart.splice(+b.dataset.m, 1); drawCart(); }));
  document.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { const l = P.cart[+b.dataset.p]; l.qty = Math.min(99, l.qty + 1); drawCart(); }));
  document.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => { if (!okReduce(P.cart[+b.dataset.x], 0)) return; P.cart.splice(+b.dataset.x, 1); drawCart(); }));
  document.querySelectorAll('[data-no]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); P.cart[+a.dataset.no].noteOpen = true; drawCart(); }));
  document.querySelectorAll('[data-n]').forEach((i) => (i.oninput = () => { P.cart[+i.dataset.n].note = i.value; }));
  requote();
}

const payload = () => ({
  id: P.orderId, type: P.type, table: P.table, tableId: P.tableId, customer: P.cust, note: P.note, customerId: can('customers') ? (P.crm ? P.crm.id : null) : undefined,
  discount: can('discount') && +P.disc.value > 0 ? { type: P.disc.type, value: +P.disc.value } : null,
  zoneId: P.type === 'delivery' ? P.zoneId || null : undefined,
  // أجرة مخصصة (للمالك/المدير): غير مُرسَلة = تُبقي السابقة، null = تلقائي، رقم = يدوية
  deliveryFee: P.type === 'delivery' && can('discount') && P.feeOv !== undefined ? (P.feeOv === null || P.feeOv === '' ? null : +P.feeOv) : undefined,
  lines: P.cart.map((l) => ({ itemId: l.itemId, ...(l.variantId ? { variantId: l.variantId } : {}), qty: l.qty, mods: l.mods.map((m) => ({ g: m.g, o: m.o })), note: l.note })),
});

async function requote() {
  const seq = ++qSeq;
  if (!P.cart.length) { P.quote = null; return drawTotals(); }
  try {
    const q = await api.orderQuote(payload());
    if (seq !== qSeq) return;
    P.quote = q; $('pErr').textContent = '';
    q.lines.forEach((l, i) => { const e = document.querySelector(`[data-a="${i}"]`); if (e) e.textContent = money(l.totalCents); });
  } catch (e) { if (seq !== qSeq) return; P.quote = null; $('pErr').textContent = errMsg(e); }
  drawTotals();
}
function drawTotals() {
  const q = P.quote;
  $('pTot').innerHTML = q ? `<table class="tt"><tr><td>المجموع</td><td>${money(q.subtotalCents)}</td></tr>
    ${q.discountCents ? `<tr><td>الخصم</td><td>-${money(q.discountCents)}</td></tr>` : ''}
    <tr><td>الضريبة (${Math.round(q.vatRate * 100)}%)</td><td>${money(q.vatCents)}</td></tr>
    ${q.deliveryFeeCents ? `<tr><td>أجرة التوصيل${q.deliveryZone ? ' (' + esc(q.deliveryZone) + ')' : ''}</td><td>${money(q.deliveryFeeCents)}</td></tr>` : q.freeDelivery ? '<tr><td>أجرة التوصيل</td><td>مجاناً</td></tr>' : ''}
    <tr class="g"><td>الإجمالي</td><td>${money(q.totalCents)} ر.س</td></tr></table>` : '';
}

// ---------- حفظ / دفع ----------
async function checkout(payNow) {
  readFields();
  if (!P.cart.length) return ($('pErr').textContent = 'السلة فارغة');
  try {
    const o = await api.orderSave(payload());
    P.orderId = o.id; P.number = o.number;
    if (payNow) return payDialog(o);
    await afterOrder(); flash(`تم حفظ الطلب #${o.number}`);
  } catch (e) { $('pErr').textContent = errMsg(e); }
}
async function sendKitchenNow() {
  readFields();
  if (!P.cart.length) return ($('pErr').textContent = 'السلة فارغة');
  try {
    const o = await api.orderSave(payload());
    P.orderId = o.id; P.number = o.number;
    const r = await api.kitchenSend(o.id);
    await afterOrder();
    flash(`أُرسل للمطبخ: ${r.tickets.map((t) => t.stationName).join('، ')}${r.printErrors.length ? ' — تنبيه طباعة: ' + r.printErrors[0] : ''}`);
  } catch (e) { $('pErr').textContent = errMsg(e); }
}
function flash(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2500); }

function payDialog(o) {
  const cr = P.crm, usePts = !!(LOY.enabled && cr), pv = LOY.pointValueCents || 5;
  const labels = { ...METHOD_L, gift: 'كرت هدية', ...(usePts ? { points: 'نقاط الولاء' } : {}) };
  const rows = [{ method: 'cash', amount: money(o.totalCents), code: '' }];
  const sum = (list) => list.reduce((t, x) => t + Math.round((+x.amount || 0) * 100), 0);
  // أقصى مبلغ بالنقاط: لا يتجاوز الرصيد ولا المتبقي، ومن مضاعفات قيمة النقطة
  const ptsMax = (remain) => Math.floor(Math.min(cr.points * pv, Math.max(0, remain)) / pv) * pv;
  const toPay = (r) => (r.method === 'gift' ? { method: 'other', kind: 'gift', ref: r.code, amount: +r.amount } : r.method === 'points' ? { method: 'other', kind: 'points', amount: +r.amount } : { method: r.method, amount: +r.amount });
  const d = dlgOpen('');
  const draw = () => {
    const diff = sum(rows) - o.totalCents;
    d.innerHTML = `<h3>دفع طلب #${o.number}</h3><div class="big">${money(o.totalCents)} ر.س</div>${cr ? `<div class="muted">👤 ${esc(cr.name)}${usePts ? ` — ${cr.points} نقطة (${money(cr.points * pv)} ر.س)` : ''}</div>` : ''}
      ${rows.map((r, i) => `<div class="prow"><select data-pm="${i}">${Object.entries(labels).map(([k, l]) => `<option value="${k}" ${r.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${r.method === 'gift' ? `<input data-pc="${i}" dir="ltr" placeholder="رمز الكرت" value="${esc(r.code)}">` : ''}
        <input data-pa="${i}" type="number" min="0" step="0.01" value="${esc(r.amount)}">${rows.length > 1 ? `<button class="sm danger" data-pr="${i}">✕</button>` : ''}</div>
        ${r.method === 'gift' ? `<div class="muted" id="gb${i}" style="padding:0"></div>` : ''}`).join('')}
      <div class="quick"><button class="sm sec" id="qCash">كامل نقداً</button><button class="sm sec" id="qCard">كامل بطاقة</button>${usePts && cr.points ? '<button class="sm sec" id="qPts">استخدم النقاط</button>' : ''}<button class="sm sec" id="qAdd">+ دفعة</button></div>
      <div class="${diff < 0 ? 'err' : 'ok'}">${diff < 0 ? `المتبقي ${money(-diff)}` : diff > 0 ? `الباقي للعميل ${money(diff)}` : 'المبلغ مطابق'}</div>
      <div id="payErr" class="err"></div><button id="payOk">تأكيد الدفع</button><button class="sec" id="payNo">رجوع</button>`;
    d.querySelectorAll('[data-pm]').forEach((s) => (s.onchange = () => {
      const r = rows[+s.dataset.pm]; r.method = s.value;
      if (r.method === 'points') r.amount = money(ptsMax(o.totalCents - sum(rows.filter((x) => x !== r))));
      draw();
    }));
    d.querySelectorAll('[data-pa]').forEach((i) => (i.onchange = () => { rows[+i.dataset.pa].amount = i.value; draw(); }));
    d.querySelectorAll('[data-pc]').forEach((i) => {
      i.oninput = () => { rows[+i.dataset.pc].code = i.value; };
      i.onchange = async () => { // عرض رصيد الكرت فور إدخال الرمز
        const out = d.querySelector('#gb' + i.dataset.pc);
        try { const c = await api.giftGet(i.value); out.textContent = c.status !== 'active' || c.expired ? 'الكرت ملغي أو منتهي' : `رصيد الكرت ${money(c.balanceCents)} ر.س`; } catch (e) { out.textContent = errMsg(e); }
      };
    });
    d.querySelectorAll('[data-pr]').forEach((b) => (b.onclick = () => { rows.splice(+b.dataset.pr, 1); draw(); }));
    d.querySelector('#qCash').onclick = () => { rows.splice(0, rows.length, { method: 'cash', amount: money(o.totalCents), code: '' }); draw(); };
    d.querySelector('#qCard').onclick = () => { rows.splice(0, rows.length, { method: 'card', amount: money(o.totalCents), code: '' }); draw(); };
    if (d.querySelector('#qPts')) d.querySelector('#qPts').onclick = () => {
      const m = ptsMax(o.totalCents);
      rows.splice(0, rows.length, { method: 'points', amount: money(m), code: '' });
      if (o.totalCents - m > 0) rows.push({ method: 'cash', amount: money(o.totalCents - m), code: '' });
      draw();
    };
    d.querySelector('#qAdd').onclick = () => { rows.push({ method: 'card', amount: diff < 0 ? money(-diff) : '', code: '' }); draw(); };
    d.querySelector('#payNo').onclick = dlgClose;
    d.querySelector('#payOk').onclick = async () => {
      try {
        const done = await api.orderPay(o.id, o.totalCents === 0 ? [] : rows.map(toPay));
        dlgClose(); await afterOrder(); showReceipt(done.id);
        if (usePts) api.custGet(cr.id).then((c) => flash(`رصيد ${c.name}: ${c.points} نقطة`)).catch(() => {});
      } catch (e) { d.querySelector('#payErr').textContent = errMsg(e); }
    };
  };
  draw();
}

// ---------- معاينة/طباعة إيصال طلب ----------
async function showReceipt(id) {
  const o = loadPrintOpts(); o.silent = false;
  $('frame').style.width = (o.width === 58 ? 260 : 340) + 'px';
  try { $('frame').srcdoc = await api.orderReceipt(id, o); } catch (e) { return flash(errMsg(e)); }
  $('msg').textContent = ''; $('modal').classList.add('open');
  $('printBtn').onclick = async () => {
    try { $('msg').style.color = '#2563eb'; $('msg').textContent = 'جاري الطباعة...'; await api.orderPrint(id, o); $('msg').style.color = '#16a34a'; $('msg').textContent = 'تمت الطباعة ✓'; }
    catch (e) { $('msg').style.color = '#b91c1c'; $('msg').textContent = 'فشلت الطباعة: ' + errMsg(e) + ' (اضبط الطابعة من صفحة «الطباعة»)'; }
  };
}

// ---------- قائمة الطلبات ----------
let oFilter = '', oDays = 1;
async function viewOrders() {
  $('content').classList.remove('wide');
  const rows = await api.orderList({ status: oFilter || undefined, days: oDays });
  const F = [['', 'الكل'], ['open', 'مفتوحة'], ['paid', 'مدفوعة'], ['void', 'ملغاة']];
  $('content').innerHTML = `<h2>الطلبات</h2>
   <div class="tabs">${F.map(([k, l]) => `<button data-f="${k}" class="${k === oFilter ? 'on' : ''}">${l}</button>`).join('')}
   <select id="oDays" style="width:auto"><option value="1" ${oDays === 1 ? 'selected' : ''}>اليوم</option><option value="7" ${oDays === 7 ? 'selected' : ''}>آخر 7 أيام</option><option value="30" ${oDays === 30 ? 'selected' : ''}>آخر 30 يوماً</option></select></div>
   <table><tr><th>#</th><th>الوقت</th><th>النوع</th><th>الإجمالي</th><th>الحالة</th><th></th></tr>
   ${rows.map((o) => `<tr><td>${o.number}</td><td>${new Date(o.createdAt).toLocaleString('ar-SA')}</td><td>${TYPE_L[o.type]}${o.table ? ' ' + esc(o.table) : ''}</td>
    <td>${money(o.totalCents)}</td><td>${STATUS_L[o.status]}${o.status === 'paid' && o.payments?.length ? '' : ''}</td>
    <td>${o.status === 'open' ? `<button class="sm" data-res="${o.id}">متابعة</button> ` : ''}${o.status === 'open' && can('tables') ? `<button class="sm sec" data-sp="${o.id}">تقسيم</button> ` : ''}${can('print') ? `<button class="sm sec" data-rc="${o.id}">إيصال</button> ` : ''}${o.status !== 'void' ? `<button class="sm danger" data-vd="${o.id}" data-st="${o.status}">إلغاء</button>` : ''}</td></tr>`).join('')}</table>
   ${rows.length ? '' : '<div class="card">لا توجد طلبات.</div>'}<div id="oErr" class="err"></div>`;
  document.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { oFilter = b.dataset.f; viewOrders(); }));
  $('oDays').onchange = () => { oDays = +$('oDays').value; viewOrders(); };
  document.querySelectorAll('[data-rc]').forEach((b) => (b.onclick = () => showReceipt(+b.dataset.rc)));
  document.querySelectorAll('[data-res]').forEach((b) => (b.onclick = () => resume(rows.find((o) => o.id === +b.dataset.res))));
  document.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => splitDialog(+b.dataset.sp, viewOrders)));
  document.querySelectorAll('[data-vd]').forEach((b) => (b.onclick = () => voidDialog(+b.dataset.vd, b.dataset.st)));
}

async function resume(o) {
  resetPos();
  Object.assign(P, { orderId: o.id, number: o.number, type: o.type, table: o.table, tableId: o.tableId || '', cust: { name: '', phone: '', address: '', ...o.customer }, note: o.note,
    zoneId: o.deliveryZoneId || '', feeOv: o.feeManual ? String(o.deliveryFeeCents / 100) : undefined,
    disc: o.discount || { type: 'percent', value: '' } });
  P.cart = o.lines.map((l) => ({ itemId: l.itemId, ...(l.variantId ? { variantId: l.variantId } : {}), name: l.name, qty: l.qty, note: l.note, noteOpen: false, sent: l.sentQty || 0, mods: l.mods.map((m) => ({ g: m.g, o: m.o, name: m.name })) }));
  if (o.customerId && can('customers')) { try { const c = await api.custGet(o.customerId); P.crm = { id: c.id, name: c.name, phone: c.phone, points: c.points }; } catch {} }
  open('pos');
}

function voidDialog(id, status) {
  const d = dlgOpen(`<h3>إلغاء الطلب</h3><label>السبب${status === 'paid' ? ' (مطلوب)' : ' (اختياري)'}</label><input id="vReason" maxlength="120">
    <div id="vErr" class="err"></div><button class="danger" id="vOk">تأكيد الإلغاء</button><button class="sec" id="vNo">رجوع</button>`);
  d.querySelector('#vNo').onclick = dlgClose;
  d.querySelector('#vOk').onclick = async () => {
    try { await api.orderVoid(id, d.querySelector('#vReason').value); if (P?.orderId === id) resetPos(); dlgClose(); viewOrders(); }
    catch (e) { d.querySelector('#vErr').textContent = errMsg(e); }
  };
}
