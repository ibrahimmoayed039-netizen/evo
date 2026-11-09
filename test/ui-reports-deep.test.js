// اختبار دخان لتبويبات التقارير الأعمق على DOM وهمي مع واجهة خلفية حقيقية
const { ok, eq, done } = require('./harness');
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), inv = require(S + 'inventory');
const reports = require(S + 'reports'), deepR = require(S + 'reports-deep');
db.init(); orders.init(':memory:'); shifts.init(); inv.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 }); const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'لاتيه <i>', price: 10 }); menu.saveItem({ categoryId: cat, name: 'ماء', price: 2 }); menu.saveItem({ categoryId: cat, name: 'كيك <img src=x onerror=1>', price: 8 });
const [latte, water, cake] = db.get().items.map((i) => i.id), today = reports.ymd(new Date());
const beans = inv.save({ name: 'بن', unit: 'g', qty: 1000, unitCost: 0.05 }).id, milk = inv.save({ name: 'حليب', unit: 'ml', qty: 5000, unitCost: 0.01 }).id;
inv.recipeSave(latte, [{ ingredientId: beans, qty: 18 }, { ingredientId: milk, qty: 200 }]); inv.recipeSave(water, [{ ingredientId: milk, qty: 50 }]);
shifts.open(100);
const sale = (id, q, extra = {}) => { const o = orders.save({ type: 'takeaway', lines: [{ itemId: id, qty: q }], ...extra }); orders.pay(o.id, [{ method: 'cash', amount: 100 }]); inv.onPaid(o.id); return o; };
const at = (id, h) => { const d = new Date(); d.setHours(h, 5, 0, 0); orders.raw().prepare('UPDATE orders SET paid_at=? WHERE id=?').run(d.toISOString(), id); };
at(sale(latte, 2).id, 12); at(sale(water, 5).id, 12); at(sale(cake, 3).id, 20); at(sale(latte, 1, { discount: { type: 'percent', value: 50 } }).id, 13);

const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'value' ? t.value ?? '' : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? {} : k === 'querySelector' ? () => stub() : k === 'querySelectorAll' ? () => [] : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
const els = {}, calls = [];
const ctx = {
  document: { querySelectorAll: () => [] }, console, Promise, Date, Math, Number,
  $: (id) => (els[id] ||= stub()),
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  errMsg: (e) => e.message, money: (c) => (c / 100).toFixed(2), flash() {}, PAY_L: { cash: 'نقدي', card: 'بطاقة', other: 'أخرى' },
  api: {
    reportSales: async (r) => { calls.push('sales'); return reports.sales(r); },
    reportDeep: async (r) => { calls.push('deep'); return deepR.deep(r); }, reportExport: async () => true, reportExportDeep: async () => true,
  },
};
vm.createContext(ctx);
for (const f of ['reports.js', 'reports-deep.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', f), 'utf8'), ctx, { filename: f });
const clean = (h, m) => ok(h.length > 200 && !/undefined|NaN|\[object|Infinity/.test(h), m + ' بلا undefined/NaN');
const show = async (tab, extra = '') => { vm.runInContext(`RP.tab='${tab}'; RP.from='${today}'; RP.to='${today}'; ${extra}`, ctx); await ctx.viewReports(); return els.content.innerHTML; };

(async () => {
  let h = await show('overview');
  ok(h.includes('data-tab="items"') && h.includes('data-tab="staff"') && h.includes('data-tab="peaks"'), 'أزرار التبويبات الأربعة'); ok(h.includes('إجمالي المبيعات') && h.includes('الأكثر مبيعاً'), 'النظرة العامة كما هي'); clean(h, 'النظرة العامة');
  eq(calls.join(), 'sales', 'النظرة العامة تستدعي تقرير المبيعات فقط');
  calls.length = 0; h = await show('items');
  eq(calls.join(), 'deep', 'التبويب الأعمق يستدعي القناة الجديدة فقط'); clean(h, 'ربحية الأصناف');
  ok(h.includes('لاتيه &lt;i&gt;') && !h.includes('<i>'), 'هروب HTML لاسم الصنف'); ok(h.includes('كيك &lt;img') && !h.includes('<img'), 'هروب وسم img في اسم الصنف');
  ok(h.includes('بلا وصفة') && h.includes('تغطية الوصفات'), 'الأصناف بلا وصفة والتغطية'); ok(h.includes('نجم') || h.includes('ضعيف') || h.includes('حصان') || h.includes('لغز'), 'تصنيف هندسة المنيو');
  ok(h.includes('class="tabs"') && h.includes('data-tab="items"') && /class="on" data-tab="items"/.test(h), 'تبويب الأصناف مفعّل');
  h = await show('staff'); clean(h, 'أداء الفريق'); ok(h.includes('المالك') && h.includes('مالك') && h.includes('خصومات') && h.includes('إلغاءات'), 'جدول الفريق والدور');
  h = await show('peaks'); clean(h, 'أوقات الذروة'); ok(h.includes('فترات الذروة') && h.includes('خريطة الازدحام') && h.includes('class="heat"'), 'الذروة والخريطة'); ok(h.includes('12:00') && h.includes('1 موظف'), 'ساعة الذروة وموظف واحد بطاقة 8'); ok(h.includes('أقل من 14 يوماً'), 'تنبيه الفترة القصيرة');
  const need = (cap) => vm.runInContext(`RP.cap=${cap}`, ctx);
  need(1); h = await show('peaks', 'RP.cap=1'); ok(h.includes('2 موظف'), 'طاقة 1 طلب/ساعة: ساعة الذروة (طلبان) تحتاج موظفين'); need(8);
  h = await show('peaks', "RP.from='2020-01-01'; RP.to='2020-01-01'"); ok(h.includes('لا مبيعات'), 'فترة فارغة بلا خطأ');
  h = await show('items', "RP.from='2020-01-01'; RP.to='2020-01-01'"); ok(!/undefined|NaN|Infinity/.test(h), 'أصناف: فترة فارغة بلا undefined/NaN');
  h = await show('staff', "RP.from='2020-01-01'; RP.to='2020-01-01'"); ok(!/undefined|NaN|Infinity/.test(h), 'فريق: فترة فارغة بلا undefined/NaN');
  h = await show('items', "RP.from='bad'"); ok(h.includes('تاريخ غير صالح'), 'خطأ التاريخ يظهر للمستخدم');
  done();
})();
