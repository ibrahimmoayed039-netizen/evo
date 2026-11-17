// إلغاء/تقليل صنف بعد الإرسال للمطبخ: تذكرة «ملغاة» بالأصناف المُلغاة على محطة كل صنف، دون كسر منع الإرسال المكرر
const { ok, eq, done } = require('./harness');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), kitchen = require(S + 'kitchen');
db.init(); orders.init(':memory:'); require(S + 'shifts').init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
const hot = kitchen.saveStation({ name: 'ساخن' }), bar = kitchen.saveStation({ name: 'مشروبات' });
menu.saveCategory({ name: 'وجبات', sort: 1 });
const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'برغر', price: 20, stationId: hot.id });
menu.saveItem({ categoryId: cat, name: 'عصير', price: 8, stationId: bar.id });
const burger = db.get().items.find((i) => i.name === 'برغر').id, juice = db.get().items.find((i) => i.name === 'عصير').id;
const L = (b, j, note = '') => [...(b ? [{ itemId: burger, qty: b, note }] : []), ...(j ? [{ itemId: juice, qty: j }] : [])];
const board = () => kitchen.board();
const cancelled = () => board().filter((t) => t.status === 'cancelled');

let o = orders.save({ type: 'takeaway', lines: L(3, 2) });
eq(o.removedSent, undefined, 'طلب جديد بلا إلغاءات');
kitchen.send(o.id); eq(board().length, 2, 'تذكرتان: ساخن + مشروبات');

// تقليل الكمية 3 → 1
o = orders.save({ id: o.id, type: 'takeaway', lines: L(1, 2) });
eq(o.removedSent.length, 1, 'سطر واحد مُلغى'); eq(o.removedSent[0].qty, 2, 'الفرق 2'); eq(o.removedSent[0].name, 'برغر', 'الاسم');
let t = kitchen.cancelItems(o.id, o.removedSent);
eq(t.length, 1, 'تذكرة إلغاء واحدة'); eq(t[0].stationName, 'ساخن', 'على محطة الصنف'); eq(t[0].status, 'cancelled', 'حالة ملغاة'); eq(t[0].items[0].qty, 2, 'كمية الإلغاء');
eq(t[0].batch, 1, 'لا يرفع رقم الدفعة'); eq(cancelled().length, 1, 'تظهر في لوحة المطبخ');

// إعادة الحفظ بلا تغيير: لا إلغاء مكرر
o = orders.save({ id: o.id, type: 'takeaway', lines: L(1, 2) }); eq(o.removedSent, undefined, 'لا تكرار عند إعادة الحفظ');
// رفع الكمية بعد الإلغاء: يُرسل الفرق من جديد (المطبخ أُبلغ بالإلغاء)
o = orders.save({ id: o.id, type: 'takeaway', lines: L(2, 2) });
let s = kitchen.send(o.id); eq(s.length, 1, 'الفرق يُرسل'); eq(s[0].items[0].qty, 1, 'قطعة واحدة'); eq(s[0].batch, 2, 'دفعة 2 (لم تُحرق بالإلغاء)');

// حذف صنف كامل من محطة أخرى
o = orders.save({ id: o.id, type: 'takeaway', lines: L(2, 0) });
eq(o.removedSent.length, 1, 'حذف العصير'); t = kitchen.cancelItems(o.id, o.removedSent); eq(t[0].stationName, 'مشروبات', 'على محطته');
// زيادة الكمية لا تُلغي شيئاً
o = orders.save({ id: o.id, type: 'takeaway', lines: L(5, 0) }); eq(o.removedSent, undefined, 'الزيادة لا تُلغي');
// تغيير الملاحظة = إلغاء القديم + إرسال الجديد
kitchen.send(o.id);
o = orders.save({ id: o.id, type: 'takeaway', lines: L(5, 0, 'بدون بصل') }); eq(o.removedSent.length, 1, 'تغيير الملاحظة يُلغي السطر القديم'); eq(o.removedSent[0].qty, 5, 'بكامل كميته');
eq(kitchen.send(o.id)[0].items[0].note, 'بدون بصل', 'ويُرسل الجديد بملاحظته');

// تأكيد المطبخ + حماية
const c = cancelled()[0]; eq(kitchen.bump(c.id, 'ack').status, 'ack', 'المطبخ يؤكد استلام الإلغاء'); ok(!cancelled().some((x) => x.id === c.id), 'تختفي بعد التأكيد');
eq(kitchen.cancelItems(o.id, []).length, 0, 'قائمة فارغة لا تنشئ شيئاً');
done();
