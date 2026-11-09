// صفحة «QR المنيو»: تشغيل الخادم المحلي، وعرض/طباعة رموز الطاولات (تعتمد على $ و esc و errMsg من renderer.js، و flash من pos.js، و loadPrintOpts من pos.js)
async function viewQrMenu() {
  $('content').classList.remove('wide');
  let i; try { i = await api.qrGet(); } catch (e) { $('content').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; return; }
  const c = i.config, s = i.status;
  $('content').innerHTML = `<h2>QR المنيو</h2>
   <div class="card"><b>الحالة:</b> ${s.running ? `<span class="ok">يعمل على المنفذ ${s.port}</span>` : '<span class="muted">متوقف</span>'}${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
    <div class="muted">يعرض المنيو للزبون على جواله (قراءة فقط، بلا طلب). يجب أن يكون الزبون على نفس شبكة الواي فاي. عند أول تشغيل قد يطلب ويندوز السماح بالوصول عبر الشبكة الخاصة.</div>
    <label class="chk"><input type="checkbox" id="qOn" ${c.enabled ? 'checked' : ''}> تفعيل منيو QR</label>
    <label class="chk"><input type="checkbox" id="qPr" ${c.showPrices ? 'checked' : ''}> إظهار الأسعار</label>
    <div class="drow"><label>المنفذ</label><input id="qPort" type="number" min="1024" max="65535" value="${esc(c.port)}"><label>العنوان (اختياري)</label><input id="qHost" dir="ltr" placeholder="${esc(i.ips[0] || 'IP الجهاز')}" value="${esc(c.host)}"></div>
    <div class="muted" dir="ltr" style="text-align:right">${i.ips.length ? esc(i.ips.join(' | ')) : 'لا توجد شبكة'}</div>
    <div id="qErr" class="err"></div><button id="qSave">حفظ</button></div>
   <div class="drow"><h3 style="margin:0">رموز الطاولات</h3><button class="sm" id="qAll">طباعة الكل</button></div>
   <div class="qgrid">${i.links.map((l, n) => `<div class="qc">${l.svg}<b>${esc(l.name)}</b><small>${esc(l.url)}</small><button class="sm sec" data-qp="${n}">معاينة وطباعة</button></div>`).join('')}</div>
   ${i.links.length < 2 ? '<div class="muted">أضف طاولات من صفحة «الطاولات» لتظهر لها رموز.</div>' : ''}`;
  $('qSave').onclick = async () => {
    try { await api.qrSet({ enabled: $('qOn').checked, showPrices: $('qPr').checked, port: +$('qPort').value, host: $('qHost').value }); flash('تم الحفظ'); viewQrMenu(); }
    catch (e) { $('qErr').textContent = errMsg(e); }
  };
  $('qAll').onclick = () => showQrSheet(null);
  document.querySelectorAll('[data-qp]').forEach((b) => (b.onclick = () => showQrSheet(i.links[+b.dataset.qp].id || null, +b.dataset.qp === 0)));
}

// معاينة وطباعة (نفس نافذة معاينة الإيصال). tableId=null مع general=false يعني الكل
async function showQrSheet(tableId, general) {
  const o = loadPrintOpts(); o.silent = false;
  $('frame').style.width = (o.width === 58 ? 260 : 340) + 'px';
  const id = general ? '__general__' : tableId;
  try { $('frame').srcdoc = await api.qrHtml(id, o); } catch (e) { return flash(errMsg(e)); }
  $('msg').textContent = ''; $('modal').classList.add('open');
  $('printBtn').onclick = async () => {
    try { $('msg').style.color = '#2563eb'; $('msg').textContent = 'جاري الطباعة...'; await api.qrPrint(id, o); $('msg').style.color = '#16a34a'; $('msg').textContent = 'تمت الطباعة ✓'; }
    catch (e) { $('msg').style.color = '#b91c1c'; $('msg').textContent = 'فشلت الطباعة: ' + errMsg(e) + ' (اضبط الطابعة من صفحة «الطباعة»)'; }
  };
}
