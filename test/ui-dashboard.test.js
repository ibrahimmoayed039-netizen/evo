// اختبار دخان للوحة الرئيسية على DOM وهمي مع واجهة خلفية حقيقية
const { ok, eq, done } = require('./harness');
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), reports = require(S + 'reports');
db.init(); orders.init(':memory:'); shifts.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 }); const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'قهوة <b>', price: 10 }); menu.saveItem({ categoryId: cat, name: 'ماء', price: 1 }); menu.saveItem({ categoryId: cat, name: 'كيك', price: 50 });
const [coffee, water, cake] = db.get().items.map((i) => i.id), ymd = reports.ymd;
shifts.open(100);
const sale = (id, q) => { const o = orders.save({ type: 'takeaway', lines: [{ itemId: id, qty: q }] }); orders.pay(o.id, [{ method: 'cash', amount: 500 }]); return o; };
const at = (id, dayOff, h) => { const d = new Date(); d.setDate(d.getDate() + dayOff); d.setHours(h, 5, 0, 0); orders.raw().prepare('UPDATE orders SET paid_at=? WHERE id=?').run(d.toISOString(), id); };

const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'value' ? t.value ?? '' : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? {} : k === 'querySelector' ? () => stub() : k === 'querySelectorAll' ? () => [] : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
const els = {}, calls = [];
const ctx = {
  document: { querySelectorAll: () => [] }, console, Promise, Date, Math, Number,
  $: (id) => (els[id] ||= stub()),
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  errMsg: (e) => e.message, money: (c) => (c / 100).toFixed(2),
  api: { reportSales: async (r) => { calls.push(r.from + '|' + r.to); return reports.sales(r); } },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/dashboard.js'), 'utf8'), ctx, { filename: 'dashboard.js' });
const money = ctx.money;
const clean = (h, m) => ok(h.length > 200 && !/undefined|NaN|\[object|Infinity/.test(h), m + ' بلا undefined/NaN');

(async () => {
  // يوم فارغ: لا انهيار ولا NaN
  await ctx.viewDashboard(); let h = els.content.innerHTML;
  ok(h.includes('مبيعات اليوم') && h.includes('عدد الطلبات') && h.includes('متوسط الفاتورة'), 'بطاقات المؤشرات الثلاث'); clean(h, 'اللوحة الفارغة');
  ok(h.includes('لا توجد مبيعات') && h.includes('لا توجد طلبات'), 'حالة فارغة للأصناف والذروة');
  ok(h.includes('عن أمس: —'), 'لا مقارنة بلا مبيعات أمس');
  // أمس: 1 طلب (قهوة×1 = 11.50 بالضريبة) | اليوم: عدة طلبات
  at(sale(coffee, 1).id, -1, 12);
  at(sale(coffee, 3).id, 0, 13); at(sale(water, 10).id, 0, 13); at(sale(cake, 1).id, 0, 20);
  const o4 = sale(water, 1); at(o4.id, 0, 14);
  await ctx.viewDashboard(); h = els.content.innerHTML; clean(h, 'اللوحة بمبيعات');
  const t = reports.sales({ from: ymd(new Date()), to: ymd(new Date()) });
  ok(h.includes(money(t.netCents)), 'مبيعات اليوم (الصافي) ' + money(t.netCents));
  eq(t.validCount, 4, 'أربعة طلبات صالحة اليوم'); ok(h.includes('<b>4</b>'), 'عدد الطلبات 4 في اللوحة');
  ok(h.includes('▲') && h.includes('عن أمس'), 'مقارنة بأمس (ارتفاع)');
  ok(h.includes('قهوة &lt;b&gt;') && !h.includes('قهوة <b>'), 'هروب HTML في اسم الصنف');
  // الترتيب حسب الكمية: ماء (11) ثم قهوة (3) ثم كيك (1) حتى لو الكيك أعلى مبلغاً من الماء
  ok(h.indexOf('ماء') < h.indexOf('قهوة') && h.indexOf('قهوة') < h.indexOf('كيك'), 'ترتيب الأصناف حسب الكمية');
  ok(h.includes('13:00 – 14:00') && h.includes('ذروة الطلبات'), 'ساعة الذروة 13:00 (طلبان)');
  ok(h.includes('dbh-c pk'), 'تمييز عمود الذروة');
  // مرتجع: يظهر في الصافي ولا يُحتسب في عدد الطلبات الصالحة
  orders.voidOrder(o4.id, 'اختبار'); await ctx.viewDashboard(); h = els.content.innerHTML; clean(h, 'بعد مرتجع');
  ok(h.includes('مرتجعات:') && h.includes('<b>3</b>'), 'المرتجعات تظهر وعدد الطلبات 3');
  // تبديل الفترة: استدعاء إضافي بفترة 7 أيام
  calls.length = 0; vm.runInContext("DBS.range='week'", ctx); await ctx.viewDashboard(); h = els.content.innerHTML;
  ok(calls.length === 3 && calls[2].endsWith('|' + ymd(new Date())) && calls[2].split('|')[0] !== calls[2].split('|')[1], 'فترة 7 أيام تستدعي نطاقاً ثالثاً'); ok(h.includes('آخر 7 أيام'), 'عنوان الفترة'); clean(h, 'فترة أسبوع');
  // فشل الواجهة الخلفية: رسالة بدل الانهيار
  ctx.api.reportSales = async () => { throw new Error('خطأ تجريبي'); };
  await ctx.viewDashboard(); ok(els.content.innerHTML.includes('خطأ تجريبي'), 'عرض الخطأ بدل الانهيار');
  done();
})().catch((e) => { console.log('✗ استثناء:', e); process.exit(1); });
