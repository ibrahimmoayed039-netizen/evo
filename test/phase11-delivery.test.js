// المنطق الخلفي للتوصيل: أجرة التوصيل، السائقون وأجورهم، حالات الطلب، التقرير، الترحيل
const { ok, eq, throws, done, tmp } = require('./harness');
const path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts');
const reports = require(S + 'reports'), delivery = require(S + 'delivery'), perms = require(S + 'permissions');
db.init(); orders.init(':memory:'); shifts.init();
auth.setupOwner('المالك', '1234'); const ownerId = db.get().users[0].id; auth.login(ownerId, '1234');
auth.createUser({ name: 'كاشير', role: 'cashier', pin: '1111' }); const cashierId = db.get().users.find((u) => u.role === 'cashier').id;
menu.saveCategory({ name: 'وجبات', sort: 1 }); const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'برجر', price: 50 }); menu.saveItem({ categoryId: cat, name: 'بطاطس', price: 10 });
const [burger, fries] = db.get().items.map((i) => i.id), today = reports.ymd(new Date());
const asOwner = () => auth.login(ownerId, '1234'), asCashier = () => auth.login(cashierId, '1111');
const mk = (extra = {}) => orders.save({ type: 'delivery', customer: { name: 'علي', phone: '07701234567', address: 'الكرادة' }, lines: [{ itemId: burger, qty: 1 }], ...extra });

// ---- الصلاحيات ----
ok(perms.can('owner', 'delivery.manage') && perms.can('manager', 'delivery.manage'), 'المالك والمدير يديران التوصيل');
ok(perms.can('cashier', 'delivery') && !perms.can('cashier', 'delivery.manage'), 'الكاشير يرى اللوحة فقط');
ok(!perms.can('accountant', 'delivery') && !perms.can('kitchen', 'delivery'), 'المحاسب والمطبخ بلا وصول');

// ---- الإعدادات ----
eq(delivery.config().baseFeeCents, 0, 'الافتراضي بلا أجرة'); eq(orders.quote({ type: 'delivery', lines: [{ itemId: burger, qty: 1 }] }).totalCents, 5750, 'بلا إعداد: لا تتغير الإجماليات (50 + 15%)');
throws(() => delivery.saveConfig({ baseFee: -1, freeOver: 0, zones: [] }), /غير صالح/, 'أجرة سالبة');
throws(() => delivery.saveConfig({ baseFee: 5, freeOver: 0, zones: [{ name: '', fee: 1 }] }), /اسم المنطقة/, 'منطقة بلا اسم');
throws(() => delivery.saveConfig({ baseFee: 5, freeOver: 0, zones: [{ name: 'أ', fee: 1 }, { name: 'أ', fee: 2 }] }), /مكررة/, 'منطقة مكررة');
throws(() => delivery.saveConfig({ baseFee: 5, freeOver: 0, zones: [{ name: 'أ', fee: 'abc' }] }), /غير صالح/, 'أجرة منطقة غير رقمية');
let cfg = delivery.saveConfig({ baseFee: 5, freeOver: 100, zones: [{ name: 'الكرادة', fee: 8 }, { name: 'المنصور', fee: 12 }] });
eq(cfg.zones.length, 2, 'منطقتان'); const [kar, man] = cfg.zones;
eq(delivery.saveConfig({ baseFee: 5, freeOver: 100, zones: [{ id: kar.id, name: 'الكرادة', fee: 9 }, { id: man.id, name: 'المنصور', fee: 12 }] }).zones[0].id, kar.id, 'تعديل منطقة يحفظ معرّفها');
delivery.saveConfig({ baseFee: 5, freeOver: 100, zones: [{ id: kar.id, name: 'الكرادة', fee: 8 }, { id: man.id, name: 'المنصور', fee: 12 }] });

// ---- الاقتباس والحساب ----
const L1 = [{ itemId: burger, qty: 1 }], L2 = [{ itemId: burger, qty: 2 }];
let q = orders.quote({ type: 'delivery', lines: L1 }); eq(q.deliveryFeeCents, 500, 'الأجرة الافتراضية 5.00'); eq(q.totalCents, 6250, 'إجمالي = 50 + ضريبة 7.50 + أجرة 5.00');
q = orders.quote({ type: 'delivery', zoneId: kar.id, lines: L1 }); eq(q.deliveryFeeCents, 800, 'أجرة الكرادة'); eq(q.totalCents, 6550, 'إجمالي بأجرة المنطقة'); eq(q.deliveryZone, 'الكرادة', 'اسم المنطقة'); eq(q.vatCents, 750, 'الضريبة لا تشمل الأجرة');
q = orders.quote({ type: 'takeaway', zoneId: kar.id, lines: L1 }); eq(q.deliveryFeeCents, 0, 'السفري بلا أجرة'); eq(q.totalCents, 5750, 'إجمالي السفري');
q = orders.quote({ type: 'delivery', zoneId: man.id, lines: L2 }); eq(q.deliveryFeeCents, 0, 'مجاني فوق الحد (100)'); ok(q.freeDelivery, 'علامة التوصيل المجاني'); eq(q.totalCents, 11500, 'إجمالي بلا أجرة');
q = orders.quote({ type: 'delivery', lines: L2, discount: { type: 'percent', value: 10 } }); eq(q.deliveryFeeCents, 500, 'الحد المجاني يُقاس بعد الخصم (90 < 100)'); eq(q.totalCents, 9000 + 1350 + 500, 'إجمالي بعد الخصم + أجرة');
throws(() => orders.quote({ type: 'delivery', zoneId: 'nope', lines: L1 }), /منطقة التوصيل غير موجودة/, 'منطقة غير موجودة');
throws(() => mk({ customer: { name: 'x' } }), /جوال/, 'التوصيل يحتاج جوالاً (كما كان)');

// ---- حفظ الطلب والدفع ----
const o1 = mk({ zoneId: kar.id });
eq(o1.deliveryStatus, 'preparing', 'حالة البداية: قيد التجهيز'); eq(o1.deliveryFeeCents, 800, 'الأجرة محفوظة'); eq(o1.deliveryZone, 'الكرادة', 'المنطقة محفوظة'); eq(o1.totalCents, 6550, 'الإجمالي محفوظ بالأجرة'); eq(o1.driverId, null, 'بلا سائق');
eq(orders.save({ type: 'takeaway', lines: L1 }).deliveryStatus, null, 'السفري بلا حالة توصيل');
shifts.open(100);
throws(() => orders.pay(o1.id, [{ method: 'cash', amount: 57.5 }]), /أقل من الإجمالي/, 'الدفع بدون الأجرة مرفوض');
eq(orders.pay(o1.id, [{ method: 'cash', amount: 70 }]).changeCents, 450, 'الباقي محسوب على الإجمالي بالأجرة');
ok(orders.toReceipt(o1.id).totals.deliveryFee === 8 && orders.toReceipt(o1.id).totals.total === 65.5, 'الإيصال يحمل الأجرة والإجمالي');
// تعديل طلب مفتوح يعيد حساب الأجرة
const o2 = mk(); eq(o2.deliveryFeeCents, 500, 'طلب بأجرة افتراضية');
let u2 = orders.save({ id: o2.id, type: 'delivery', customer: o2.customer, zoneId: man.id, lines: L1 }); eq(u2.deliveryFeeCents, 1200, 'تغيير المنطقة يغيّر الأجرة'); eq(u2.deliveryStatus, 'preparing', 'إعادة الحفظ لا تعيد ضبط الحالة');
u2 = orders.save({ id: o2.id, type: 'delivery', customer: o2.customer, zoneId: man.id, lines: L2 }); eq(u2.deliveryFeeCents, 0, 'زيادة الأصناف فوق الحد تُسقط الأجرة');

// ---- أجرة يدوية وصلاحياتها ----
const o3 = mk({ deliveryFee: 3 }); eq(o3.deliveryFeeCents, 300, 'المالك يضبط أجرة يدوية'); ok(o3.feeManual, 'علامة يدوية');
eq(orders.save({ id: o3.id, type: 'delivery', customer: o3.customer, lines: L2 }).deliveryFeeCents, 300, 'إعادة الحفظ بلا deliveryFee تُبقي اليدوية');
eq(orders.save({ id: o3.id, type: 'delivery', customer: o3.customer, lines: L1, deliveryFee: null }).deliveryFeeCents, 500, 'null يعيد الحساب التلقائي');
eq(orders.save({ id: o3.id, type: 'delivery', customer: o3.customer, lines: L1, deliveryFee: 0 }).deliveryFeeCents, 0, 'أجرة يدوية صفر (توصيل مجاني)');
asCashier();
throws(() => mk({ deliveryFee: 1 }), /غير مصرح/, 'الكاشير لا يعدّل الأجرة'); throws(() => orders.quote({ type: 'delivery', lines: L1, deliveryFee: 1 }), /غير مصرح/, 'ولا في الاقتباس');
eq(orders.save({ id: o3.id, type: 'delivery', customer: o3.customer, lines: L2 }).deliveryFeeCents, 0, 'الكاشير يعدّل الطلب فتبقى الأجرة اليدوية');
const oc = mk(); eq(oc.deliveryFeeCents, 500, 'الكاشير ينشئ طلب توصيل بالأجرة التلقائية');
asOwner();

// ---- السائقون ----
throws(() => delivery.saveDriver({ name: '' }), /اسم السائق/, 'اسم السائق مطلوب');
throws(() => delivery.saveDriver({ name: 'أ', wageMode: 'percent', wage: 150 }), /نسبة/, 'نسبة أكبر من 100');
throws(() => delivery.saveDriver({ name: 'أ', wage: -2 }), /غير صالح/, 'أجر سالب');
const dFix = delivery.saveDriver({ name: 'حيدر', phone: '0780', wageMode: 'fixed', wage: 3 }), dPct = delivery.saveDriver({ name: 'مصطفى', wageMode: 'percent', wage: 50 });
eq(dFix.wageCents, 300, 'أجر ثابت 3.00'); eq(dPct.wagePct, 50, 'نسبة 50%'); throws(() => delivery.saveDriver({ name: 'حيدر' }), /بنفس الاسم/, 'اسم مكرر');
eq(delivery.drivers().length, 2, 'سائقان'); const dOff = delivery.saveDriver({ name: 'معطّل', wage: 1, active: false });

// ---- الحالات والتعيين ----
const a = mk({ zoneId: kar.id }); // أجرة 8.00
throws(() => delivery.setStatus(a.id, 'on_the_way'), /عيّن سائقاً/, 'لا خروج بلا سائق');
throws(() => delivery.assign(a.id, dOff.id), /غير متاح/, 'سائق معطّل'); throws(() => delivery.assign(a.id, 'nope'), /غير متاح/, 'سائق غير موجود');
eq(delivery.assign(a.id, dFix.id).driverName, 'حيدر', 'تعيين سائق');
throws(() => delivery.setStatus(a.id, 'delivered'), /خطوة واحدة/, 'لا قفز من التجهيز للتسليم'); throws(() => delivery.setStatus(a.id, 'x'), /غير صالحة/, 'حالة غير صالحة');
let r = delivery.setStatus(a.id, 'on_the_way'); eq(r.status, 'on_the_way', 'في الطريق'); ok(!!r.outAt, 'وقت الخروج');
throws(() => delivery.assign(a.id, null), /في الطريق/, 'لا إزالة السائق أثناء الطريق'); eq(delivery.assign(a.id, dPct.id).driverName, 'مصطفى', 'تغيير السائق أثناء الطريق مسموح');
r = delivery.setStatus(a.id, 'delivered'); eq(r.status, 'delivered', 'تم التسليم'); eq(orders.get(a.id).driverWageCents, 400, 'أجر السائق = 50% من أجرة 8.00 = 4.00'); ok(!!r.deliveredAt, 'وقت التسليم');
throws(() => delivery.assign(a.id, dFix.id), /مُسلَّم/, 'لا تغيير السائق بعد التسليم');
delivery.saveDriver({ id: dPct.id, name: 'مصطفى', wageMode: 'percent', wage: 10 }); eq(orders.get(a.id).driverWageCents, 400, 'الأجر المثبّت لا يتأثر بتعديل الإعداد');
eq(delivery.setStatus(a.id, 'on_the_way').status, 'on_the_way', 'رجوع خطوة'); eq(orders.get(a.id).driverWageCents, null, 'الرجوع يمسح أجر السائق'); eq(delivery.setStatus(a.id, 'delivered').status, 'delivered', 'تسليم من جديد');
eq(orders.get(a.id).driverWageCents, 80, 'الأجر بالنسبة الجديدة 10% × 8.00');
eq(delivery.setStatus(a.id, 'delivered').status, 'delivered', 'نفس الحالة لا تغيّر شيئاً');
throws(() => delivery.setStatus(orders.save({ type: 'takeaway', lines: L1 }).id, 'on_the_way'), /ليس طلب توصيل/, 'سفري ليس توصيلاً');

// طلب ثانٍ بسائق ثابت: مدفوع وغير مدفوع
const b = mk({ zoneId: man.id }); delivery.assign(b.id, dFix.id); delivery.setStatus(b.id, 'on_the_way'); delivery.setStatus(b.id, 'delivered'); // أجرة 12، أجر 3، غير مدفوع
const c = mk(); delivery.assign(c.id, dFix.id); delivery.setStatus(c.id, 'on_the_way'); delivery.setStatus(c.id, 'delivered'); orders.pay(c.id, [{ method: 'cash', amount: 100 }]); // أجرة 5، أجر 3، مدفوع

// ---- اللوحة ----
let bd = delivery.board();
ok(bd.some((x) => x.id === b.id && x.status === 'delivered' && !x.paid) && bd.some((x) => x.id === c.id && x.paid), 'اللوحة تعرض المسلّم مدفوعاً وغير مدفوع');
ok(!bd.some((x) => x.id === orders.save({ type: 'takeaway', lines: L1 }).id), 'اللوحة للتوصيل فقط');
ok(bd.every((x, i) => i === 0 || bd[i - 1].id > x.id), 'الأحدث أولاً');
// طلب قديم غير مسلّم يظهر دائماً حتى خارج الفترة
const old = mk(); orders.raw().prepare('UPDATE orders SET created_at=? WHERE id=?').run(new Date(Date.now() - 5 * 86400000).toISOString(), old.id);
ok(delivery.board({ days: 1 }).some((x) => x.id === old.id), 'غير المسلّم القديم يظهر');
orders.raw().prepare("UPDATE orders SET delivery_status='delivered' WHERE id=?").run(old.id);
ok(!delivery.board({ days: 1 }).some((x) => x.id === old.id) && delivery.board({ days: 7 }).some((x) => x.id === old.id), 'المسلّم القديم حسب الأيام');

// ---- التقرير ----
const rep = delivery.report({ from: today, to: today }), by = Object.fromEntries(rep.drivers.map((d) => [d.name, d]));
eq(by['حيدر'].deliveries, 2, 'حيدر: توصيلتان'); eq(by['حيدر'].feeCents, 1700, 'أجرة 12 + 5'); eq(by['حيدر'].wageCents, 600, 'أجره 3 + 3'); eq(by['حيدر'].netFeeCents, 1100, 'صافي الأجرة بعد أجر السائق');
eq(by['حيدر'].unpaidCents, orders.get(b.id).totalCents, 'غير المدفوع المسلّم بذمة السائق'); eq(by['حيدر'].unpaidCount, 1, 'عدد غير المدفوعة'); ok(by['حيدر'].avgMinutes !== null, 'متوسط مدة التوصيل');
eq(by['مصطفى'].deliveries, 1, 'مصطفى: توصيلة'); eq(by['مصطفى'].wageCents, 80, 'أجره المثبّت');
eq(rep.totals.deliveries, 3, 'مجموع التوصيلات'); eq(rep.totals.wageCents, 680, 'مجموع الأجور'); eq(rep.totals.feeCents, 2500, 'مجموع الأجرة');
eq(delivery.report({ from: '2020-01-01', to: '2020-01-02' }).totals.deliveries, 0, 'فترة فارغة'); throws(() => delivery.report({ from: 'x', to: today }), /تاريخ/, 'تاريخ غير صالح');
// إلغاء طلب مُسلَّم يخرجه من التقرير واللوحة
orders.voidOrder(b.id, 'خطأ'); ok(!delivery.board().some((x) => x.id === b.id), 'الملغي خارج اللوحة'); eq(delivery.report({ from: today, to: today }).totals.deliveries, 2, 'الملغي خارج التقرير');
throws(() => delivery.setStatus(b.id, 'on_the_way'), /ملغي/, 'لا تغيير حالة طلب ملغي'); throws(() => delivery.assign(b.id, dFix.id), /ملغي/, 'ولا تعيين');

// ---- حذف السائق ----
throws(() => delivery.removeDriver(dFix.id), /عطّله/, 'سائق له طلبات لا يُحذف'); delivery.removeDriver(dOff.id); eq(delivery.drivers().length, 2, 'حذف سائق بلا طلبات'); throws(() => delivery.removeDriver('nope'), /غير موجود/, 'حذف غير موجود');

// ---- تغيير نوع الطلب ----
const t1 = mk({ zoneId: kar.id }); delivery.assign(t1.id, dFix.id);
let tk = orders.save({ id: t1.id, type: 'takeaway', lines: L1 }); eq(tk.deliveryStatus, null, 'التحويل لسفري يمسح حالة التوصيل'); eq(tk.driverId, null, 'ويمسح السائق'); eq(tk.deliveryFeeCents, 0, 'ويمسح الأجرة'); eq(tk.totalCents, 5750, 'الإجمالي بلا أجرة');
tk = orders.save({ id: t1.id, type: 'delivery', customer: { phone: '0770' }, zoneId: kar.id, lines: L1 }); eq(tk.deliveryStatus, 'preparing', 'السفري → توصيل يبدأ قيد التجهيز'); eq(tk.deliveryFeeCents, 800, 'ويأخذ الأجرة');
delivery.assign(t1.id, dFix.id); delivery.setStatus(t1.id, 'on_the_way');
throws(() => orders.save({ id: t1.id, type: 'takeaway', lines: L1 }), /خرج للتوصيل/, 'لا تغيير نوع طلب خرج للتوصيل');

// ---- تقسيم طلب توصيل: الأجرة تبقى على الأصلي ----
const sp = mk({ zoneId: kar.id, lines: [{ itemId: burger, qty: 1 }, { itemId: fries, qty: 1 }] }); eq(sp.totalCents, 7700, 'قبل التقسيم: 60 + 9 + 8');
const sr = orders.split(sp.id, [{ i: 1, qty: 1 }]);
eq(sr.original.totalCents, 6550, 'الأصلي: 50 + 7.50 + أجرة 8'); eq(sr.created.totalCents, 1150, 'الجديد: 10 + 1.50 بلا أجرة'); eq(sr.created.deliveryFeeCents, 0, 'الجديد بلا أجرة'); eq(sr.original.totalCents + sr.created.totalCents, 7700, 'المجموع لا يتغير');
eq(sr.created.deliveryStatus, 'preparing', 'الجديد طلب توصيل قيد التجهيز');

// ---- التقارير تعرض مجموع الأجرة ----
eq(reports.sales({ from: today, to: today }).deliveryFeeCents, 1300, 'أجرة التوصيل في تقرير المبيعات (الطلبات السارية)');

// ---- ترحيل قاعدة قديمة (بلا أعمدة التوصيل) ----
const file = path.join(tmp, 'old-orders.db'); orders.close(); orders.init(file);
const sql = orders.raw(), ins = (n, st, ex = '') => sql.prepare(`INSERT INTO orders(number,status,type,lines,vat_rate,subtotal_cents,discount_cents,vat_cents,total_cents,created_at,paid_at${ex ? ',voided_at' : ''}) VALUES(?,?,'delivery','[]',0.15,100,0,15,115,'2026-01-05T10:00:00.000Z',${st === 'paid' ? "'2026-01-05T10:30:00.000Z'" : 'NULL'}${ex ? ",'2026-01-05T11:00:00.000Z'" : ''})`).run(n, st);
ins(2001, 'open'); ins(2002, 'paid'); ins(2003, 'void', 'v');
sql.exec('DROP INDEX idx_orders_driver'); for (const c of ['delivery_fee_cents', 'fee_manual', 'delivery_zone_id', 'delivery_zone', 'delivery_status', 'driver_id', 'driver_name', 'driver_wage_cents', 'out_at', 'delivered_at']) sql.exec(`ALTER TABLE orders DROP COLUMN ${c}`);
orders.close(); orders.init(file); const mg = (n) => orders.get(orders.raw().prepare('SELECT id FROM orders WHERE number=?').get(n).id);
eq(mg(2001).deliveryStatus, 'preparing', 'ترحيل: المفتوح قيد التجهيز'); eq(mg(2002).deliveryStatus, 'delivered', 'ترحيل: المدفوع مُسلَّم'); eq(mg(2003).deliveryStatus, 'delivered', 'ترحيل: الملغي مُسلَّم'); eq(mg(2002).deliveryFeeCents, 0, 'ترحيل: بلا أجرة');
ok(!!mg(2002).deliveredAt, 'ترحيل: وقت تسليم تقريبي'); orders.close(); orders.init(file); eq(mg(2001).deliveryStatus, 'preparing', 'إعادة التشغيل لا تعيد الترحيل');
done();
