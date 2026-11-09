// شاشة المطبخ KDS + إدارة المحطات (تعتمد على $ و esc و errMsg و can من renderer.js، و dlgOpen/dlgClose/flash من pos.js)
let KD = { station: '', timer: null, seen: new Set(), first: true };
const KD_ACTIONS = {
  new: [['start', 'بدء'], ['ready', 'جاهز']],
  preparing: [['ready', 'جاهز'], ['back', '↩']],
  ready: [['done', 'تم التسليم'], ['back', '↩']],
  cancelled: [['ack', 'تم']],
};
function beep() {
  try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(); o.connect(c.destination); o.frequency.value = 880; o.start(); setTimeout(() => { o.stop(); c.close(); }, 250); } catch {}
}

async function viewKds() {
  $('content').classList.add('wide');
  const stations = await api.kitchenStations();
  if (KD.station && !stations.some((s) => s.id === KD.station)) KD.station = '';
  KD.seen = new Set(); KD.first = true;
  $('content').innerHTML = `<h2>المطبخ</h2>
   <div class="tabs"><button data-ks="" class="${KD.station ? '' : 'on'}">كل المحطات</button>${stations.map((s) => `<button data-ks="${esc(s.id)}" class="${KD.station === s.id ? 'on' : ''}">${esc(s.name)}</button>`).join('')}
    ${can('kitchen') ? '<button class="sec" id="kdMgr">إدارة المحطات</button>' : ''}</div>
   ${stations.length ? '' : '<div class="card">لم تُعرَّف محطات بعد. ' + (can('kitchen') ? 'اضغط «إدارة المحطات» لإضافة أول محطة، وبعدها يظهر زر «إرسال للمطبخ» في الكاشير.' : 'اطلب من المدير إضافتها.') + '</div>'}
   <div id="kdBoard" class="kds"></div><div id="kdErr" class="err"></div>`;
  document.querySelectorAll('[data-ks]').forEach((b) => (b.onclick = () => { KD.station = b.dataset.ks; viewKds(); }));
  if ($('kdMgr')) $('kdMgr').onclick = () => stationsDialog(stations);
  await refreshKds();
  clearInterval(KD.timer); KD.timer = setInterval(refreshKds, 5000);
}

async function refreshKds() {
  if (!$('kdBoard')) return clearInterval(KD.timer); // غادر المستخدم الصفحة
  let rows;
  try { rows = await api.kitchenBoard(KD.station || undefined); } catch (e) { if ($('kdErr')) $('kdErr').textContent = errMsg(e); return; }
  if (!$('kdBoard')) return;
  $('kdErr').textContent = '';
  const fresh = rows.filter((t) => t.status === 'new' && !KD.seen.has(t.id));
  if (fresh.length && !KD.first) beep();
  rows.forEach((t) => KD.seen.add(t.id)); KD.first = false;
  $('kdBoard').innerHTML = rows.map((t) => {
    const m = Math.max(0, Math.floor((Date.now() - new Date(t.createdAt)) / 60000));
    return `<div class="kt ${t.status} ${m >= 20 ? 'late' : m >= 10 ? 'warn' : ''}" data-tk="${t.id}">
     <div class="kh"><b>#${t.orderNumber}${t.batch > 1 ? ` · دفعة ${t.batch}` : ''}</b><span>${esc(t.type)}${t.tableLabel ? ' ' + esc(t.tableLabel) : ''}</span><span class="tm">${m} د</span></div>
     ${KD.station ? '' : `<div class="ks">${esc(t.stationName)}</div>`}${t.status === 'cancelled' ? '<div class="err"><b>ملغاة</b></div>' : ''}
     <ul>${t.items.map((i) => `<li><b>${i.qty}×</b> ${esc(i.name)}${i.mods.length ? `<small>+ ${esc(i.mods.join('، '))}</small>` : ''}${i.note ? `<small><b>** ${esc(i.note)}</b></small>` : ''}</li>`).join('')}</ul>
     <div class="ba">${KD_ACTIONS[t.status].map(([a, l]) => `<button class="${a === 'back' ? 'sec sm' : ''}" data-a="${a}" data-id="${t.id}">${l}</button>`).join('')}<button class="sec sm" data-rp="${t.id}" title="إعادة طباعة">🖨</button></div></div>`;
  }).join('') || '<div class="muted">لا توجد تذاكر</div>';
  document.querySelectorAll('#kdBoard [data-a]').forEach((b) => (b.onclick = async () => {
    try { await api.kitchenBump(+b.dataset.id, b.dataset.a); refreshKds(); } catch (e) { $('kdErr').textContent = errMsg(e); }
  }));
  document.querySelectorAll('#kdBoard [data-rp]').forEach((b) => (b.onclick = async () => {
    try { await api.kitchenReprint(+b.dataset.rp); flash('أُرسلت للطابعة'); } catch (e) { $('kdErr').textContent = 'فشلت الطباعة: ' + errMsg(e); }
  }));
}

// ---------- إدارة المحطات ----------
async function stationsDialog() {
  const st = await api.kitchenStations();
  const d = dlgOpen(`<h3>محطات المطبخ</h3>${st.map((s) => `<div class="orow"><b>${esc(s.name)}</b><small>${s.autoPrint ? 'طباعة تلقائية' : ''}</small>
    <button class="sm" data-se="${esc(s.id)}">تعديل</button><button class="sm danger" data-sd="${esc(s.id)}">حذف</button></div>`).join('') || '<div class="muted">لا توجد محطات</div>'}
    <p class="muted">الصنف بلا محطة يذهب لأول محطة في القائمة. حدّد محطة كل صنف من صفحة المنيو.</p>
    <div id="smErr" class="err"></div><button id="smAdd">+ محطة</button><button class="sec" id="smClose">إغلاق</button>`);
  d.querySelector('#smClose').onclick = () => { dlgClose(); viewKds(); };
  d.querySelector('#smAdd').onclick = () => stationEdit(null);
  d.querySelectorAll('[data-se]').forEach((b) => (b.onclick = () => stationEdit(st.find((s) => s.id === b.dataset.se))));
  d.querySelectorAll('[data-sd]').forEach((b) => (b.onclick = async () => {
    if (!confirm('حذف المحطة؟ الأصناف المرتبطة بها ترجع للمحطة الافتراضية.')) return;
    try { await api.kitchenStationDelete(b.dataset.sd); stationsDialog(); } catch (e) { d.querySelector('#smErr').textContent = errMsg(e); }
  }));
}

async function stationEdit(s) {
  let printers = []; try { printers = await api.listPrinters(); } catch {}
  const p = s?.printer || { mode: 'system', width: 80, deviceName: '', host: '' };
  const d = dlgOpen(`<h3>${s ? 'تعديل المحطة' : 'محطة جديدة'}</h3>
   <label>الاسم</label><input id="seName" maxlength="20" value="${esc(s?.name || '')}">
   <div class="chk"><input type="checkbox" id="seAuto" ${s?.autoPrint ? 'checked' : ''}>طباعة تذكرة المطبخ تلقائياً عند الإرسال</div>
   <label>طريقة الطباعة</label><select id="seMode"><option value="system" ${p.mode === 'system' ? 'selected' : ''}>عادية عبر النظام</option><option value="escpos" ${p.mode === 'escpos' ? 'selected' : ''}>حرارية ESC/POS عبر الشبكة</option></select>
   <div id="seSys"><label>الطابعة</label><select id="seDev"><option value="">— اختر —</option>${printers.map((x) => `<option ${x.name === p.deviceName ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
   <div id="seIp"><label>عنوان IP</label><input id="seHost" dir="ltr" placeholder="192.168.1.60" value="${esc(p.host)}"></div>
   <label>عرض الورق</label><select id="seW"><option value="80" ${p.width === 80 ? 'selected' : ''}>80 مم</option><option value="58" ${p.width === 58 ? 'selected' : ''}>58 مم</option></select>
   <div id="seErr" class="err"></div><button id="seOk">حفظ</button><button class="sec" id="seNo">إلغاء</button>`);
  const sync = () => { const e = d.querySelector('#seMode').value === 'escpos'; d.querySelector('#seSys').classList.toggle('hide', e); d.querySelector('#seIp').classList.toggle('hide', !e); };
  d.querySelector('#seMode').onchange = sync; sync();
  d.querySelector('#seNo').onclick = () => stationsDialog();
  d.querySelector('#seOk').onclick = async () => {
    try {
      await api.kitchenStationSave({ ...(s ? { id: s.id } : {}), name: d.querySelector('#seName').value, autoPrint: d.querySelector('#seAuto').checked,
        printer: { mode: d.querySelector('#seMode').value, deviceName: d.querySelector('#seDev').value, host: d.querySelector('#seHost').value, width: +d.querySelector('#seW').value } });
      stationsDialog();
    } catch (e) { d.querySelector('#seErr').textContent = errMsg(e); }
  };
}
