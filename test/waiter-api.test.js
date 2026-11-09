// واجهة تطبيق النادل: خادم HTTPS حقيقي على منفذ محلي فوق المنطق الحقيقي (طلبات، مطبخ، صلاحيات، أمان)
const { ok, eq, done } = require('./harness');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // الخادم يستعمل شهادة ذاتية؛ التثبيت بالبصمة مُختبر في waiter-tls.test.js
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), tables = require(S + 'tables'), orders = require(S + 'orders'), kitchen = require(S + 'kitchen');
const wapi = require(S + 'waiter-api');
db.init(); orders.init(':memory:'); require(S + 'shifts').init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
auth.createUser({ name: 'سالم', role: 'waiter', pin: '2222' });
auth.createUser({ name: 'طباخ', role: 'kitchen', pin: '3333' });
auth.createUser({ name: 'كاشير1', role: 'cashier', pin: '4444' });
auth.createUser({ name: 'محاسب1', role: 'accountant', pin: '5555' });
const U = (n) => db.get().users.find((u) => u.name === n).id;

kitchen.saveStation({ name: 'المطبخ' });
menu.saveCategory({ name: 'مشروبات', sort: 1 }); menu.saveCategory({ name: 'وجبات', sort: 2 }); menu.saveCategory({ name: 'فارغ', sort: 3 });
const [cDr, cMeal] = db.get().categories.map((c) => c.id);
menu.saveGroup({ name: 'السكر', required: true, multi: false, options: [{ name: 'عادي', price: 0 }, { name: 'زيادة', price: 1 }] });
menu.saveGroup({ name: 'إضافات', required: false, multi: true, options: [{ name: 'جبن', price: 2 }, { name: 'بيض', price: 3 }] });
const [gSugar, gExtra] = db.get().modGroups.map((g) => g.id);
menu.saveItem({ categoryId: cDr, name: 'شاي', price: 5, modifierGroupIds: [gSugar] });
menu.saveItem({ categoryId: cMeal, name: 'برغر', price: 20, modifierGroupIds: [gExtra] });
menu.saveItem({ categoryId: cMeal, name: 'بيتزا', price: 30, variants: [{ name: 'صغير', price: 30, isDefault: true }, { name: 'كبير', price: 45 }] });
menu.saveItem({ categoryId: cMeal, name: 'نافد', price: 9 });
menu.saveItem({ categoryId: cMeal, name: 'مخفي', price: 9, active: false });
const items = db.get().items; const byName = (n) => items.find((i) => i.name === n);
menu.setSoldOut(byName('نافد').id, true);
const T1 = tables.save({ name: 'T1', seats: 4 }), T2 = tables.save({ name: 'T2', seats: 2 });

const PORT = 43000 + Math.floor(Math.random() * 2000);
let token = null;
const call = async (m, p, body, tok = token) => {
  const r = await fetch(`https://127.0.0.1:${PORT}${p}`, { method: m, headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const login = async (name, pin) => call('POST', '/api/login', { id: U(name), pin }, null);

(async () => {
  wapi.init({ sendToKitchen: async (id) => ({ tickets: kitchen.send(id), printErrors: [] }) });
  eq(wapi.status().running, false, 'معطّل افتراضياً');
  const e1 = await fetch(`https://127.0.0.1:${PORT}/api/ping`).then(() => 'up', () => 'down'); eq(e1, 'down', 'لا خادم قبل التفعيل');
  try { await wapi.setConfig({ enabled: true, port: 80 }); ok(false, 'منفذ نظامي'); } catch (e) { ok(/المنفذ/.test(e.message), 'منفذ نظامي مرفوض'); }
  await wapi.setConfig({ enabled: true, port: PORT });
  ok(wapi.status().running, 'يعمل بعد التفعيل');

  // عام + دخول
  let r = await call('GET', '/api/ping', null, null); eq(r.s, 200, 'ping'); eq(r.j.app, 'restaurant-pos-waiter', 'هوية التطبيق');
  r = await call('GET', '/api/staff', null, null); const names = r.j.staff.map((x) => x.name);
  ok(names.includes('سالم') && names.includes('كاشير1') && !names.includes('طباخ') && !names.includes('محاسب1'), 'قائمة الموظفين: من لهم صلاحية الطلبات فقط');
  r = await call('GET', '/api/menu', null, null); eq(r.s, 401, 'المنيو يحتاج دخولاً');
  r = await login('سالم', '0000'); eq(r.s, 401, 'رمز خاطئ'); ok(/غير صحيح/.test(r.j.error), 'رسالة الرمز الخاطئ');
  eq(auth.current().name, 'المالك', 'فشل دخول النادل لا يُخرج مستخدم الشاشة');
  r = await login('طباخ', '3333'); ok(r.s === 403, 'دور المطبخ لا يدخل التطبيق ' + r.s);
  r = await login('سالم', '2222'); eq(r.s, 200, 'دخول النادل'); token = r.j.token; ok(token && token.length >= 40, 'رمز جلسة طويل');
  eq(auth.current().name, 'المالك', 'دخول النادل لا يغيّر جلسة الشاشة');
  r = await call('GET', '/api/menu', null, 'x'.repeat(43)); eq(r.s, 401, 'رمز مزيّف');

  // المنيو
  r = await call('GET', '/api/menu'); const m = r.j;
  eq(m.categories.map((c) => c.name).join(), 'مشروبات,وجبات', 'التصنيفات (الفارغ مستبعد)');
  ok(!m.items.some((i) => i.name === 'مخفي'), 'الصنف المخفي مستبعد');
  eq(m.items.find((i) => i.name === 'نافد').soldOut, true, 'نفد');
  const pz = m.items.find((i) => i.name === 'بيتزا'); eq(pz.variants.length, 2, 'الأنواع'); eq(pz.variants[1].priceCents, 4500, 'سعر النوع بالهللات');
  const tea = m.items.find((i) => i.name === 'شاي'); eq(tea.mods[0].required, true, 'خيار إجباري'); eq(tea.mods[0].options[1].priceCents, 100, 'سعر الخيار');
  eq(m.kitchen, true, 'المطبخ مفعّل');

  // طاولات
  r = await call('GET', '/api/tables'); eq(r.j.tables.length, 2, 'الطاولات'); eq(r.j.tables[0].status, 'free', 'فاضية');

  // طلب جديد وإرساله
  const lines1 = [{ itemId: tea.id, qty: 2, mods: [{ g: gSugar, o: 1 }] }, { itemId: pz.id, qty: 1, variantId: pz.variants[1].id }];
  r = await call('POST', '/api/orders', { tableId: T1.id, lines: lines1, clientId: 'cid-0001-aaaa' });
  eq(r.s, 200, 'إنشاء طلب'); ok(r.j.sent && r.j.tickets === 1, 'أُرسل للمطبخ'); const oid = r.j.order.id;
  eq(r.j.order.userName, 'سالم', 'الطلب باسم النادل لا باسم مستخدم الشاشة');
  eq(r.j.order.lines.length, 2, 'سطران'); eq(r.j.order.lines[0].sentQty, 2, 'sentQty'); eq(r.j.order.subtotalCents, 2 * 600 + 4500, 'المجموع');
  eq(kitchen.board().length, 1, 'تذكرة واحدة في المطبخ'); eq(kitchen.board()[0].tableLabel, 'T1', 'اسم الطاولة على التذكرة');
  eq(auth.current().name, 'المالك', 'جلسة الشاشة سليمة بعد الطلب');

  // إعادة إرسال بنفس clientId (انقطاع شبكة) لا تكرر
  r = await call('POST', '/api/orders', { tableId: T1.id, lines: lines1, clientId: 'cid-0001-aaaa' });
  eq(r.j.order.id, oid, 'نفس الطلب'); eq(r.j.order.lines[0].qty, 2, 'لا تكرار للكمية'); eq(kitchen.board().length, 1, 'لا تذكرة مكررة');

  // إضافة لنفس الطاولة: نفس الطلب، التذكرة الجديدة بالجديد فقط
  r = await call('POST', '/api/orders', { tableId: T1.id, lines: [{ itemId: tea.id, qty: 1, mods: [{ g: gSugar, o: 1 }] }, { itemId: byName('برغر').id, qty: 1, mods: [{ g: gExtra, o: 0 }, { g: gExtra, o: 1 }], note: 'بدون بصل' }], clientId: 'cid-0002-bbbb' });
  eq(r.s, 200, 'إضافة'); eq(r.j.order.id, oid, 'نفس طلب الطاولة'); eq(r.j.order.lines.find((l) => l.name === 'شاي').qty, 3, 'دمج الشاي المتطابق');
  eq(r.j.order.lines.find((l) => l.name === 'شاي').sentQty, 3, 'الشاي كله مرسل');
  const t2 = kitchen.board().filter((t) => t.batch === 2); eq(t2.length, 1, 'دفعة ثانية');
  eq(t2[0].items.map((i) => `${i.qty}x${i.name}`).sort().join(), '1xبرغر,1xشاي', 'الجديد فقط في الدفعة الثانية'); eq(t2[0].items.find((i) => i.name === 'برغر').note, 'بدون بصل', 'ملاحظة الصنف');
  eq(orders.list({ status: 'open' }).length, 1, 'طلب واحد مفتوح');

  // تحقق وأخطاء
  r = await call('POST', '/api/orders', { tableId: T2.id, lines: [{ itemId: tea.id, qty: 1 }] }); eq(r.s, 400, 'خيار إجباري ناقص'); ok(/السكر/.test(r.j.error), 'الرسالة تسمّي المجموعة: ' + r.j.error);
  r = await call('POST', '/api/orders', { tableId: T2.id, lines: [{ itemId: byName('نافد').id, qty: 1 }] }); eq(r.s, 400, 'صنف نافد'); ok(/نفد/.test(r.j.error), 'رسالة نفد');
  r = await call('POST', '/api/orders', { tableId: T2.id, lines: [{ itemId: tea.id, qty: 0, mods: [{ g: gSugar, o: 0 }] }] }); eq(r.s, 400, 'كمية صفر');
  r = await call('POST', '/api/orders', { tableId: 'nope', lines: [{ itemId: tea.id, qty: 1, mods: [{ g: gSugar, o: 0 }] }] }); eq(r.s, 400, 'طاولة غير موجودة');
  r = await call('POST', '/api/orders', { tableId: T2.id, lines: [] }); eq(r.s, 400, 'طلب فارغ');
  eq(orders.list({ status: 'open' }).length, 1, 'الأخطاء لا تنشئ طلبات');

  // سفري + إرسال يدوي
  r = await call('POST', '/api/orders', { type: 'takeaway', lines: [{ itemId: byName('برغر').id, qty: 2 }], send: false });
  eq(r.s, 200, 'سفري'); eq(r.j.sent, false, 'لم يُرسل (send=false)'); eq(r.j.order.type, 'takeaway', 'نوع سفري');
  const tk = r.j.order.id;
  r = await call('POST', `/api/orders/${tk}/send`, {}); eq(r.s, 200, 'إرسال لاحق'); eq(r.j.tickets, 1, 'تذكرة');
  r = await call('POST', `/api/orders/${tk}/send`, {}); eq(r.s, 400, 'لا جديد للإرسال'); ok(/لا توجد أصناف/.test(r.j.error), 'الرسالة');

  // طلب الحساب + قراءة الطلب + حالة الطاولة
  r = await call('POST', `/api/orders/${oid}/bill`, {}); eq(r.s, 200, 'طلب الحساب'); ok(r.j.order.billAt, 'billAt');
  r = await call('GET', '/api/tables'); eq(r.j.tables.find((t) => t.id === T1.id).status, 'bill', 'تنتظر الحساب'); eq(r.j.tables.find((t) => t.id === T1.id).orders[0].id, oid, 'طلب الطاولة');
  r = await call('GET', `/api/orders/${oid}`); eq(r.j.order.number > 1000, true, 'قراءة الطلب');
  r = await call('GET', '/api/orders/999999'); eq(r.s, 400, 'طلب غير موجود');

  // الجاهز والتقديم
  r = await call('GET', '/api/ready'); eq(r.j.tickets.length, 0, 'لا جاهز بعد');
  const tid = kitchen.board()[0].id; kitchen.bump(tid, 'ready');
  r = await call('GET', '/api/ready'); eq(r.j.tickets.length, 1, 'تذكرة جاهزة'); eq(r.j.tickets[0].tableLabel, 'T1', 'الطاولة'); eq(r.j.tickets[0].items[0].name, 'شاي', 'الأصناف');
  r = await call('POST', `/api/tickets/${tid}/served`, {}); eq(r.s, 200, 'تم التقديم');
  r = await call('GET', '/api/ready'); eq(r.j.tickets.length, 0, 'اختفت بعد التقديم');
  r = await call('POST', `/api/tickets/${tid}/served`, {}); eq(r.s, 400, 'مرتين مرفوض');

  // خصم موضوع من الكاشير: النادل لا يضيف (حتى لا يضيع الخصم)
  const o2 = orders.save({ type: 'dine_in', tableId: T2.id, lines: [{ itemId: byName('برغر').id, qty: 1 }], discount: { type: 'percent', value: 10 } });
  r = await call('POST', '/api/orders', { tableId: T2.id, lines: [{ itemId: byName('برغر').id, qty: 1 }] }); eq(r.s, 409, 'طلب عليه خصم'); ok(/خصم/.test(r.j.error), 'رسالة الخصم');
  eq(orders.get(o2.id).discountCents > 0, true, 'الخصم محفوظ كما هو');

  // طلب مدفوع لا يُعدَّل
  orders.pay(o2.id, [{ method: 'cash', amount: orders.get(o2.id).totalCents / 100 }]);
  r = await call('POST', '/api/orders', { orderId: o2.id, lines: [{ itemId: byName('برغر').id, qty: 1 }] }); eq(r.s, 409, 'طلب مدفوع');

  // أدوار: المحاسب لا يدخل؛ تعطيل المستخدم يقطع جلسته؛ الخروج يلغي الرمز
  r = await login('محاسب1', '5555'); eq(r.s, 403, 'المحاسب لا يدخل');
  const cash = await login('كاشير1', '4444'); eq(cash.s, 200, 'الكاشير يدخل'); const ct = cash.j.token;
  auth.updateUser(U('كاشير1'), { active: false });
  r = await call('GET', '/api/menu', null, ct); eq(r.s, 401, 'تعطيل المستخدم يقطع جلسته');
  r = await call('POST', '/api/logout', {}); eq(r.s, 200, 'خروج'); r = await call('GET', '/api/menu'); eq(r.s, 401, 'الرمز بعد الخروج لا يعمل');

  // أمان
  token = (await login('سالم', '2222')).j.token;
  let big = await fetch(`https://127.0.0.1:${PORT}/api/orders`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [], pad: 'x'.repeat(70000) }) }); eq(big.status, 413, 'حجم كبير مرفوض');
  big = await fetch(`https://127.0.0.1:${PORT}/api/orders`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{bad' }); eq(big.status, 400, 'JSON فاسد');
  r = await call('GET', '/other'); eq(r.s, 404, 'مسار غير api');
  for (let k = 0; k < 6; k++) await login('سالم', '9999'); // قفل المحاولات على الحساب بعد 5
  r = await login('سالم', '2222'); eq(r.s, 401, 'قُفل الحساب بعد محاولات فاشلة'); ok(/انتظر/.test(r.j.error), 'رسالة القفل');
  ok(db.get().audit.some((a) => a.action === 'waiter_login' && a.userName === 'سالم'), 'سجل العمليات يحمل اسم النادل');

  // الإيقاف
  await wapi.setConfig({ enabled: false, port: PORT }); eq(wapi.status().running, false, 'إيقاف');
  eq(await fetch(`https://127.0.0.1:${PORT}/api/ping`).then(() => 'up', () => 'down'), 'down', 'لا استجابة بعد الإيقاف');
  done();
})().catch((e) => { console.error('خطأ غير متوقع', e); process.exit(1); });
