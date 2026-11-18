// إلغاء المطبخ لصنف: يُنقص من الفاتورة، يعلّم التذكرة، وينشئ تنبيهاً للنادل صاحب الطلب (مع الطاولة والسبب)
const { ok, eq, done } = require('./harness');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), kitchen = require(S + 'kitchen');
db.init(); db.get().settings.vatRate = 0.15; orders.init(':memory:'); require(S + 'shifts').init();
auth.setupOwner('المالك', '1234');
auth.login(db.get().users[0].id, '1234');
auth.createUser({ name: 'سالم', role: 'waiter', pin: '2222' });
auth.createUser({ name: 'فهد', role: 'waiter', pin: '4444' });
const U = (n) => db.get().users.find((u) => u.name === n);
kitchen.saveStation({ name: 'ساخن' });
menu.saveCategory({ name: 'وجبات', sort: 1 }); const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'برغر', price: 20 }); menu.saveItem({ categoryId: cat, name: 'سلطة', price: 10 });
const burger = db.get().items.find((i) => i.name === 'برغر').id, salad = db.get().items.find((i) => i.name === 'سلطة').id;
const throws = (f) => { try { f(); return null; } catch (e) { return e.message; } };
const asWaiter = (name, f) => { auth.logout?.(); auth.login(U(name).id, name === 'سالم' ? '2222' : '4444'); const r = f(); auth.logout?.(); auth.login(db.get().users[0].id, '1234'); return r; };

// طلب صالة أنشأه النادل سالم
let o = asWaiter('سالم', () => orders.save({ type: 'takeaway', lines: [{ itemId: burger, qty: 2 }, { itemId: salad, qty: 1 }] }));
kitchen.send(o.id);
let tk = kitchen.board()[0]; eq(tk.items.length, 2, 'تذكرة بصنفين');
const before = orders.get(o.id).totalCents;

ok(/اختر سبب/.test(throws(() => kitchen.rejectItem(tk.id, 0, 'ما'))), 'السبب من القائمة فقط');
ok(/غير موجود/.test(throws(() => kitchen.rejectItem(tk.id, 9, 'نفد'))), 'فهرس خاطئ');

const r = kitchen.rejectItem(tk.id, 0, 'نفد'); eq(r.orderVoided, false, 'الطلب باقٍ');
const after = orders.get(o.id); eq(after.lines.length, 1, 'سُحب البرغر من الفاتورة'); ok(after.totalCents < before, 'الإجمالي انخفض');
eq(after.lines[0].name, 'سلطة', 'بقيت السلطة');
tk = kitchen.board()[0]; ok(tk.items[0].rejected?.reason === 'نفد', 'التذكرة تعلّم الصنف الملغى'); eq(tk.status, 'new', 'التذكرة باقية للصنف الآخر');
ok(/أُلغي مسبقاً|غير موجود/.test(throws(() => kitchen.rejectItem(tk.id, 0, 'نفد'))), 'لا إلغاء مكرر');

// التنبيه: لسالم فقط (صاحب الطلب)، لا لفهد
let a = kitchen.alertsFor(U('سالم')); eq(a.length, 1, 'تنبيه لصاحب الطلب'); eq(a[0].itemName, 'برغر', 'اسم الصنف'); eq(a[0].qty, 2, 'الكمية'); eq(a[0].reason, 'نفد', 'السبب'); eq(a[0].orderNumber, o.number, 'رقم الطلب');
eq(kitchen.alertsFor(U('فهد')).length, 0, 'لا يصل لنادل آخر');
kitchen.ackAlert(a[0].id); eq(kitchen.alertsFor(U('سالم')).length, 0, 'يختفي بعد التأكيد');

// طلب أنشأه الكاشير (المالك): يصل لكل النوادل
let o2 = orders.save({ type: 'takeaway', lines: [{ itemId: salad, qty: 1 }, { itemId: burger, qty: 1 }] }); kitchen.send(o2.id);
const tk2 = kitchen.board().find((t) => t.orderId === o2.id);
kitchen.rejectItem(tk2.id, 0, 'خطأ في الطلب');
eq(kitchen.alertsFor(U('سالم')).length, 1, 'طلب الكاشير: يصل لسالم'); eq(kitchen.alertsFor(U('فهد')).length, 1, 'ولفهد');

// آخر صنف: يُلغى الطلب كله وتُغلق التذكرة
const last = kitchen.board().find((t) => t.orderId === o2.id);
const rv = kitchen.rejectItem(last.id, 1, 'لا يمكن تحضيره'); eq(rv.orderVoided, true, 'آخر صنف يُلغي الطلب'); eq(orders.get(o2.id).status, 'void', 'الطلب ملغي');

// لا إلغاء بعد الجاهزية ولا على طلب مدفوع
let o3 = orders.save({ type: 'takeaway', lines: [{ itemId: burger, qty: 1 }, { itemId: salad, qty: 1 }] }); kitchen.send(o3.id);
const t3 = kitchen.board().find((t) => t.orderId === o3.id);
kitchen.bump(t3.id, 'start'); kitchen.bump(t3.id, 'ready');
ok(/جاهز/.test(throws(() => kitchen.rejectItem(t3.id, 0, 'نفد'))), 'لا إلغاء بعد الجاهزية');
done();
