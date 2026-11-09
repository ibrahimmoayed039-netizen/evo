const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const errMsg = (e) => String(e.message || e).replace(/^.*Error: /, '');
const ROLE = { owner: 'مالك', manager: 'مدير فرع', cashier: 'كاشير', accountant: 'محاسب', kitchen: 'مطبخ', waiter: 'نادل' };
let me = null;

const show = (id) => { for (const x of ['setup', 'login', 'app']) $(x).classList.toggle('hide', x !== id); };

// ---------- بدء التشغيل ----------
async function boot() {
  const s = await api.authStatus();
  if (s.needsSetup) return show('setup');
  if (s.user) { me = s.user; return enterApp(); }
  showLogin();
}

// ---------- إعداد المالك ----------
$('sBtn').onclick = async () => {
  try { await api.setup($('sName').value, $('sPin').value); $('sPin').value = ''; showLogin(); }
  catch (e) { $('sErr').textContent = errMsg(e); }
};

// ---------- تسجيل الدخول ----------
let pickId = null, pin = '';
async function showLogin() {
  show('login'); pin = ''; pickId = null;
  $('pinBox').classList.add('hide'); $('uList').classList.remove('hide'); $('lErr').textContent = '';
  const users = await api.loginUsers();
  $('uList').innerHTML = users.map((u) => `<button data-id="${esc(u.id)}">${esc(u.name)}<br><small>${ROLE[u.role]}</small></button>`).join('');
  $('uList').querySelectorAll('button').forEach((b) => (b.onclick = () => pick(b.dataset.id, b.firstChild.textContent)));
}
function pick(id, name) {
  pickId = id; pin = ''; drawDots();
  $('who').textContent = name; $('lErr').textContent = '';
  $('uList').classList.add('hide'); $('pinBox').classList.remove('hide');
}
$('pad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map((k) => `<button data-k="${k}">${k}</button>`).join('');
$('pad').querySelectorAll('button').forEach((b) => (b.onclick = () => key(b.dataset.k)));
$('back').onclick = showLogin;
function drawDots() { $('dots').textContent = '●'.repeat(pin.length); }
async function key(k) {
  if (k === '⌫') pin = pin.slice(0, -1);
  else if (k === '✓') return tryLogin();
  else if (pin.length < 8) pin += k;
  drawDots();
}
async function tryLogin() {
  try { me = await api.login(pickId, pin); pin = ''; enterApp(); }
  catch (e) { $('lErr').textContent = errMsg(e); pin = ''; drawDots(); }
}

// ---------- الإطار الرئيسي ----------
const VIEWS = [
  { id: 'dashboard', label: 'الرئيسية', perm: 'reports', render: viewDashboard },
  { id: 'pos', label: 'الكاشير', perm: 'pos', render: viewPos },
  { id: 'tables', label: 'الطاولات', perm: 'tables', render: viewTables },
  { id: 'kds', label: 'المطبخ', perm: 'kitchen.view', render: viewKds },
  { id: 'orders', label: 'الطلبات', perm: 'pos', render: viewOrders },
  { id: 'delivery', label: 'التوصيل', perm: 'delivery', render: viewDelivery },
  { id: 'reservations', label: 'الحجوزات', perm: 'reservations', render: viewReservations },
  { id: 'customers', label: 'العملاء', perm: 'customers', render: viewCustomers },
  { id: 'shift', label: 'الوردية', perm: 'shift', render: viewShift },
  { id: 'reports', label: 'التقارير', perm: 'reports', render: viewReports },
  { id: 'inventory', label: 'المخزون', perm: 'inventory', render: viewInventory },
  { id: 'print', label: 'الطباعة', perm: 'print', render: viewPrint },
  { id: 'qrmenu', label: 'QR المنيو', perm: 'qrmenu', render: viewQrMenu },
  { id: 'waiter', label: 'تطبيق النادل', perm: 'qrmenu', render: viewWaiter },
  { id: 'menu', label: 'المنيو', perm: 'menu', render: viewMenu },
  { id: 'users', label: 'المستخدمون', perm: 'users.manage', render: viewUsers },
  { id: 'audit', label: 'سجل العمليات', perm: 'audit.view', render: viewAudit },
];
const can = (p) => me.perms.includes(p);

function enterApp() {
  show('app'); resetPos();
  $('navWho').textContent = `${me.name} — ${ROLE[me.role]}`;
  const items = VIEWS.filter((v) => can(v.perm));
  $('navItems').innerHTML = items.map((v) => `<button data-v="${v.id}">${v.label}</button>`).join('');
  $('navItems').querySelectorAll('button').forEach((b) => (b.onclick = () => open(b.dataset.v)));
  if (can('inventory')) api.invLow().then((n) => { const b = $('navItems').querySelector('[data-v="inventory"]'); if (b && n) b.textContent = `المخزون (${n} ⚠)`; }).catch(() => {});
  if (can('delivery')) api.deliveryBoard({ days: 1 }).then((rows) => { const n = rows.filter((r) => r.status !== 'delivered').length, b = $('navItems').querySelector('[data-v="delivery"]'); if (b && n) b.textContent = `التوصيل (${n})`; }).catch(() => {});
  if (can('reservations')) api.resPending().then((n) => { const b = $('navItems').querySelector('[data-v="reservations"]'); if (b && n) b.textContent = `الحجوزات (${n})`; }).catch(() => {});
  if (items.length) open(items[0].id); else $('content').innerHTML = '<div class="card">لا توجد صفحات متاحة لدورك حالياً.</div>';
}
function open(id) {
  $('content').classList.remove('wide');
  $('navItems').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === id));
  VIEWS.find((v) => v.id === id).render();
}
$('logoutBtn').onclick = async () => { await api.logout(); me = null; showLogin(); };

// ---------- حوار إدخال PIN ----------
function askPin(title) {
  return new Promise((res) => {
    $('dlgTitle').textContent = title; $('dlgInput').value = '';
    $('dlg').onclose = () => res($('dlg').returnValue === 'ok' ? $('dlgInput').value : null);
    $('dlg').showModal();
  });
}

// ---------- صفحة المستخدمين ----------
async function viewUsers() {
  const users = await api.listUsers();
  const roles = Object.keys(ROLE).filter((r) => r !== 'owner' || me.role === 'owner');
  $('content').innerHTML = `
   <h2>المستخدمون</h2>
   <div class="card"><b>إضافة مستخدم</b>
    <label>الاسم</label><input id="uName">
    <label>الدور</label><select id="uRole">${roles.map((r) => `<option value="${r}">${ROLE[r]}</option>`).join('')}</select>
    <label>الرمز السري (4–8 أرقام)</label><input id="uPin" type="password" inputmode="numeric" maxlength="8">
    <div id="uErr" class="err"></div><button id="uAdd">إضافة</button></div>
   <table><tr><th>الاسم</th><th>الدور</th><th>الحالة</th><th></th></tr>
   ${users.map((u) => `<tr><td>${esc(u.name)}</td>
     <td><select data-role="${esc(u.id)}">${Object.keys(ROLE).map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select></td>
     <td>${u.active ? 'مفعّل' : 'معطّل'}</td>
     <td><button class="sm" data-pin="${esc(u.id)}">تغيير الرمز</button>
         <button class="sm ${u.active ? 'danger' : ''}" data-act="${esc(u.id)}" data-to="${!u.active}">${u.active ? 'تعطيل' : 'تفعيل'}</button></td></tr>`).join('')}
   </table><div id="tErr" class="err"></div>`;
  const run = async (fn) => { try { await fn(); viewUsers(); } catch (e) { $('tErr').textContent = errMsg(e); } };
  $('uAdd').onclick = async () => {
    try { await api.createUser({ name: $('uName').value, role: $('uRole').value, pin: $('uPin').value }); viewUsers(); }
    catch (e) { $('uErr').textContent = errMsg(e); }
  };
  document.querySelectorAll('[data-role]').forEach((s) => (s.onchange = () => run(() => api.updateUser(s.dataset.role, { role: s.value }))));
  document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => run(() => api.updateUser(b.dataset.act, { active: b.dataset.to === 'true' }))));
  document.querySelectorAll('[data-pin]').forEach((b) => (b.onclick = async () => {
    const p = await askPin('الرمز السري الجديد (4–8 أرقام)');
    if (p !== null) run(() => api.resetPin(b.dataset.pin, p));
  }));
}

// ---------- سجل العمليات ----------
async function viewAudit() {
  const rows = await api.listAudit();
  $('content').innerHTML = `<h2>سجل العمليات</h2><table><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>التفاصيل</th></tr>
   ${rows.map((r) => `<tr><td>${new Date(r.ts).toLocaleString('ar-SA')}</td><td>${esc(r.userName)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</table>`;
}

// ---------- صفحة الطباعة (اختبار) ----------
const sampleOrder = () => ({
  restaurant: 'اسم المطعم', number: 1001, date: new Date().toLocaleString('ar-SA'),
  type: 'صالة', table: '5', vatRate: 0.15, discount: 0,
  items: [{ name: 'برجر لحم', qty: 2, price: 28 }, { name: 'بطاطس', qty: 1, price: 10 }, { name: 'عصير برتقال', qty: 2, price: 12 }],
});
async function viewPrint() {
  $('content').innerHTML = `<h2>الطباعة</h2><div class="card">
   <label>عرض الورق</label><select id="width"><option value="80">80 مم</option><option value="58">58 مم</option></select>
   <label>طريقة الطباعة</label><select id="mode"><option value="system">عادية عبر النظام (أي طابعة)</option><option value="escpos">حرارية ESC/POS عبر الشبكة (IP)</option></select>
   <div id="sysBox"><label>الطابعة</label><select id="printer"></select></div>
   <div id="ipBox" class="hide"><label>عنوان IP للطابعة</label><input id="host" placeholder="192.168.1.50" dir="ltr"></div>
   <p><button id="previewBtn">معاينة الإيصال</button></p></div>`;
  const printers = await api.listPrinters();
  const sv = loadPrintOpts();
  $('printer').innerHTML = printers.map((p) => `<option ${(sv.deviceName ? p.name === sv.deviceName : p.isDefault) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  $('width').value = String(sv.width); $('mode').value = sv.mode; $('host').value = sv.host;
  $('sysBox').classList.toggle('hide', sv.mode === 'escpos'); $('ipBox').classList.toggle('hide', sv.mode !== 'escpos');
  $('mode').onchange = () => { const e = $('mode').value === 'escpos'; $('sysBox').classList.toggle('hide', e); $('ipBox').classList.toggle('hide', !e); };
  const opts = () => ({ width: +$('width').value, mode: $('mode').value, deviceName: $('printer').value, host: $('host').value.trim(), silent: false });
  $('previewBtn').onclick = async () => {
    const o = opts(); savePrintOpts(o);
    $('frame').style.width = (o.width === 58 ? 260 : 340) + 'px';
    $('frame').srcdoc = await api.receiptHTML(sampleOrder(), o);
    $('msg').textContent = ''; $('modal').classList.add('open');
    $('printBtn').onclick = async () => {
      try { $('msg').style.color = '#2563eb'; $('msg').textContent = 'جاري الطباعة...'; await api.print(sampleOrder(), o); $('msg').style.color = '#16a34a'; $('msg').textContent = 'تمت الطباعة ✓'; }
      catch (e) { $('msg').style.color = '#b91c1c'; $('msg').textContent = 'فشلت الطباعة: ' + errMsg(e); }
    };
  };
}
$('closeBtn').onclick = () => $('modal').classList.remove('open');

boot();
