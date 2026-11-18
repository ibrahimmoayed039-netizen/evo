// دمج الطلب الجديد على طاولة مشغولة في فاتورتها المفتوحة (مسار الكاشير)
const { ok, eq, done } = require('./harness');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), tables = require(S + 'tables');
db.init(); db.get().settings.vatRate = 0; orders.init(':memory:'); shifts.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'وجبات', sort: 1 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'برجر', price: 50 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'كولا', price: 10 });
const burger = db.get().items[0].id, cola = db.get().items[1].id; shifts.open(100);
const A = tables.save({ name: 'A1', seats: 4 }), B = tables.save({ name: 'B1', seats: 4 });
const save = (p) => orders.save(orders.mergeIntoOpen(p));
const o1 = save({ type: 'dine_in', tableId: A.id, lines: [{ itemId: burger, qty: 1 }] });
const o2 = save({ type: 'dine_in', tableId: A.id, lines: [{ itemId: burger, qty: 1 }, { itemId: cola, qty: 2 }] });
eq(o2.id, o1.id, 'الطلب الثاني على نفس الطاولة يدخل نفس الفاتورة');
eq(orders.openByTable()[A.id].length, 1, 'فاتورة واحدة مفتوحة للطاولة');
eq(o2.lines.find((l) => l.itemId === burger).qty, 2, 'الصنف المتطابق تُجمع كميته'); eq(o2.totalCents, 12000, 'المجموع = 2 برجر + 2 كولا');
const o3 = save({ type: 'dine_in', tableId: B.id, lines: [{ itemId: cola, qty: 1 }] }); ok(o3.id !== o1.id, 'طاولة أخرى = فاتورة أخرى');
const t1 = save({ type: 'takeaway', lines: [{ itemId: cola, qty: 1 }] }), t2 = save({ type: 'takeaway', lines: [{ itemId: cola, qty: 1 }] }); ok(t1.id !== t2.id, 'السفري لا يُدمج');
orders.pay(o1.id, [{ method: 'cash', amount: 120 }]);
const o4 = save({ type: 'dine_in', tableId: A.id, lines: [{ itemId: cola, qty: 1 }] }); ok(o4.id !== o1.id, 'بعد الدفع تبدأ فاتورة جديدة');
done();
