const { ok, eq, throws, done } = require('./harness');
const src = '../src/main/';
const db = require(src + 'db'), auth = require(src + 'auth'), menu = require(src + 'menu'), orders = require(src + 'orders');
const shifts = require(src + 'shifts'), reports = require(src + 'reports'), { can } = require(src + 'permissions'), { buildShiftHTML } = require(src + 'receipt');

db.init(); orders.init(':memory:'); shifts.init();
auth.setupOwner('المالك', '1234');
const owner = db.get().users[0];
auth.login(owner.id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 });
const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'قهوة', price: 10 });
const item = db.get().items[0].id;

const mk = (qty = 1, type = 'takeaway') => orders.save({ type, lines: [{ itemId: item, qty }] });
const today = reports.ymd(new Date());

// طلب مدفوع قبل أي وردية: لا يدخل أي وردية
const pre = mk(); orders.pay(pre.id, [{ method: 'cash', amount: 11.5 }]);
eq(orders.get(pre.id).status, 'paid', 'دفع بلا وردية مسموح افتراضياً');

// فتح الوردية
eq(shifts.current(), null, 'لا وردية مفتوحة');
const s0 = shifts.open(100);
eq(s0.openingCents, 10000, 'رصيد الافتتاح'); eq(s0.sales.count, 0, 'لا مبيعات بعد');
throws(() => shifts.open(0), /مفتوحة بالفعل/, 'وردية ثانية مرفوضة');
throws(() => shifts.addMove('out', 0, 'x'), /أكبر من صفر/, 'مبلغ صفر');
throws(() => shifts.addMove('out', 5, ''), /السبب/, 'سبب مطلوب');
throws(() => shifts.addMove('out', -1, 'x'), /غير صالح/, 'مبلغ سالب');

// A: نقدي 50 لطلب 23 (باقي 27) — B: بطاقة — C: نقدي ثم إلغاء بعد الدفع — D: مفتوح
const A = mk(2, 'dine_in' === 'x' ? 'dine_in' : 'takeaway'); orders.pay(A.id, [{ method: 'cash', amount: 50 }]);
eq(orders.get(A.id).totalCents, 2300, 'إجمالي A'); eq(orders.get(A.id).changeCents, 2700, 'باقي A');
const B = mk(); orders.pay(B.id, [{ method: 'card', amount: 11.5 }]);
const C = mk(); orders.pay(C.id, [{ method: 'cash', amount: 11.5 }]); orders.voidOrder(C.id, 'خطأ في الطلب');
const D = mk();
shifts.addMove('out', 5, 'مشتريات'); shifts.addMove('in', 2, 'تغذية الصندوق');

let s = shifts.current();
eq(s.sales.count, 3, 'مبيعات الوردية (A,B,C)'); eq(s.sales.totalCents, 4600, 'إجمالي المبيعات');
eq(s.sales.vatCents, 600, 'الضريبة'); eq(s.refunds.count, 1, 'مرتجع واحد'); eq(s.refunds.totalCents, 1150, 'مبلغ المرتجع');
eq(s.netCents, 3450, 'الصافي');
eq(s.payments.cash.inCents, 3450, 'نقدي مقبوض بعد خصم الباقي'); eq(s.payments.cash.refundCents, 1150, 'نقدي مرتجع'); eq(s.payments.cash.netCents, 2300, 'صافي النقدي');
eq(s.payments.card.netCents, 1150, 'صافي البطاقة');
eq(s.payments.cash.netCents + s.payments.card.netCents + s.payments.other.netCents, s.netCents, 'مجموع طرق الدفع = الصافي');
eq(s.expectedCents, 12000, 'المتوقع = 100 + 34.5 − 11.5 + 2 − 5'); eq(s.openOrders, 1, 'طلب مفتوح واحد');
eq(s.moves.length, 2, 'حركتا صندوق');

// الإغلاق
throws(() => shifts.close('', ''), /غير صالح/, 'المعدود مطلوب');
const z = shifts.close(118, 'عجز بسيط');
eq(z.expectedCents, 12000, 'المتوقع عند الإغلاق'); eq(z.countedCents, 11800, 'المعدود'); eq(z.diffCents, -200, 'العجز');
ok(z.closedAt && z.closedBy === 'المالك', 'بيانات الإغلاق'); eq(shifts.current(), null, 'لا وردية بعد الإغلاق');
throws(() => shifts.close(0), /لا توجد وردية/, 'إغلاق بلا وردية');
throws(() => shifts.addMove('in', 1, 'x'), /لا توجد وردية/, 'حركة بلا وردية');

// لقطة الإغلاق ثابتة حتى لو تغيّرت الطلبات بعدها
orders.voidOrder(B.id, 'إرجاع لاحق');
const again = shifts.summary(z.id);
eq(again.sales.totalCents, 4600, 'اللقطة ثابتة'); eq(again.refunds.count, 1, 'المرتجع اللاحق لا يغيّر الوردية المغلقة');
eq(shifts.list().length, 1, 'قائمة الورديات'); eq(shifts.list()[0].diffCents, -200, 'الفرق في القائمة');

// المرتجع اللاحق يُحسب في الوردية التي حدث فيها الإلغاء
const s2 = shifts.open(50);
eq(s2.refunds.count, 0, 'الإلغاء قبل الفتح لا يدخل');
const E = mk(); orders.pay(E.id, [{ method: 'cash', amount: 11.5 }]);
orders.voidOrder(E.id, 'مرتجع'); orders.voidOrder(D.id, '');
const s2b = shifts.current();
eq(s2b.sales.count, 1, 'مبيعات الوردية الثانية'); eq(s2b.refunds.count, 1, 'مرتجعها'); eq(s2b.expectedCents, 5000, 'المتوقع = الافتتاح (بيع ثم مرتجع بنفس المبلغ)');
shifts.close(50, '');

// اشتراط الوردية
shifts.setRequireShift(true);
const F = mk();
throws(() => orders.pay(F.id, [{ method: 'cash', amount: 20 }]), /افتح وردية/, 'الدفع بلا وردية عند الاشتراط');
shifts.open(0); orders.pay(F.id, [{ method: 'cash', amount: 20 }]); eq(orders.get(F.id).status, 'paid', 'الدفع داخل وردية');
shifts.close(11.5, ''); shifts.setRequireShift(false);

// تقرير المبيعات لليوم
const r = reports.sales({ from: today, to: today });
// مدفوعة: pre, A, B(أُلغي), C(أُلغي), E(أُلغي), F  → 6 ؛ مرتجعات: C,B,E → 3
eq(r.sales.count, 6, 'عدد المدفوع'); eq(r.refunds.count, 3, 'عدد المرتجعات');
eq(r.netCents, r.sales.totalCents - r.refunds.totalCents, 'الصافي = المبيعات − المرتجعات');
eq(r.validCount, 3, 'الطلبات السارية (pre, A, F)'); eq(r.avgCents, Math.round((1150 + 2300 + 1150) / 3), 'المتوسط');
eq(r.cancelledUnpaid, 1, 'ملغى غير مدفوع (D)');
eq(r.topItems[0].name, 'قهوة', 'الأكثر مبيعاً'); eq(r.topItems[0].qty, 4, 'كمية القهوة في السارية'); eq(r.byCategory[0].name, 'مشروبات', 'التصنيف');
eq(r.byType[0].type, 'takeaway', 'حسب النوع'); eq(r.daily.length, 1, 'يوم واحد'); eq(r.byUser[0].name, 'المالك', 'حسب المستخدم');
const pm = r.payments; eq(pm.cash.netCents + pm.card.netCents + pm.other.netCents, r.netCents, 'طرق الدفع = الصافي');
throws(() => reports.sales({ from: '2026-02-31', to: today }), /تاريخ غير صالح/, 'تاريخ غير موجود');
throws(() => reports.sales({ from: today, to: '2020-01-01' }), /قبل/, 'نهاية قبل البداية');
throws(() => reports.sales({ from: '2020-01-01', to: today }), /سنة/, 'فترة طويلة');
throws(() => reports.sales({}), /تاريخ غير صالح/, 'بلا تواريخ');
eq(reports.sales({ from: '2020-01-01', to: '2020-01-02' }).sales.count, 0, 'فترة فارغة');

// CSV
const csv = reports.toCsv(r);
ok(csv.startsWith('\uFEFF') && csv.includes('قهوة') && csv.includes('إجمالي المبيعات'), 'CSV أساسي');
menu.saveItem({ categoryId: cat, name: '=HYPERLINK("x")', price: 1 });
const evil = db.get().items.find((i) => i.name.startsWith('='));
const G = orders.save({ type: 'takeaway', lines: [{ itemId: evil.id, qty: 1 }] }); orders.pay(G.id, [{ method: 'cash', amount: 5 }]);
const csv2 = reports.toCsv(reports.sales({ from: today, to: today }));
ok(csv2.includes("\"'=HYPERLINK(\"\"x\"\")\"") || csv2.includes("'=HYPERLINK"), 'حماية صيغ Excel في CSV');

// الصلاحيات
ok(can('cashier', 'shift') && !can('cashier', 'reports'), 'الكاشير: وردية بلا تقارير');
ok(can('manager', 'shift') && can('manager', 'reports'), 'المدير'); ok(can('accountant', 'reports') && !can('accountant', 'shift'), 'المحاسب: تقارير فقط');
ok(!can('kitchen', 'shift') && !can('kitchen', 'reports'), 'المطبخ');

// قالب الطباعة
const h = buildShiftHTML(z, { width: 58 }), hb = buildShiftHTML(z, { width: 80, showExpected: false });
ok(h.includes('تقرير إغلاق الوردية') && h.includes('المتوقع في الدرج') && h.includes('عجز'), 'Z يعرض المتوقع والعجز');
ok(!hb.includes('المتوقع في الدرج') && hb.includes('المعدود فعلياً'), 'الإغلاق الأعمى يخفي المتوقع');
ok(buildShiftHTML(shifts.open(0), {}).includes('(X)'), 'X للمفتوحة');
done();
