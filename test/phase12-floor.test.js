// مخطط الصالة المرئي: الأشكال والأحجام، حالة الطاولة (فاضية/مشغولة/تنتظر الحساب)، بداية الجلوس، طلب الحساب
const { ok, eq, throws, done, tmp } = require('./harness');
const path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), tables = require(S + 'tables');
db.init(); orders.init(':memory:'); shifts.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'وجبات', sort: 1 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'برجر', price: 50 }); const burger = db.get().items[0].id; shifts.open(100);
const L = [{ itemId: burger, qty: 1 }], fl = (id) => tables.floor().find((t) => t.id === id);

// ---- الشكل والحجم ----
const A = tables.save({ name: 'A1', seats: 4, shape: 'round', size: 'l' }), B = tables.save({ name: 'B1', seats: 6, shape: 'rect' }), C = tables.save({ name: 'C1', seats: 2 });
eq(A.shape, 'round', 'شكل دائري'); eq(A.size, 'l', 'حجم كبير'); eq(B.size, 'm', 'الحجم الافتراضي متوسط'); eq(C.shape, 'rect', 'بلا شكل: مستطيل كما كان');
eq(tables.save({ name: 'D1', seats: 4, shape: 'triangle', size: 'xxl' }).shape, 'rect', 'شكل غير صالح يعود للمستطيل'); eq(tables.save({ name: 'D2', shape: 'x', size: 'xxl' }).size, 'm', 'حجم غير صالح يعود للمتوسط');
eq(tables.save({ ...A, x: 40, y: 50 }).shape, 'round', 'تحريك الطاولة يحفظ شكلها');
// طاولة قديمة مخزّنة بلا شكل/حجم
db.get().tables.push({ id: 'legacy', name: 'قديمة', area: 'الصالة', seats: 4, x: 10, y: 10 }); eq(fl('legacy').shape, 'rect', 'قديمة: مستطيل'); eq(fl('legacy').size, 'm', 'قديمة: متوسط');
db.get().tables = db.get().tables.filter((t) => t.id !== 'legacy');

// ---- الحالات ----
let f = fl(A.id); eq(f.status, 'free', 'فاضية'); eq(f.seatedAt, null, 'لا جلوس'); eq(f.totalCents, 0, 'بلا مبلغ'); eq(f.billAt, null, 'لا طلب حساب');
const o1 = orders.save({ type: 'dine_in', tableId: A.id, lines: L }); f = fl(A.id); eq(f.status, 'busy', 'مشغولة'); eq(f.seatedAt, o1.createdAt, 'بداية الجلوس = وقت الطلب'); eq(f.totalCents, o1.totalCents, 'مجموع الطاولة');
const r1 = orders.requestBill(o1.id); ok(!!r1.billAt, 'وقت طلب الحساب'); f = fl(A.id); eq(f.status, 'bill', 'تنتظر الحساب'); eq(f.billAt, r1.billAt, 'billAt'); eq(f.orders[0].billAt, r1.billAt, 'billAt على الطلب');
eq(orders.requestBill(o1.id).billAt, r1.billAt, 'تكرار الطلب لا يغيّر الوقت');
orders.requestBill(o1.id, false); eq(fl(A.id).status, 'busy', 'إلغاء طلب الحساب يعيدها مشغولة'); eq(orders.get(o1.id).billAt, null, 'مسح الوقت');
orders.requestBill(o1.id); const o2 = orders.save({ type: 'dine_in', tableId: A.id, lines: L });
f = fl(A.id); eq(f.status, 'bill', 'طلب واحد منتظر يكفي'); eq(f.orders.length, 2, 'طلبان على الطاولة'); eq(f.seatedAt, o1.createdAt, 'أقدم طلب'); eq(f.totalCents, o1.totalCents + o2.totalCents, 'مجموع الطلبين');
orders.save({ id: o1.id, type: 'dine_in', tableId: A.id, lines: [{ itemId: burger, qty: 2 }] }); ok(!!orders.get(o1.id).billAt, 'تعديل الطلب لا يمسح طلب الحساب');
orders.pay(o1.id, [{ method: 'cash', amount: 500 }]); f = fl(A.id); eq(f.status, 'busy', 'بعد دفع المنتظر وبقاء طلب آخر: مشغولة'); eq(f.seatedAt, o2.createdAt, 'بداية الجلوس = الطلب المتبقي');
orders.pay(o2.id, [{ method: 'cash', amount: 500 }]); eq(fl(A.id).status, 'free', 'بعد الدفع: فاضية'); eq(fl(A.id).billAt, null, 'ولا طلب حساب');
// إلغاء/نقل/دمج
const v = orders.save({ type: 'dine_in', tableId: B.id, lines: L }); orders.requestBill(v.id); orders.voidOrder(v.id, ''); eq(fl(B.id).status, 'free', 'إلغاء الطلب يحرّر الطاولة');
const m1 = orders.save({ type: 'dine_in', tableId: B.id, lines: L }); orders.requestBill(m1.id); orders.moveOrder(m1.id, C.id); eq(fl(B.id).status, 'free', 'النقل يحرّر المصدر'); eq(fl(C.id).status, 'bill', 'والهدف تنتظر الحساب');
const m2 = orders.save({ type: 'dine_in', tableId: C.id, lines: L }); orders.merge(m2.id, m1.id); eq(fl(C.id).orders.length, 1, 'الدمج يبقي طلباً واحداً'); eq(fl(C.id).status, 'bill', 'والمدموج فيه يحتفظ بطلب الحساب');
const sp = orders.save({ type: 'dine_in', tableId: B.id, lines: [{ itemId: burger, qty: 2 }] }); orders.requestBill(sp.id); const sr = orders.split(sp.id, [{ i: 0, qty: 1 }]);
ok(!!orders.get(sr.original.id).billAt && !orders.get(sr.created.id).billAt, 'التقسيم: الجديد لا يرث طلب الحساب'); eq(fl(B.id).status, 'bill', 'الطاولة ما زالت تنتظر الحساب');

// ---- القيود ----
throws(() => orders.requestBill(orders.save({ type: 'takeaway', lines: L }).id), /الطاولات/, 'السفري بلا طلب حساب');
throws(() => orders.requestBill(orders.save({ type: 'delivery', customer: { phone: '1' }, lines: L }).id), /الطاولات/, 'التوصيل بلا طلب حساب');
const pd = orders.save({ type: 'dine_in', tableId: A.id, lines: L }); orders.pay(pd.id, [{ method: 'cash', amount: 100 }]); throws(() => orders.requestBill(pd.id), /غير مفتوح/, 'المدفوع لا يُطلب حسابه'); throws(() => orders.requestBill(99999), /غير موجود/, 'طلب غير موجود');
ok(db.get().audit.some((a) => a.action === 'bill_request') && db.get().audit.some((a) => a.action === 'bill_cancel'), 'تسجيل الطلب والإلغاء في السجل');

// ---- ترحيل قاعدة قديمة بلا عمود طلب الحساب ----
const file = path.join(tmp, 'old-floor.db'); orders.close(); orders.init(file);
orders.raw().exec("INSERT INTO orders(number,status,type,table_id,table_label,lines,vat_rate,subtotal_cents,discount_cents,vat_cents,total_cents,created_at) VALUES(1,'open','dine_in','T','T','[]',0.15,100,0,15,115,'2026-01-05T10:00:00.000Z')");
orders.raw().exec('ALTER TABLE orders DROP COLUMN bill_requested_at'); orders.close(); orders.init(file);
eq(orders.openByTable().T[0].billAt, null, 'ترحيل: العمود يُضاف والطلبات القديمة بلا طلب حساب'); orders.requestBill(orders.openByTable().T[0].id); ok(!!orders.openByTable().T[0].billAt, 'ترحيل: طلب الحساب يعمل');
done();
