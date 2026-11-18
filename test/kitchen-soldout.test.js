// زر «نفد» في المطبخ: إيقاف الصنف/النوع في المنيو، وبقاء الطلبات المفتوحة التي أُرسل منها قابلة للحفظ والدفع
const { ok, eq, done } = require('./harness');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), kitchen = require(S + 'kitchen');
db.init(); db.get().settings.vatRate = 0.15; orders.init(':memory:'); require(S + 'shifts').init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
kitchen.saveStation({ name: 'ساخن' });
menu.saveCategory({ name: 'وجبات', sort: 1 }); const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'برغر', price: 20 });
menu.saveItem({ categoryId: cat, name: 'بيتزا', price: 30, variants: [{ name: 'صغير', price: 30, isDefault: true }, { name: 'كبير', price: 45 }] });
menu.saveItem({ categoryId: cat, name: 'سلطة', price: 9 });
const it = (n) => db.get().items.find((i) => i.name === n);
const burger = it('برغر').id, pizza = it('بيتزا'), salad = it('سلطة').id;
const big = pizza.variants.find((v) => v.name === 'كبير').id, small = pizza.variants.find((v) => v.name === 'صغير').id;
const throws = (f) => { try { f(); return null; } catch (e) { return e.message; } };

let o = orders.save({ type: 'takeaway', lines: [{ itemId: burger, qty: 2 }, { itemId: pizza.id, variantId: big, qty: 1 }] });
kitchen.send(o.id);
let b = kitchen.board()[0];
ok(b.items.every((i) => i.itemId) && b.items.every((i) => i.soldOut === false), 'التذكرة تحمل itemId وحالة المنيو');
ok(b.items.find((i) => i.name.includes('كبير')).variantId === big, 'تحمل variantId للنوع');

// نفد الصنف
let r = kitchen.setSoldOut(burger, null, true); eq(r.soldOut, true, 'أُوقف');
eq(it('برغر').soldOut, true, 'ظاهر في المنيو فوراً'); ok(kitchen.board()[0].items.find((i) => i.name === 'برغر').soldOut === true, 'اللوحة تعرضه نافداً');
ok(/نفد/.test(throws(() => orders.save({ type: 'takeaway', lines: [{ itemId: burger, qty: 1 }] }))), 'لا طلب جديد به');
// الطلب المفتوح الذي أُرسل منه يبقى قابلاً للحفظ (إضافة صنف آخر) وللدفع
o = orders.save({ id: o.id, type: 'takeaway', lines: [{ itemId: burger, qty: 2 }, { itemId: pizza.id, variantId: big, qty: 1 }, { itemId: salad, qty: 1 }] });
eq(o.lines.length, 3, 'الحفظ يعمل رغم نفاد الصنف المرسل'); eq(o.lines[0].sentQty, 2, 'sentQty باقٍ');
ok(/نفد/.test(throws(() => orders.save({ id: o.id, type: 'takeaway', lines: [{ itemId: burger, qty: 3 }, { itemId: salad, qty: 1 }] }))), 'الزيادة على النافد مرفوضة');
eq(orders.quote({ id: o.id, type: 'takeaway', lines: [{ itemId: burger, qty: 2 }] }).lines.length, 1, 'التسعير الحيّ يقبل المرسل');
ok(!!orders.pay(o.id, [{ method: 'cash', amount: 1000 }]).paidAt, 'الدفع يعمل');
// تقليل ثم رفع: بعد الإلغاء لا يُسمح بالعودة وهو نافد
let o2 = orders.save({ type: 'takeaway', lines: [{ itemId: salad, qty: 2 }] }); kitchen.send(o2.id); kitchen.setSoldOut(salad, null, true);
o2 = orders.save({ id: o2.id, type: 'takeaway', lines: [{ itemId: salad, qty: 1 }] });
ok(/نفد/.test(throws(() => orders.save({ id: o2.id, type: 'takeaway', lines: [{ itemId: salad, qty: 2 }] }))), 'بعد تقليل المرسل لا عودة للنافد');

// إعادة التوفر
kitchen.setSoldOut(burger, null, false); eq(it('برغر').soldOut, false, 'أُعيد'); ok(!throws(() => orders.save({ type: 'takeaway', lines: [{ itemId: burger, qty: 1 }] })), 'يُطلب من جديد');

// نوع واحد فقط
kitchen.setSoldOut(pizza.id, big, true);
ok(it('بيتزا').variants.find((v) => v.id === big).soldOut && !it('بيتزا').variants.find((v) => v.id === small).soldOut, 'النوع وحده نافد');
ok(/نفد/.test(throws(() => orders.save({ type: 'takeaway', lines: [{ itemId: pizza.id, variantId: big, qty: 1 }] }))), 'النوع النافد مرفوض');
ok(!throws(() => orders.save({ type: 'takeaway', lines: [{ itemId: pizza.id, variantId: small, qty: 1 }] })), 'النوع الآخر متاح');

// حماية
eq(throws(() => kitchen.setSoldOut('nope', null, true)), 'الصنف غير موجود', 'صنف مجهول');
ok(!!throws(() => kitchen.setSoldOut(pizza.id, 'nope', true)), 'نوع مجهول');
done();
