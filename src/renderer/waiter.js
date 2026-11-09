// صفحة «تطبيق النادل»: تشغيل خادم الشبكة المحلية الذي يتصل به تطبيق الأندرويد (تعتمد على $ و esc و errMsg من renderer.js و flash من pos.js)
async function viewWaiter() {
  $('content').classList.remove('wide');
  let i; try { i = await api.waiterGet(); } catch (e) { $('content').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; return; }
  const c = i.config, s = i.status;
  $('content').innerHTML = `<h2>تطبيق النادل</h2>
   <div class="card"><b>الحالة:</b> ${s.running ? `<span class="ok">يعمل على المنفذ ${s.port}</span>` : '<span class="muted">متوقف</span>'}${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
    <div class="muted">يتيح للنادل أخذ الطلب من جواله وإرساله للمطبخ مباشرة. يجب أن يكون الجوال على نفس شبكة الواي فاي. عند أول تشغيل قد يطلب ويندوز السماح بالوصول عبر الشبكة الخاصة (اسمح بـ TCP للمنفذ وبـ UDP للبحث التلقائي).</div>
    <div class="muted">الاتصال مشفّر (HTTPS). يجد التطبيق هذا الجهاز تلقائياً على نفس الشبكة؛ وعند أول اقتران يعرض «بصمة الأمان» أدناه ليطابقها النادل أو المدير بالعين قبل التأكيد.${i.discovery.error ? `<div class="err">${esc(i.discovery.error)} — يبقى الإدخال اليدوي للعنوان يعمل.</div>` : ''}</div>
    <label class="chk"><input type="checkbox" id="wOn" ${c.enabled ? 'checked' : ''}> تفعيل تطبيق النادل</label>
    <div class="drow"><label>المنفذ</label><input id="wPort" type="number" min="1024" max="65535" value="${esc(c.port)}"></div>
    <div class="muted">أدخل أحد هذه العناوين في التطبيق:</div>
    <div dir="ltr" style="text-align:right;font-weight:bold">${i.addresses.length ? i.addresses.map(esc).join('<br>') : 'لا توجد شبكة'}</div>
    <div class="muted">بصمة الأمان (يجب أن تطابق ما يعرضه التطبيق عند أول اتصال):</div>
    <div dir="ltr" id="wFp" style="text-align:right;font-weight:bold;font-size:1.2em;letter-spacing:1px">${esc(i.tls.pretty)}</div>
    <div class="muted">الأجهزة المتصلة الآن: ${i.sessions}. أنشئ حسابات النادل من صفحة «المستخدمين» بدور «نادل» (رمز من 4 إلى 8 أرقام).</div>
    <div id="wErr" class="err"></div><button id="wSave">حفظ</button> <button class="sec" id="wRev">فصل كل الأجهزة</button> <button class="sec" id="wCert">إعادة إنشاء الشهادة</button></div>`;
  $('wSave').onclick = async () => {
    try { await api.waiterSet({ enabled: $('wOn').checked, port: +$('wPort').value }); flash('تم الحفظ'); viewWaiter(); }
    catch (e) { $('wErr').textContent = errMsg(e); }
  };
  $('wCert').onclick = async () => {
    if (!confirm('إعادة إنشاء الشهادة تغيّر بصمة الأمان وتفصل كل الأجهزة، وسيطلب كل جوال تأكيد البصمة الجديدة. استخدمها فقط إن شككت بتسرّب المفتاح. متابعة؟')) return;
    try { await api.waiterRegenCert(); flash('أُنشئت شهادة جديدة'); viewWaiter(); } catch (e) { $('wErr').textContent = errMsg(e); }
  };
  $('wRev').onclick = async () => { try { await api.waiterRevoke(); flash('فُصلت كل الأجهزة'); viewWaiter(); } catch (e) { $('wErr').textContent = errMsg(e); } };
}
