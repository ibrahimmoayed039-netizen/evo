// صفحة المخزون: مكوّنات، وصفات، جرد، مشتريات، حركات (تعتمد على $ و esc و errMsg و can من renderer.js، و money/dlgOpen/dlgClose/flash من pos.js و fmtT من shift.js)
let INV = { tab: 'stock', d: null, menu: null };
const UNIT_L = { g: 'جرام', ml: 'مل', pcs: 'حبة' };
const REASON_L = { initial: 'رصيد افتتاحي', sale: 'بيع', void: 'إرجاع (إلغاء)', purchase: 'شراء', adjust: 'إضافة', waste: 'هدر', count: 'جرد' };
const PO_L = { draft: 'مسودة', ordered: 'تم الطلب', received: 'مستلم', cancelled: 'ملغى' };
const nz = (x) => String(Number((+x).toFixed(3)));
const qtyFmt = (q, unit) => {
  const a = Math.abs(q), sg = q < 0 ? '-' : '';
  if (unit === 'g' && a >= 1000) return `${sg}${nz(a / 1000)} كجم`;
  if (unit === 'ml' && a >= 1000) return `${sg}${nz(a / 1000)} لتر`;
  return `${sg}${nz(a)} ${UNIT_L[unit]}`;
};
const packOf = (unit) => (unit === 'pcs' ? 1 : 1000);
const costLabel = (i) => `${money(i.unitCostCents * packOf(i.unit))} / ${i.unit === 'g' ? 'كجم' : i.unit === 'ml' ? 'لتر' : 'حبة'}`;
const ingOpts = (list, sel) => list.map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} (${UNIT_L[i.unit]})${i.active ? '' : ' — معطّل'}</option>`).join('');

async function viewInventory() {
  $('content').classList.add('wide');
  let d, m;
  try { [d, m] = await Promise.all([api.invList(), api.menuGet()]); } catch (e) { $('content').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; return; }
  INV.d = d; INV.menu = m;
  const low = d.ingredients.filter((i) => i.low), T = [['stock', 'المخزون'], ['recipes', 'الوصفات'], ['count', 'الجرد'], ['po', 'المشتريات'], ['moves', 'الحركات']];
  $('content').innerHTML = `<h2>المخزون</h2><div class="tabs">${T.map(([k, l]) => `<button data-it="${k}" class="${INV.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
   ${low.length ? `<div class="card warnb">⚠ مواد وصلت للحد الأدنى أو أقل: ${low.map((i) => `<b>${esc(i.name)}</b> (${qtyFmt(i.qty, i.unit)})`).join('، ')}</div>` : ''}
   <div id="invBody"></div><div id="invErr" class="err"></div>`;
  document.querySelectorAll('[data-it]').forEach((b) => (b.onclick = () => { INV.tab = b.dataset.it; viewInventory(); }));
  try { await ({ stock: tabStock, recipes: tabRecipes, count: tabCount, po: tabPo, moves: tabMoves }[INV.tab])(d, m); } catch (e) { $('invErr').textContent = errMsg(e); }
}
const invFail = (e) => { const x = $('invErr'); if (x) x.textContent = errMsg(e); };

// ---------- المخزون ----------
function tabStock(d) {
  const cats = [...new Set(d.ingredients.map((i) => i.category).filter(Boolean))];
  if (INV.cat && !cats.includes(INV.cat)) INV.cat = '';
  const shown = d.ingredients.filter((i) => !INV.cat || i.category === INV.cat);
  const tot = d.ingredients.filter((i) => i.active).reduce((s, i) => s + i.valueCents, 0);
  $('invBody').innerHTML = `<div class="drow"><input id="invQ" placeholder="بحث بالاسم"><button id="invAdd">+ مكوّن</button></div><p class="muted">قيمة المخزون التقديرية: <b>${money(tot)}</b></p>
   ${cats.length ? `<div class="tabs"><button data-ct="" class="${INV.cat ? '' : 'on'}">الكل</button>${cats.map((c) => `<button data-ct="${esc(c)}" class="${INV.cat === c ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>` : ''}
   <table><tr><th>المكوّن</th><th>التصنيف</th><th>وحدة الشراء</th><th>الكمية</th><th>الحد الأدنى</th><th>التكلفة</th><th>القيمة</th><th></th></tr><tbody id="invRows">
   ${shown.map((i) => `<tr data-n="${esc(i.name.toLowerCase())}" class="${i.low ? 'lowr' : ''} ${i.active ? '' : 'off'}"><td>${esc(i.name)}${i.active ? '' : ' <small>(معطّل)</small>'}</td><td>${esc(i.category || '—')}</td><td>${esc(i.packLabel || '—')}</td><td>${qtyFmt(i.qty, i.unit)}</td><td>${i.minQty ? qtyFmt(i.minQty, i.unit) : '-'}</td>
    <td>${costLabel(i)}</td><td>${money(i.valueCents)}</td>
    <td><button class="sm" data-ia="${esc(i.id)}">+ إضافة</button> <button class="sm sec" data-iw="${esc(i.id)}">هدر</button> <button class="sm sec" data-ie="${esc(i.id)}">تعديل</button></td></tr>`).join('')}</tbody></table>
   ${d.ingredients.length ? '' : '<div class="card">لا توجد مكوّنات بعد. أضف المكوّنات (بن، حليب، أكواب…) ثم اربطها بالأصناف من تبويب «الوصفات» ليُخصم المخزون تلقائياً مع كل بيع.</div>'}`;
  $('invAdd').onclick = () => ingDialog(null);
  document.querySelectorAll('[data-ct]').forEach((b) => (b.onclick = () => { INV.cat = b.dataset.ct; tabStock(d); }));
  $('invQ').oninput = () => { const q = $('invQ').value.trim().toLowerCase(); document.querySelectorAll('#invRows tr').forEach((r) => (r.style.display = r.dataset.n.includes(q) ? '' : 'none')); };
  const by = (id) => d.ingredients.find((x) => x.id === id);
  document.querySelectorAll('[data-ie]').forEach((b) => (b.onclick = () => ingDialog(by(b.dataset.ie))));
  document.querySelectorAll('[data-ia]').forEach((b) => (b.onclick = () => adjDialog(by(b.dataset.ia), 'add')));
  document.querySelectorAll('[data-iw]').forEach((b) => (b.onclick = () => adjDialog(by(b.dataset.iw), 'waste')));
}

function ingDialog(i) {
  const pk = i ? packOf(i.unit) : 1000;
  const dlg = dlgOpen(`<h3>${i ? 'تعديل مكوّن' : 'مكوّن جديد'}</h3>
   <label>الاسم</label><input id="igName" value="${esc(i?.name || '')}" maxlength="80">
   <label>التصنيف (لحوم، ألبان…)</label><input id="igCat" value="${esc(i?.category || '')}" maxlength="60" list="igCats"><datalist id="igCats">${[...new Set(INV.d.ingredients.map((x) => x.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
   <label>وحدة الشراء (مثال: كرتون 10 كجم)</label><input id="igPackL" value="${esc(i?.packLabel || '')}" maxlength="60">
   <label>المورّد</label><input id="igSup" value="${esc(i?.supplier || '')}" maxlength="60">
   <label>الوحدة</label><select id="igUnit">${Object.entries(UNIT_L).map(([k, l]) => `<option value="${k}" ${i?.unit === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
   ${i ? '' : '<label>الكمية الحالية (بالوحدة الأساسية: جرام/مل/حبة)</label><input id="igQty" type="number" min="0" step="any" value="0">'}
   <label>الحد الأدنى للتنبيه (بالوحدة الأساسية، 0 = بلا تنبيه)</label><input id="igMin" type="number" min="0" step="any" value="${nz(i?.minQty || 0)}">
   <div class="drow"><label>سعر الشراء</label><input id="igPrice" type="number" min="0" step="any" value="${i ? nz((i.unitCostCents / 100) * pk) : ''}"><label>لكل</label><input id="igPack" type="number" min="0.001" step="any" value="${pk}"></div>
   <small class="muted">مثال: 45 ريال لكل 1000 جرام. للحبة: السعر لكل 1.</small>
   ${i ? `<label class="chk"><input type="checkbox" id="igAct" ${i.active ? 'checked' : ''}> مفعّل</label>` : ''}
   <div id="igErr" class="err"></div><div class="acts"><button id="igOk">حفظ</button>${i ? '<button id="igDel" class="danger">حذف</button>' : ''}<button class="sec" id="igNo">إلغاء</button></div>`);
  const q = (s) => dlg.querySelector(s);
  q('#igNo').onclick = dlgClose;
  q('#igOk').onclick = async () => {
    try {
      const pack = +q('#igPack').value;
      if (!(pack > 0)) throw new Error('كمية السعر غير صالحة');
      await api.invSave({ id: i?.id, name: q('#igName').value, unit: q('#igUnit').value, qty: q('#igQty') ? q('#igQty').value : 0, category: q('#igCat').value, packLabel: q('#igPackL').value, supplier: q('#igSup').value, minQty: q('#igMin').value, unitCost: (+q('#igPrice').value || 0) / pack, active: q('#igAct') ? q('#igAct').checked : true });
      dlgClose(); viewInventory();
    } catch (e) { q('#igErr').textContent = errMsg(e); }
  };
  if (q('#igDel')) q('#igDel').onclick = async () => { try { await api.invDelete(i.id); dlgClose(); viewInventory(); } catch (e) { q('#igErr').textContent = errMsg(e); } };
}

function adjDialog(i, type) {
  const dlg = dlgOpen(`<h3>${type === 'add' ? 'إضافة كمية' : 'تسجيل هدر'} — ${esc(i.name)}</h3><p class="muted">الرصيد الحالي: ${qtyFmt(i.qty, i.unit)}</p>
   <label>الكمية (${UNIT_L[i.unit]})</label><input id="adQty" type="number" min="0" step="any"><label>${type === 'waste' ? 'السبب (إلزامي)' : 'ملاحظة'}</label><input id="adNote" maxlength="120">
   <div id="adErr" class="err"></div><div class="acts"><button id="adOk">حفظ</button><button class="sec" id="adNo">إلغاء</button></div>`);
  dlg.querySelector('#adNo').onclick = dlgClose;
  dlg.querySelector('#adOk').onclick = async () => {
    try { await api.invAdjust(i.id, type, dlg.querySelector('#adQty').value, dlg.querySelector('#adNote').value); dlgClose(); viewInventory(); }
    catch (e) { dlg.querySelector('#adErr').textContent = errMsg(e); }
  };
}

// ---------- الوصفات ----------
const rkey = (it, v) => (v ? `${it.id}#${v.id}` : it.id);
function tabRecipes(d, m) {
  const cost = (key) => (d.recipes[key] || []).reduce((s, r) => s + r.qty * (d.ingredients.find((i) => i.id === r.ingredientId)?.unitCostCents || 0), 0);
  // صف لكل صنف، أو لكل نوع إن كان للصنف أنواع
  const rows = m.items.flatMap((it) => ((it.variants || []).length ? it.variants.map((v) => ({ it, v, price: v.priceCents })) : [{ it, v: null, price: it.priceCents }]));
  $('invBody').innerHTML = `<p class="muted">اربط كل صنف (أو كل حجم) بمكوّناته. يُخصم المخزون عند دفع الطلب ويُعاد عند إلغاء طلب مدفوع. «يدوي» = لا خصم تلقائي للصنف. (الإضافات لا تخصم بعد.)</p>
   <table><tr><th>الصنف</th><th>السعر</th><th>المكوّنات</th><th>التكلفة</th><th>الهامش</th><th>الخصم</th><th></th></tr>
   ${rows.map(({ it, v, price }) => { const k = rkey(it, v), n = (d.recipes[k] || []).length, c = Math.round(cost(k)); return `<tr><td>${esc(it.name)}${v ? ' · ' + esc(v.name) : ''}</td><td>${money(price)}</td><td>${n || '<small class="muted">بلا وصفة</small>'}</td>
    <td>${n ? money(c) : '-'}</td><td>${n && price ? Math.round(((price - c) / price) * 100) + '%' : '-'}</td>
    <td>${it.stockMode === 'manual' ? 'يدوي' : 'تلقائي'}</td><td><button class="sm" data-rc="${esc(it.id)}" data-rv="${esc(v ? v.id : '')}">${n ? 'تعديل' : 'إضافة وصفة'}</button></td></tr>`; }).join('')}</table>
   ${m.items.length ? '' : '<div class="card">لا توجد أصناف في المنيو.</div>'}`;
  document.querySelectorAll('[data-rc]').forEach((b) => (b.onclick = () => { const it = m.items.find((x) => x.id === b.dataset.rc); recipeDialog(it, (it.variants || []).find((x) => x.id === b.dataset.rv) || null); }));
}

function recipeDialog(item, vr = null) {
  const ings = INV.d.ingredients, key = rkey(item, vr), price = vr ? vr.priceCents : item.priceCents;
  let rows = (INV.d.recipes[key] || []).map((r) => ({ ...r })), sim = 3, mode = item.stockMode === 'manual' ? 'manual' : 'auto';
  const draw = () => {
    const unitC = (r) => ings.find((i) => i.id === r.ingredientId)?.unitCostCents || 0;
    const c = Math.round(rows.reduce((s, r) => s + (+r.qty || 0) * unitC(r), 0));
    const dlg = dlgOpen(`<h3>مكوّنات: ${esc(item.name)}${vr ? ' · ' + esc(vr.name) : ''}</h3><p class="muted">الكميات لحبة واحدة، بالوحدة الأساسية.</p>
     ${rows.map((r, k) => `<div class="prow"><select data-ri="${k}" style="width:auto;flex:2">${ingOpts(ings, r.ingredientId)}</select><input data-rq="${k}" type="number" min="0" step="any" value="${esc(r.qty)}"><button class="sm danger" data-rx="${k}">✕</button></div>`).join('') || '<div class="muted">لا مكوّنات</div>'}
     <p>تكلفة الوصفة: <b>${money(c)}</b> — سعر البيع ${money(price)}${price ? ` — هامش الربح <b>${Math.round(((price - c) / price) * 100)}%</b>` : ''}</p>
     <div class="drow"><label>خصم المخزون</label><select id="rcMode"><option value="auto" ${mode === 'auto' ? 'selected' : ''}>تلقائي عند البيع</option><option value="manual" ${mode === 'manual' ? 'selected' : ''}>يدوي</option></select></div>
     ${rows.length ? `<div class="drow"><label>ماذا يحدث عند بيع</label><input id="rcSim" type="number" min="1" max="99" value="${sim}" style="max-width:80px"></div>
     <table class="tt"><tr><td></td><td>قبل</td><td>الخصم</td><td>بعد</td></tr>${rows.map((r) => { const ing = ings.find((i) => i.id === r.ingredientId); if (!ing) return ''; const dq = (+r.qty || 0) * sim; return `<tr><td>${esc(ing.name)}</td><td>${qtyFmt(ing.qty, ing.unit)}</td><td>−${nz(dq)}</td><td>${qtyFmt(ing.qty - dq, ing.unit)}</td></tr>`; }).join('')}</table>` : ''}
     <div id="rcErr" class="err"></div><div class="acts"><button class="sec" id="rcAdd">+ مكوّن</button><button id="rcOk">حفظ الوصفة</button><button class="sec" id="rcNo">إلغاء</button></div>`);
    const sync = () => { dlg.querySelectorAll('[data-ri]').forEach((s) => (rows[+s.dataset.ri].ingredientId = s.value)); dlg.querySelectorAll('[data-rq]').forEach((x) => (rows[+x.dataset.rq].qty = x.value)); mode = dlg.querySelector('#rcMode').value; if (dlg.querySelector('#rcSim')) sim = Math.max(1, Math.min(99, +dlg.querySelector('#rcSim').value || 1)); };
    dlg.querySelector('#rcAdd').onclick = () => { sync(); const used = new Set(rows.map((r) => r.ingredientId)), f = ings.find((i) => i.active && !used.has(i.id)); if (!f) { dlg.querySelector('#rcErr').textContent = 'لا توجد مكوّنات أخرى'; return; } rows.push({ ingredientId: f.id, qty: '' }); draw(); };
    dlg.querySelectorAll('[data-rx]').forEach((b) => (b.onclick = () => { sync(); rows.splice(+b.dataset.rx, 1); draw(); }));
    dlg.querySelectorAll('[data-ri],[data-rq]').forEach((x) => (x.onchange = () => { sync(); draw(); }));
    if (dlg.querySelector('#rcSim')) dlg.querySelector('#rcSim').onchange = () => { sync(); draw(); };
    dlg.querySelector('#rcNo').onclick = dlgClose;
    dlg.querySelector('#rcOk').onclick = async () => {
      sync();
      try {
        await api.invRecipeSave(item.id, rows.map((r) => ({ ingredientId: r.ingredientId, qty: r.qty })), vr ? vr.id : undefined);
        if (mode !== (item.stockMode === 'manual' ? 'manual' : 'auto')) await api.saveItem({ id: item.id, name: item.name, categoryId: item.categoryId, price: item.priceCents / 100, image: item.image, stationId: item.stationId, modifierGroupIds: item.modifierGroupIds, active: item.active, stockMode: mode });
        dlgClose(); viewInventory();
      } catch (e) { dlg.querySelector('#rcErr').textContent = errMsg(e); }
    };
  };
  if (!ings.length) return flash('أضف مكوّنات أولاً من تبويب «المخزون»');
  draw();
}

// ---------- الجرد ----------
function tabCount(d) {
  const L = d.ingredients.filter((i) => i.active);
  $('invBody').innerHTML = `<p class="muted">أدخل الكمية الفعلية الموجودة لكل مكوّن (اترك الخانة فارغة لتجاوزه). يُسجَّل الفرق كحركة جرد ويُصحَّح الرصيد.</p>
   <table><tr><th>المكوّن</th><th>رصيد النظام</th><th>المعدود (${'بالوحدة الأساسية'})</th><th>الفرق</th></tr>
   ${L.map((i) => `<tr><td>${esc(i.name)}</td><td>${qtyFmt(i.qty, i.unit)}</td><td><input type="number" min="0" step="any" data-c="${esc(i.id)}" placeholder="${UNIT_L[i.unit]}" style="width:140px"></td><td data-cd="${esc(i.id)}">—</td></tr>`).join('')}</table>
   ${L.length ? '<div id="cnSum" class="card muted">أدخل الكميات المعدودة لترى ملخص الفروق.</div><button id="cnOk">اعتماد الجرد</button>' : '<div class="card">لا توجد مكوّنات.</div>'}`;
  const liveDiff = () => {
    let n = 0, tot = 0, cnt = 0;
    document.querySelectorAll('[data-c]').forEach((x) => {
      const ing = L.find((i) => i.id === x.dataset.c), cell = document.querySelector(`[data-cd="${x.dataset.c}"]`);
      if (x.value === '') { cell.textContent = '—'; return; }
      cnt++; const df = +x.value - ing.qty; cell.textContent = df === 0 ? '0' : (df > 0 ? '+' : '') + nz(df);
      cell.className = df === 0 ? '' : df < 0 ? 'bad' : 'ok'; if (df !== 0) { n++; tot += df * ing.unitCostCents; }
    });
    if ($('cnSum')) $('cnSum').innerHTML = cnt ? `ملخص الجرد: فروقات في <b>${n}</b> من ${cnt} مكوّنات — قيمة الفروق <b>${money(Math.round(tot))}</b>` : 'أدخل الكميات المعدودة لترى ملخص الفروق.';
  };
  document.querySelectorAll('[data-c]').forEach((x) => (x.oninput = liveDiff));
  if ($('cnOk')) $('cnOk').onclick = async () => {
    const list = [...document.querySelectorAll('[data-c]')].filter((x) => x.value !== '').map((x) => ({ id: x.dataset.c, counted: x.value }));
    if (!list.length) return invFail(new Error('أدخل كمية واحدة على الأقل'));
    try {
      const r = await api.invCount(list);
      const dlg = dlgOpen(`<h3>نتيجة الجرد</h3><p>فُحص ${r.checked} مكوّن، والفروق: ${r.diffs.length}</p>
       ${r.diffs.length ? `<table class="tt">${r.diffs.map((x) => `<tr><td>${esc(x.name)}</td><td>${qtyFmt(x.diff, x.unit).replace(/^(?!-)/, '+')}</td><td>${money(x.valueCents)}</td></tr>`).join('')}<tr class="g"><td>قيمة الفروق</td><td></td><td>${money(r.totalCents)}</td></tr></table>` : '<p class="ok">لا فروق ✓</p>'}
       <div class="acts"><button id="cnX">إغلاق</button></div>`);
      dlg.querySelector('#cnX').onclick = () => { dlgClose(); viewInventory(); };
    } catch (e) { invFail(e); }
  };
}

// ---------- المشتريات ----------
async function tabPo(d) {
  const pos = await api.poList();
  $('invBody').innerHTML = `<div class="drow"><button id="poAdd">+ أمر شراء</button></div>
   <table><tr><th>#</th><th>المورد</th><th>الحالة</th><th>الأصناف</th><th>الإجمالي</th><th></th></tr>
   ${pos.map((p) => `<tr><td>${p.number}</td><td>${esc(p.supplier || '-')}<br><small>${esc(fmtT(p.createdAt))}</small></td><td>${PO_L[p.status]}</td>
    <td><small>${p.lines.map((l) => `${esc(l.name)} ${qtyFmt(l.receivedQty ?? l.qty, l.unit)}`).join('، ')}</small></td><td>${money(p.totalCents)}</td>
    <td>${p.status === 'draft' ? `<button class="sm sec" data-pe="${p.id}">تعديل</button> <button class="sm sec" data-pt="${p.id}">تم الطلب</button> ` : ''}${p.status === 'draft' || p.status === 'ordered' ? `<button class="sm" data-pr="${p.id}">استلام</button> <button class="sm danger" data-pc="${p.id}">إلغاء</button>` : ''}</td></tr>`).join('')}</table>
   ${pos.length ? '' : '<div class="card">لا توجد أوامر شراء.</div>'}`;
  const find = (id) => pos.find((p) => p.id === +id);
  $('poAdd').onclick = () => poDialog(null, d);
  const run = (fn) => async () => { try { await fn(); viewInventory(); } catch (e) { invFail(e); } };
  document.querySelectorAll('[data-pe]').forEach((b) => (b.onclick = () => poDialog(find(b.dataset.pe), d)));
  document.querySelectorAll('[data-pt]').forEach((b) => (b.onclick = run(() => api.poStatus(+b.dataset.pt, 'ordered'))));
  document.querySelectorAll('[data-pc]').forEach((b) => (b.onclick = run(() => api.poStatus(+b.dataset.pc, 'cancelled'))));
  document.querySelectorAll('[data-pr]').forEach((b) => (b.onclick = () => receiveDialog(find(b.dataset.pr))));
}

function poDialog(po, d) {
  const ings = d.ingredients.filter((i) => i.active);
  if (!ings.length) return flash('أضف مكوّنات أولاً');
  let rows = po ? po.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, totalPrice: nz((l.qty * l.unitCostCents) / 100) })) : [{ ingredientId: ings[0].id, qty: '', totalPrice: '' }];
  const draw = () => {
    const dlg = dlgOpen(`<h3>${po ? 'تعديل أمر شراء #' + po.number : 'أمر شراء جديد'}</h3><label>المورد</label><input id="poSup" value="${esc(po?.supplier || '')}" maxlength="80">
     ${rows.map((r, k) => `<div class="prow"><select data-pi="${k}" style="width:auto;flex:2">${ingOpts(d.ingredients, r.ingredientId)}</select><input data-pq="${k}" type="number" min="0" step="any" placeholder="الكمية" value="${esc(r.qty)}"><input data-pp="${k}" type="number" min="0" step="any" placeholder="إجمالي السعر" value="${esc(r.totalPrice)}"><button class="sm danger" data-px="${k}">✕</button></div>`).join('')}
     <small class="muted">الكمية بالوحدة الأساسية (جرام/مل/حبة) وإجمالي سعر السطر بالريال.</small>
     <label>ملاحظة</label><input id="poNote" value="${esc(po?.note || '')}" maxlength="200">
     <div id="poErr" class="err"></div><div class="acts"><button class="sec" id="poRow">+ صنف</button><button id="poOk">حفظ كمسودة</button><button class="sec" id="poNo">إلغاء</button></div>`);
    const sync = () => { dlg.querySelectorAll('[data-pi]').forEach((s) => (rows[+s.dataset.pi].ingredientId = s.value)); dlg.querySelectorAll('[data-pq]').forEach((x) => (rows[+x.dataset.pq].qty = x.value)); dlg.querySelectorAll('[data-pp]').forEach((x) => (rows[+x.dataset.pp].totalPrice = x.value)); };
    dlg.querySelector('#poRow').onclick = () => { sync(); rows.push({ ingredientId: ings[0].id, qty: '', totalPrice: '' }); draw(); };
    dlg.querySelectorAll('[data-px]').forEach((b) => (b.onclick = () => { sync(); if (rows.length > 1) rows.splice(+b.dataset.px, 1); draw(); }));
    dlg.querySelector('#poNo').onclick = dlgClose;
    dlg.querySelector('#poOk').onclick = async () => {
      sync(); const sup = dlg.querySelector('#poSup').value, note = dlg.querySelector('#poNote').value;
      try { await api.poSave({ id: po?.id, supplier: sup, note, lines: rows.map((r) => ({ ingredientId: r.ingredientId, qty: r.qty, totalPrice: r.totalPrice === '' ? 0 : r.totalPrice })) }); dlgClose(); viewInventory(); }
      catch (e) { dlg.querySelector('#poErr').textContent = errMsg(e); }
    };
  };
  draw();
}

function receiveDialog(po) {
  const dlg = dlgOpen(`<h3>استلام أمر شراء #${po.number}</h3><p class="muted">عدّل الكمية المستلمة فعلاً وسعرها إن اختلفت (كمية 0 = لم تصل). يُحدَّث رصيد المخزون وتكلفة المكوّن بالمتوسط المرجّح.</p>
   ${po.lines.map((l) => `<div class="prow"><b style="flex:2">${esc(l.name)}</b><input data-rq="${l.id}" type="number" min="0" step="any" value="${l.qty}" title="الكمية (${UNIT_L[l.unit]})"><input data-rp="${l.id}" type="number" min="0" step="any" value="${nz((l.qty * l.unitCostCents) / 100)}" title="إجمالي السعر"></div>`).join('')}
   <div id="rvErr" class="err"></div><div class="acts"><button id="rvOk">تأكيد الاستلام</button><button class="sec" id="rvNo">إلغاء</button></div>`);
  dlg.querySelector('#rvNo').onclick = dlgClose;
  dlg.querySelector('#rvOk').onclick = async () => {
    const lines = po.lines.map((l) => ({ lineId: l.id, qty: dlg.querySelector(`[data-rq="${l.id}"]`).value, totalPrice: dlg.querySelector(`[data-rp="${l.id}"]`).value }));
    try { await api.poReceive(po.id, lines); dlgClose(); viewInventory(); } catch (e) { dlg.querySelector('#rvErr').textContent = errMsg(e); }
  };
}

// ---------- الحركات ----------
async function tabMoves() {
  const rows = await api.invMoves(undefined, 150);
  $('invBody').innerHTML = `<table><tr><th>الوقت</th><th>المكوّن</th><th>التغيير</th><th>السبب</th><th>ملاحظة</th><th>المستخدم</th></tr>
   ${rows.map((r) => `<tr><td>${esc(fmtT(r.createdAt))}</td><td>${esc(r.name)}</td><td class="${r.delta < 0 ? 'err' : 'ok'}">${r.delta > 0 ? '+' : ''}${qtyFmt(r.delta, r.unit)}</td><td>${REASON_L[r.reason] || esc(r.reason)}</td><td>${esc(r.note)}</td><td>${esc(r.userName || '')}</td></tr>`).join('')}</table>
   ${rows.length ? '' : '<div class="card">لا توجد حركات.</div>'}`;
}
