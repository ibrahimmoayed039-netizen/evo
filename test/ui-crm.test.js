// اختبار دخان لصفحات العملاء/الحجوزات ونافذة الدفع (كرت/نقاط) على DOM وهمي مع واجهة خلفية حقيقية
const { ok, eq, done } = require('./harness');
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts');
const tables = require(S + 'tables'), crm = require(S + 'crm'), res = require(S + 'reservations');
db.init(); orders.init(':memory:'); shifts.init(); crm.init(); res.init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
crm.setLoyalty({ enabled: true, earnPerRiyal: 1, pointValueCents: 5 });
const cust = crm.save({ name: 'سارة <b>', phone: '0501234567' }); crm.adjustPoints(cust.id, 40, 'ترحيب');
const card = crm.giftIssue({ amount: 100, method: 'card', buyerNote: 'هدية <i>' });
const T1 = tables.save({ name: 'T1', seats: 4 });
const d = new Date(); d.setDate(d.getDate() + 1);
const D = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
res.save({ name: 'خالد <script>', phone: '0533333333', party: 3, date: D, time: '19:00', tableId: T1.id, note: 'نافذة' });

const stub = () => {
  const store = {}, cl = { add() {}, remove() {}, toggle() {} };
  return new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k in store ? store[k] : k === 'value' ? '' : k === 'classList' ? cl : k === 'style' ? {} : k === 'checked' ? false : k === 'querySelectorAll' ? () => [] : k === 'querySelector' ? () => stub() : stub()),
    set: (t, k, v) => { store[k] = v; return true; }, apply: () => stub(),
  });
};
const els = {}, dlg = { html: '' };
const dlgEl = { set innerHTML(h) { dlg.html = h; }, get innerHTML() { return dlg.html; }, querySelectorAll: () => [], querySelector: () => stub() };
const ctx = {
  document: { querySelectorAll: () => [] }, console, Promise, Date, Math, confirm: () => true,
  $: (id) => (els[id] ||= stub()),
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  errMsg: (e) => e.message, can: () => true, money: (c) => (c / 100).toFixed(2), flash() {}, dlgClose() {}, dlgOpen: (h) => { dlg.html = h; return dlgEl; },
  api: {
    custList: async (q) => crm.list(q), custGet: async (id) => crm.get(id), loyaltyGet: async () => crm.loyalty(), giftList: async () => crm.giftList(), giftGet: async (c) => crm.giftGet(c),
    resList: async (f) => res.list(f), tablesFloor: async () => tables.floor(), giftLiab: async () => crm.giftLiabilities(), giftHtml: async () => '<html></html>',
    resPrefill: async (id) => res.seatPrefill(id), custFind: async (p) => crm.findByPhone(p),
  },
};
vm.createContext(ctx);
for (const f of ['pos.js', 'crm.js', 'reservations.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', f), 'utf8'), ctx, { filename: f });
// pos.js يعرّف dlgOpen/dlgClose/flash الحقيقية؛ نعيد استبدالها بنسخ تلتقط HTML
ctx.dlgOpen = (h) => { dlg.html = h; return dlgEl; }; ctx.dlgClose = () => {}; ctx.flash = () => {};
const clean = (h, m) => ok(h.length > 50 && !/undefined|NaN|\[object/.test(h), m + ' بلا undefined/NaN');
const tab = async (t) => { vm.runInContext(`CRM.tab='${t}'`, ctx); await ctx.viewCustomers(); return els.crmBody.innerHTML; };


(async () => {
  let h = await tab('cust');
  ok(h.includes('سارة &lt;b&gt;') && !h.includes('<b>سارة'), 'هروب HTML لاسم العميل'); ok(h.includes('0501234567') && h.includes('>40<'), 'الجوال والنقاط'); clean(h, 'تبويب العملاء');
  h = await tab('gift');
  ok(h.includes(card.code) && h.includes('100.00') && h.includes('نشط') && h.includes('gIssue'), 'قائمة الكروت ونموذج الإصدار'); clean(h, 'تبويب الكروت');
  h = await tab('loy'); ok(h.includes('lySave') && h.includes('value="5"'), 'إعدادات الولاء'); clean(h, 'تبويب الولاء');
  await ctx.custDetails(cust.id); ok(dlg.html.includes('ترحيب') && dlg.html.includes('+40') && dlg.html.includes('تعديل النقاط'), 'تفاصيل العميل وحركة النقاط'); clean(dlg.html, 'تفاصيل العميل');
  await ctx.giftDetails(card.code); ok(dlg.html.includes('إصدار') && dlg.html.includes('هدية &lt;i&gt;') && dlg.html.includes('إلغاء الكرت'), 'تفاصيل الكرت'); clean(dlg.html, 'تفاصيل الكرت');
  h = await tab('gift');
  ok(h.includes('التزامات الكروت') && h.includes('100.00'), 'بطاقة التزامات الكروت في تبويب الكروت');
  await ctx.custDetails(cust.id); ok(dlg.html.includes('cdMerge') && dlg.html.includes('دمج في عميل آخر'), 'زر دمج العميل في التفاصيل');
  ok(typeof ctx.showVoucher === 'function' && typeof ctx.seatToPos === 'function', 'دوال القسيمة والإجلاس موجودة');
  // الإجلاس يفتح الكاشير بالطاولة والعميل
  const T2 = tables.save({ name: 'T2', seats: 6 }); const sr = res.save({ name: 'سارة', phone: '0501234567', party: 2, date: D, time: '21:00', tableId: T2.id }); res.setStatus(sr.id, 'seated');
  let opened = null; ctx.open = (v) => { opened = v; };
  await ctx.seatToPos(res.get(sr.id));
  ok(opened === 'pos', 'الإجلاس يفتح الكاشير'); ok(vm.runInContext('P.tableId', ctx) === T2.id && vm.runInContext('P.type', ctx) === 'dine_in', 'الطاولة معبّأة في الكاشير'); ok(vm.runInContext('P.crm && P.crm.id', ctx) === cust.id, 'العميل المسجّل معبّأ في الكاشير');
  ctx.custForm({ phone: '055' }); ok(dlg.html.includes('عميل جديد'), 'نموذج عميل جديد عند غياب المعرّف');

  vm.runInContext(`RS.date='${D}'`, ctx); await ctx.viewReservations(); h = els.content.innerHTML;
  ok(h.includes('خالد &lt;script&gt;') && !h.includes('<script>') && h.includes('T1') && h.includes('محجوز') && h.includes('وصل'), 'قائمة الحجوزات وهروب HTML'); clean(h, 'صفحة الحجوزات');
  vm.runInContext(`RS.date='2031-01-01'`, ctx); await ctx.viewReservations(); ok(els.content.innerHTML.includes('لا توجد حجوزات'), 'يوم بلا حجوزات');
  await ctx.resForm(null); ok(dlg.html.includes('حجز جديد') && dlg.html.includes('T1 (4)'), 'نموذج الحجز مع الطاولات'); clean(dlg.html, 'نموذج الحجز');

  // نافذة الدفع: كرت هدية ونقاط الولاء تظهر عند وجود عميل
  vm.runInContext(`P = freshPos(); P.crm = { id: '${cust.id}', name: 'سارة', phone: '0501234567', points: 40 }; LOY = ${JSON.stringify(crm.loyalty())};`, ctx);
  ctx.payDialog({ id: 1, number: 1001, totalCents: 1150 });
  ok(dlg.html.includes('كرت هدية') && dlg.html.includes('نقاط الولاء') && dlg.html.includes('qPts') && dlg.html.includes('2.00'), 'خيارات الدفع بالكرت والنقاط (40 نقطة = 2.00)'); clean(dlg.html, 'نافذة الدفع');
  vm.runInContext(`P.crm = null`, ctx); ctx.payDialog({ id: 1, number: 1001, totalCents: 1150 });
  ok(dlg.html.includes('كرت هدية') && !dlg.html.includes('نقاط الولاء') && !dlg.html.includes('qPts'), 'بلا عميل: كرت فقط بلا نقاط');
  done();
})().catch((e) => { console.log('✗ استثناء: ' + e.stack); process.exit(1); });
