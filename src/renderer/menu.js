// واجهة إدارة المنيو (تعتمد على $ و esc و errMsg و me من renderer.js)
let M = null, mTab = 'items', mEdit = null, mImg = '', mCat = '', mImgCleared = false, mVars = null;
const KIND_L = { normal: 'عادي', combo: 'كومبو', weight: 'بالوزن', service: 'خدمة' };
const sar = (c) => (c / 100).toFixed(2);

async function viewMenu() { M = await api.menuGet(); mVars = null; mEdit = null; mImg = ''; mImgCleared = false; mVars = null; drawMenu(); }

function drawMenu() {
  const T = [['items', 'الأصناف'], ['cats', 'التصنيفات'], ['groups', 'الإضافات']];
  $('content').innerHTML = `<h2>المنيو</h2>
   <div class="tabs">${T.map(([k, l]) => `<button data-t="${k}" class="${k === mTab ? 'on' : ''}">${l}</button>`).join('')}</div>
   <div id="tabBody"></div><div id="mErr" class="err"></div>`;
  document.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { mTab = b.dataset.t; mEdit = null; mImg = ''; mImgCleared = false; mVars = null; drawMenu(); }));
  ({ items: drawItems, cats: drawCats, groups: drawGroups })[mTab]();
}
const mrun = async (fn, keepEdit) => {
  try { await fn(); M = await api.menuGet(); if (!keepEdit) { mEdit = null; mImg = ''; mImgCleared = false; mVars = null; } drawMenu(); }
  catch (e) { $('mErr').textContent = errMsg(e); }
};

// ---------- الأصناف ----------
function drawItems() {
  if (!M.categories.length) { $('tabBody').innerHTML = '<div class="card">أضف تصنيفاً أولاً من تبويب «التصنيفات».</div>'; return; }
  const e = mEdit || {};
  if (!mImg && e.image && !mImgCleared) mImg = e.image;
  const sel = e.modifierGroupIds || [];
  if (mVars === null) mVars = (e.variants || []).map((v) => ({ id: v.id, name: v.name, price: sar(v.priceCents), cost: sar(v.costCents || 0), sku: v.sku || '', soldOut: !!v.soldOut, isDefault: !!v.isDefault }));
  const vars = mVars;
  const list = M.items.filter((i) => !mCat || i.categoryId === mCat);
  $('tabBody').innerHTML = `
   <div class="card"><b>${e.id ? 'تعديل صنف' : 'إضافة صنف'}</b>
    <label>الاسم</label><input id="iName" value="${esc(e.name)}">
    ${(M.stations || []).length ? `<label>محطة المطبخ</label><select id="iSt"><option value="">الافتراضية (أول محطة)</option>${M.stations.map((x) => `<option value="${esc(x.id)}" ${x.id === e.stationId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
    <label>التصنيف</label><select id="iCat">${M.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === (e.categoryId || mCat) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <label>نوع الصنف</label><select id="iKind">${Object.entries(KIND_L).map(([k, l]) => `<option value="${k}" ${k === (e.kind || 'normal') ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>الباركود (اختياري)</label><input id="iBar" value="${esc(e.barcode)}">
    <label>السعر (ر.س) <small class="muted-l">${vars.length ? 'يُؤخذ من النوع الافتراضي' : 'سعر واحد'}</small></label><input id="iPrice" type="number" step="0.01" min="0" ${vars.length ? 'readonly' : ''} value="${vars.length ? esc((vars.find((v) => v.isDefault) || vars[0]).price) : (e.priceCents != null ? sar(e.priceCents) : '')}">
    <div class="vbox"><b>الأحجام والأنواع</b> <small class="muted-l">اتركها فارغة لسعر واحد. النوع الافتراضي يظهر أولاً في الكاشير.</small>
     ${vars.length ? `<table class="vt"><tr><th>النوع / الحجم</th><th>السعر</th><th>التكلفة</th><th>الرمز</th><th>افتراضي</th><th>نفد</th><th></th></tr>
     ${vars.map((v, n) => `<tr><td><input data-vf="name" data-n="${n}" value="${esc(v.name)}"></td><td><input data-vf="price" data-n="${n}" type="number" step="0.01" min="0" value="${esc(v.price)}"></td>
      <td><input data-vf="cost" data-n="${n}" type="number" step="0.01" min="0" value="${esc(v.cost)}"></td><td><input data-vf="sku" data-n="${n}" value="${esc(v.sku)}"></td>
      <td><input type="radio" name="vDef" data-vd="${n}" ${v.isDefault ? 'checked' : ''}></td><td><input type="checkbox" data-vs="${n}" ${v.soldOut ? 'checked' : ''}></td>
      <td><button class="sm danger" data-vx="${n}">✕</button></td></tr>`).join('')}</table>` : ''}
     <button class="sm sec" id="vAdd">+ إضافة نوع</button></div>
    <label>خصم المخزون</label><select id="iStock"><option value="auto" ${(e.stockMode || 'auto') === 'auto' ? 'selected' : ''}>تلقائي عند البيع</option><option value="manual" ${e.stockMode === 'manual' ? 'selected' : ''}>يدوي (لا خصم تلقائي)</option></select>
    ${M.modGroups.length ? '<label>الإضافات المتاحة</label>' + M.modGroups.map((g) => `<div class="chk"><input type="checkbox" data-g="${esc(g.id)}" ${sel.includes(g.id) ? 'checked' : ''}>${esc(g.name)}</div>`).join('') : ''}
    <label>الصورة (اختياري)</label><input id="iImg" type="file" accept="image/*">
    ${mImg ? `<img class="thumb" src="${esc(mImg)}"> <button class="sm danger" id="iRmImg">إزالة الصورة</button>` : ''}
    <div class="chk"><input type="checkbox" id="iActive" ${e.active === false ? '' : 'checked'}>ظاهر في المنيو</div>
    <button id="iSave">حفظ</button>${e.id ? '<button class="sec" id="iCancel">إلغاء</button>' : ''}</div>
   <label>عرض تصنيف</label><select id="fCat"><option value="">الكل</option>${M.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === mCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
   <table><tr><th></th><th>الصنف</th><th>التصنيف</th><th>السعر</th><th>الحالة</th><th></th></tr>
   ${list.map((i) => `<tr><td>${i.image ? `<img class="thumb" src="${esc(i.image)}">` : ''}</td><td>${esc(i.name)}</td>
    <td>${esc(M.categories.find((c) => c.id === i.categoryId)?.name)}</td><td>${(i.variants || []).length > 1 ? sar(Math.min(...i.variants.map((v) => v.priceCents))) + ' – ' + sar(Math.max(...i.variants.map((v) => v.priceCents))) : sar(i.priceCents)}${(i.variants || []).length ? ` <small class="muted-l">${i.variants.length} أنواع</small>` : ''}</td>
    <td>${i.active ? '' : 'مخفي '}${i.soldOut ? '<span class="so">نفد</span>' : ''}</td>
    <td><button class="sm" data-ed="${esc(i.id)}">تعديل</button>
        <button class="sm sec" data-so="${esc(i.id)}">${i.soldOut ? 'متوفر' : 'نفد'}</button>
        <button class="sm danger" data-del="${esc(i.id)}">حذف</button></td></tr>`).join('')}</table>`;
  $('fCat').onchange = () => { mCat = $('fCat').value; drawMenu(); };
  $('iImg').onchange = () => { mImgCleared = false; pickImage($('iImg').files[0]); };
  if ($('iRmImg')) $('iRmImg').onclick = (ev) => { ev.preventDefault(); mImg = ''; mImgCleared = true; drawMenu(); };
  const readVars = () => { document.querySelectorAll('[data-vf]').forEach((i) => { vars[+i.dataset.n][i.dataset.vf] = i.value; }); document.querySelectorAll('[data-vd]').forEach((r) => { vars[+r.dataset.vd].isDefault = r.checked; }); document.querySelectorAll('[data-vs]').forEach((c) => { vars[+c.dataset.vs].soldOut = c.checked; }); };
  $('vAdd').onclick = (ev) => { ev.preventDefault(); readVars(); vars.push({ name: '', price: '', cost: '', sku: '', soldOut: false, isDefault: !vars.length }); drawMenu(); };
  document.querySelectorAll('[data-vx]').forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); readVars(); vars.splice(+b.dataset.vx, 1); if (vars.length && !vars.some((v) => v.isDefault)) vars[0].isDefault = true; drawMenu(); }));
  $('iSave').onclick = () => { readVars(); return mrun(() => api.saveItem({
    kind: $('iKind').value, barcode: $('iBar').value, stockMode: $('iStock').value,
    variants: vars.map((v) => ({ id: v.id, name: v.name, price: v.price, cost: v.cost || 0, sku: v.sku, soldOut: v.soldOut, isDefault: v.isDefault })),
    id: e.id, name: $('iName').value, categoryId: $('iCat').value, price: vars.length ? (vars.find((v) => v.isDefault) || vars[0]).price : $('iPrice').value, image: mImg, stationId: $('iSt') ? $('iSt').value : (e.stationId || ''),
    modifierGroupIds: [...document.querySelectorAll('[data-g]:checked')].map((c) => c.dataset.g), active: $('iActive').checked,
  })); };
  if ($('iCancel')) $('iCancel').onclick = () => { mEdit = null; mImg = ''; mImgCleared = false; mVars = null; drawMenu(); };
  document.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => { mEdit = M.items.find((i) => i.id === b.dataset.ed); mImg = ''; mImgCleared = false; mVars = null; drawMenu(); scrollTo(0, 0); }));
  document.querySelectorAll('[data-so]').forEach((b) => (b.onclick = () => { const it = M.items.find((i) => i.id === b.dataset.so); mrun(() => api.setSoldOut(it.id, !it.soldOut), true); }));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => confirm('حذف الصنف؟') && mrun(() => api.deleteItem(b.dataset.del))));
}

// تصغير الصورة قبل الحفظ (حد أقصى 240px)
function pickImage(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 240 / Math.max(im.width, im.height));
      const c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k;
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      mImg = c.toDataURL('image/jpeg', 0.8);
      const old = document.querySelector('#tabBody .card .thumb');
      if (old) old.src = mImg; else $('iImg').insertAdjacentHTML('afterend', `<img class="thumb" src="${esc(mImg)}">`);
    };
    im.src = r.result;
  };
  r.readAsDataURL(file);
}

// ---------- التصنيفات ----------
function drawCats() {
  const e = mEdit || {};
  const st = (id) => (M.stations || []).find((x) => x.id === id)?.name || '—';
  $('tabBody').innerHTML = `
   <div class="cols"><div>
   <table id="catT"><tr><th></th><th>التصنيف</th><th>الأصناف</th><th>المحطة</th><th>الحالة</th><th></th></tr>
   ${M.categories.map((c) => `<tr draggable="true" data-id="${esc(c.id)}"><td class="grip" title="اسحب لإعادة الترتيب">≡</td>
    <td>${c.color ? `<i class="cdot" style="background:${esc(c.color)}"></i>` : ''}${esc(c.name)}</td><td>${M.items.filter((i) => i.categoryId === c.id).length}</td>
    <td>${esc(st(c.stationId))}</td><td>${c.active === false ? '<span class="badge">مخفي</span>' : '<span class="badge paid">ظاهر</span>'}</td>
    <td><button class="sm" data-ed="${esc(c.id)}">تعديل</button></td></tr>`).join('')}</table>
   <div class="muted-l">اسحب ≡ لإعادة ترتيب التصنيفات كما تظهر في الكاشير.</div></div>
   <div class="card"><b>${e.id ? 'تعديل: ' + esc(e.name) : 'تصنيف جديد'}</b>
    <label>الاسم</label><input id="cName" value="${esc(e.name)}">
    <label>محطة المطبخ</label><select id="cSt"><option value="">— (حسب الصنف)</option>${(M.stations || []).map((x) => `<option value="${esc(x.id)}" ${x.id === e.stationId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <label>اللون في الكاشير</label><input id="cColor" type="color" value="${esc(e.color || '#0F766E')}" style="padding:2px;height:42px"> <label class="chk"><input type="checkbox" id="cNoColor" ${e.color ? '' : 'checked'}>بدون لون</label>
    <div class="chk"><input type="checkbox" id="cActive" ${e.active === false ? '' : 'checked'}>ظاهر في الكاشير</div>
    <div class="muted-l">لا يمكن حذف تصنيف يحتوي أصنافاً.</div>
    <button id="cSave">حفظ</button>${e.id ? '<button class="danger" id="cDel">حذف</button><button class="sec" id="cCancel">إلغاء</button>' : ''}</div></div>`;
  $('cSave').onclick = () => mrun(() => api.saveCategory({ id: e.id, name: $('cName').value, stationId: $('cSt').value, color: $('cNoColor').checked ? '' : $('cColor').value, active: $('cActive').checked }));
  if ($('cCancel')) $('cCancel').onclick = () => { mEdit = null; drawMenu(); };
  if ($('cDel')) $('cDel').onclick = () => confirm('حذف التصنيف؟') && mrun(() => api.deleteCategory(e.id));
  document.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => { mEdit = M.categories.find((c) => c.id === b.dataset.ed); drawMenu(); }));
  // سحب وإفلات لإعادة الترتيب
  let drag = null;
  document.querySelectorAll('#catT tr[data-id]').forEach((tr) => {
    tr.ondragstart = (ev) => { drag = tr.dataset.id; if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', drag); } };
    tr.ondragover = (ev) => ev.preventDefault();
    tr.ondrop = (ev) => {
      ev.preventDefault(); if (!drag || drag === tr.dataset.id) return;
      const ids = M.categories.map((c) => c.id).filter((i) => i !== drag); ids.splice(ids.indexOf(tr.dataset.id), 0, drag);
      drag = null; mrun(() => api.reorderCategories(ids), true);
    };
  });
}

// ---------- الإضافات (Modifiers) ----------
function drawGroups() {
  const e = mEdit || {};
  const txt = (e.options || []).map((o) => `${o.name} | ${sar(o.priceCents)}`).join('\n');
  $('tabBody').innerHTML = `
   <div class="card"><b>${e.id ? 'تعديل مجموعة' : 'إضافة مجموعة إضافات'}</b>
    <label>اسم المجموعة (مثال: الإضافات، الحجم)</label><input id="gName" value="${esc(e.name)}">
    <label>الخيارات — سطر لكل خيار بالشكل: الاسم | السعر الإضافي</label>
    <textarea id="gOpts" rows="5" style="width:100%;font:inherit;padding:8px" placeholder="جبن إضافي | 3&#10;بدون بصل | 0">${esc(txt)}</textarea>
    <div class="chk"><input type="checkbox" id="gReq" ${e.required ? 'checked' : ''}>اختيار إجباري</div>
    <div class="chk"><input type="checkbox" id="gMulti" ${e.multi ? 'checked' : ''}>يسمح بأكثر من خيار</div>
    <button id="gSave">حفظ</button>${e.id ? '<button class="sec" id="gCancel">إلغاء</button>' : ''}</div>
   <table><tr><th>المجموعة</th><th>الخيارات</th><th></th></tr>
   ${M.modGroups.map((g) => `<tr><td>${esc(g.name)}${g.required ? ' (إجباري)' : ''}</td>
    <td>${g.options.map((o) => `${esc(o.name)}${o.priceCents ? ' +' + sar(o.priceCents) : ''}`).join('، ')}</td>
    <td><button class="sm" data-ed="${esc(g.id)}">تعديل</button> <button class="sm danger" data-del="${esc(g.id)}">حذف</button></td></tr>`).join('')}</table>`;
  $('gSave').onclick = () => mrun(() => api.saveGroup({
    id: e.id, name: $('gName').value, required: $('gReq').checked, multi: $('gMulti').checked,
    options: $('gOpts').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [n, p] = l.split('|'); return { name: n, price: (p ?? '0').trim() || 0 }; }),
  }));
  if ($('gCancel')) $('gCancel').onclick = () => { mEdit = null; drawMenu(); };
  document.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => { mEdit = M.modGroups.find((g) => g.id === b.dataset.ed); drawMenu(); }));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => confirm('حذف المجموعة؟') && mrun(() => api.deleteGroup(b.dataset.del))));
}
