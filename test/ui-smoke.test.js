// اختبار دخان للواجهة: يشغّل shift.js و reports.js على DOM وهمي مع واجهة خلفية حقيقية، ويتأكد أن HTML يُبنى بأرقام صحيحة.
const { ok, eq, done } = require('./harness');
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), reports = require(S + 'reports');
db.init(); orders.init(':memory:'); shifts.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'قهوة', price: 10 });
const item = db.get().items[0].id, today = reports.ymd(new Date());

const els = {};
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'value' ? '' : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? {} : k === 'querySelector' ? () => stub() : k === 'querySelectorAll' ? () => [] : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
const doc = { querySelectorAll: () => [], createElement: stub, body: { appendChild() {} } };
const content = { innerHTML: '', classList: { add() {}, remove() {} } };
const dlg = { html: '', els: {} };
const ctx = {
  document: doc, console, setTimeout, Date, Promise,
  $: (id) => (id === 'content' ? content : (els[id] ||= stub())),
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  errMsg: (e) => e.message, can: () => true, money: (c) => (c / 100).toFixed(2), flash() {}, loadPrintOpts: () => ({ width: 80 }),
  dlgOpen: (h) => { dlg.html = h; return { querySelector: () => stub() }; }, dlgClose() {},
  api: {
    shiftCurrent: async () => ({ shift: shifts.current(), requireShift: shifts.requireShift() }), shiftList: async () => shifts.list(),
    reportSales: async (r) => reports.sales(r), shiftGet: async (id) => shifts.summary(id),
  },
};
vm.createContext(ctx);
for (const f of ['shift.js', 'reports.js', 'reports-deep.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', f), 'utf8'), ctx, { filename: f });

(async () => {
  // لا وردية
  await ctx.viewShift();
  ok(content.innerHTML.includes('لا توجد وردية مفتوحة') && content.innerHTML.includes('فتح الوردية'), 'صفحة بلا وردية');
  // وردية بمبيعات
  shifts.open(100);
  const o = orders.save({ type: 'takeaway', lines: [{ itemId: item, qty: 2 }] }); orders.pay(o.id, [{ method: 'cash', amount: 30 }]);
  shifts.addMove('out', 5, 'مشتريات <b>');
  await ctx.viewShift();
  let h = content.innerHTML;
  ok(h.includes('23.00') && h.includes('118.00'), 'مبيعات 23.00 والمتوقع 118.00 (100+23−5)');
  ok(h.includes('مشتريات &lt;b&gt;') && !h.includes('<b>مشتريات'), 'هروب HTML في سبب المصروف');
  ok(!/undefined|NaN|null/.test(h), 'لا undefined/NaN في صفحة الوردية');
  const z = shifts.close(118, '');
  ctx.shiftDialog(z); ok(dlg.html.includes('تقرير إغلاق الوردية') && dlg.html.includes('المعدود فعلياً'), 'حوار Z');
  await ctx.viewShift(); h = content.innerHTML; ok(h.includes('الورديات السابقة') && h.includes('data-sh="1"'), 'سجل الورديات');
  ok(!/undefined|NaN/.test(h), 'لا undefined/NaN في السجل');
  // التقارير
  vm.runInContext(`RP = { from: '${today}', to: '${today}' }`, ctx);
  await ctx.viewReports(); h = content.innerHTML;
  ok(h.includes('23.00') && h.includes('قهوة') && h.includes('مشروبات'), 'التقرير يعرض المبيعات والصنف والتصنيف');
  ok(!/undefined|NaN/.test(h), 'لا undefined/NaN في التقارير');
  vm.runInContext(`RP = { from: '2026-02-31', to: '${today}' }`, ctx); await ctx.viewReports();
  ok(content.innerHTML.includes('تاريخ غير صالح'), 'عرض خطأ التاريخ بدل الانهيار');
  done();
})().catch((e) => { console.log('✗ استثناء:', e); process.exit(1); });
