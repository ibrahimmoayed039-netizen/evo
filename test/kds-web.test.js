// شاشة المطبخ للمتصفح: صفحة /kds + مسارات /api/kds/* فوق الخادم الحقيقي (HTTPS)
const { ok, eq, done } = require('./harness');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), kitchen = require(S + 'kitchen');
const wapi = require(S + 'waiter-api');
db.init(); orders.init(':memory:'); require(S + 'shifts').init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
auth.createUser({ name: 'سالم', role: 'waiter', pin: '2222' });
auth.createUser({ name: 'طباخ', role: 'kitchen', pin: '3333' });
const U = (n) => db.get().users.find((u) => u.name === n).id;
kitchen.saveStation({ name: 'المطبخ' }); kitchen.saveStation({ name: 'مشروبات' });
menu.saveCategory({ name: 'وجبات', sort: 1 });
menu.saveItem({ categoryId: db.get().categories[0].id, name: 'برغر', price: 20 });
const burger = db.get().items[0].id;
const PORT = 45000 + Math.floor(Math.random() * 2000);
const call = async (m, p, body, tok) => {
  const r = await fetch(`https://127.0.0.1:${PORT}${p}`, { method: m, headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})), h: r.headers };
};
(async () => {
  wapi.init({ sendToKitchen: async (id) => ({ tickets: kitchen.send(id), printErrors: [] }) });
  await wapi.setConfig({ enabled: true, port: PORT });

  // الصفحة الثابتة بلا دخول وبسياسة أمان صارمة
  let r = await fetch(`https://127.0.0.1:${PORT}/kds`); const html = await r.text();
  eq(r.status, 200, '/kds يعمل'); ok(/text\/html/.test(r.headers.get('content-type')) && html.includes('/kds.js'), 'صفحة HTML تشير للسكربت');
  ok(/script-src 'self'/.test(r.headers.get('content-security-policy')) && r.headers.get('x-frame-options') === 'DENY', 'CSP صارم');
  r = await fetch(`https://127.0.0.1:${PORT}/kds.js`); ok(/javascript/.test(r.headers.get('content-type')) && (await r.text()).includes('/api/kds/board'), 'السكربت يُقدَّم');
  r = await fetch(`https://127.0.0.1:${PORT}/kds-secret`); eq(r.status, 404, 'مسار غير موجود 404');

  // قوائم الموظفين والدخول
  r = await call('GET', '/api/staff?kds=1'); eq(r.j.staff.map((x) => x.name).join(), 'المالك,طباخ', 'قائمة المطبخ: من لهم kitchen.view (والمالك)');
  r = await call('GET', '/api/staff'); ok(!r.j.staff.some((x) => x.name === 'طباخ'), 'قائمة النادل لا تتغير');
  r = await call('POST', '/api/login', { id: U('سالم'), pin: '2222', kds: true }); eq(r.s, 403, 'النادل لا يدخل شاشة المطبخ');
  r = await call('POST', '/api/login', { id: U('طباخ'), pin: '3333' }); eq(r.s, 403, 'دور المطبخ لا يدخل تطبيق النادل (كما كان)');
  r = await call('POST', '/api/login', { id: U('طباخ'), pin: '3333', kds: true }); eq(r.s, 200, 'دخول المطبخ'); const kt = r.j.token;
  r = await call('POST', '/api/login', { id: U('سالم'), pin: '2222' }); const wt = r.j.token;

  // عزل الجلسات
  r = await call('GET', '/api/menu', null, kt); eq(r.s, 403, 'جلسة المطبخ لا تصل للمنيو');
  r = await call('POST', '/api/orders', { type: 'takeaway', lines: [] }, kt); eq(r.s, 403, 'جلسة المطبخ لا تنشئ طلبات');
  r = await call('GET', '/api/kds/board', null, wt); eq(r.s, 403, 'النادل بلا kitchen.view لا يرى اللوحة');
  r = await call('GET', '/api/kds/board', null, null); eq(r.s, 401, 'اللوحة تحتاج دخولاً');

  // اللوحة والإجراءات
  const o = orders.save({ type: 'takeaway', lines: [{ itemId: burger, qty: 2 }] }); kitchen.send(o.id);
  r = await call('GET', '/api/kds/board', null, kt); eq(r.s, 200, 'اللوحة'); eq(r.j.stations.length, 2, 'المحطات'); eq(r.j.tickets.length, 1, 'تذكرة واحدة'); ok(r.j.now && r.j.tickets[0].items[0].qty === 2, 'التفاصيل + وقت الخادم');
  const id = r.j.tickets[0].id, sid = r.j.tickets[0].stationId;
  r = await call('GET', '/api/kds/board?station=' + encodeURIComponent(sid), null, kt); eq(r.j.tickets.length, 1, 'تصفية بالمحطة');
  r = await call('GET', '/api/kds/board?station=none', null, kt); eq(r.j.tickets.length, 0, 'محطة أخرى فارغة');
  r = await call('POST', `/api/kds/tickets/${id}/start`, null, kt); eq(r.j.ticket.status, 'preparing', 'بدء');
  r = await call('POST', `/api/kds/tickets/${id}/ready`, null, kt); eq(r.j.ticket.status, 'ready', 'جاهز');
  r = await call('POST', `/api/kds/tickets/${id}/hack`, null, kt); eq(r.s, 400, 'إجراء مجهول مرفوض');
  r = await call('POST', `/api/kds/tickets/${id}/start`, null, kt); eq(r.s, 400, 'انتقال غير صالح مرفوض');
  r = await call('POST', `/api/kds/tickets/${id}/done`, null, kt); eq(r.j.ticket.status, 'done', 'تم التسليم');
  r = await call('GET', '/api/kds/board', null, kt); eq(r.j.tickets.length, 0, 'المسلَّمة تختفي');

  // زر «نفد»
  const o2 = orders.save({ type: 'takeaway', lines: [{ itemId: burger, qty: 1 }] }); kitchen.send(o2.id);
  r = await call('GET', '/api/kds/board', null, kt); const ti = r.j.tickets.find((x) => x.orderId === o2.id).items[0]; ok(ti.itemId === burger && ti.soldOut === false, 'العنصر يحمل itemId وsoldOut');
  r = await call('POST', '/api/kds/soldout', { itemId: burger, soldOut: true }, kt); eq(r.s, 200, 'نفد'); eq(db.get().items[0].soldOut, true, 'ظهر في المنيو');
  r = await call('GET', '/api/kds/board', null, kt); ok(r.j.tickets.find((x) => x.orderId === o2.id).items[0].soldOut === true, 'اللوحة تعرضه نافداً');
  r = await call('GET', '/api/menu', null, wt); ok(r.j.items.find((i) => i.id === burger).soldOut === true, 'النادل يرى النفاد فوراً');
  r = await call('POST', '/api/kds/soldout', { itemId: burger, soldOut: false }, kt); eq(db.get().items[0].soldOut, false, 'أُعيد');
  r = await call('POST', '/api/kds/soldout', { itemId: 5, soldOut: true }, kt); eq(r.s, 400, 'نوع بيانات خاطئ');
  r = await call('POST', '/api/kds/soldout', { itemId: 'nope', soldOut: true }, kt); eq(r.s, 400, 'صنف مجهول');
  r = await call('POST', '/api/kds/soldout', { itemId: burger, soldOut: true }, wt); eq(r.s, 403, 'النادل لا يوقف الأصناف من هنا');

  // إلغاء المطبخ لصنف + تنبيه النادل
  menu.saveItem({ categoryId: db.get().categories[0].id, name: 'سلطة', price: 9 }); const salad = db.get().items.find((i) => i.name === 'سلطة').id;
  const o3 = orders.save({ type: 'takeaway', lines: [{ itemId: burger, qty: 1 }, { itemId: salad, qty: 2 }] }); kitchen.send(o3.id);
  r = await call('GET', '/api/kds/board', null, kt); const t3 = r.j.tickets.find((x) => x.orderId === o3.id);
  r = await call('POST', `/api/kds/tickets/${t3.id}/reject`, { index: 0, reason: 'ما' }, kt); eq(r.s, 400, 'سبب غير معروف مرفوض');
  r = await call('POST', `/api/kds/tickets/${t3.id}/reject`, { index: 'x', reason: 'نفد' }, kt); eq(r.s, 400, 'فهرس غير صالح');
  r = await call('POST', `/api/kds/tickets/${t3.id}/reject`, { index: 0, reason: 'نفد' }, wt); eq(r.s, 403, 'النادل لا يلغي من المطبخ');
  r = await call('GET', '/api/alerts', null, wt); eq(r.j.alerts.length, 0, 'لا تنبيهات قبل الإلغاء');
  r = await call('POST', `/api/kds/tickets/${t3.id}/reject`, { index: 1, reason: 'نفد' }, kt); eq(r.s, 200, 'إلغاء صنف'); ok(r.j.ticket.items[1].rejected?.reason === 'نفد', 'التذكرة تعلّمه');
  eq(orders.get(o3.id).lines.length, 1, 'خرج من الفاتورة');
  r = await call('GET', '/api/alerts', null, wt); eq(r.j.alerts.length, 1, 'النادل يرى التنبيه'); const al = r.j.alerts[0];
  ok(al.itemName === 'سلطة' && al.qty === 2 && al.reason === 'نفد' && al.orderNumber === o3.number, 'تفاصيل التنبيه');
  r = await call('GET', '/api/alerts', null, kt); eq(r.s, 403, 'جلسة المطبخ لا تقرأ تنبيهات النادل');
  r = await call('POST', `/api/alerts/${al.id}/ack`, null, wt); eq(r.s, 200, 'تأكيد الاستلام');
  r = await call('GET', '/api/alerts', null, wt); eq(r.j.alerts.length, 0, 'يختفي بعد التأكيد');

  // خروج
  r = await call('POST', '/api/logout', null, kt); eq(r.s, 200, 'خروج'); r = await call('GET', '/api/kds/board', null, kt); eq(r.s, 401, 'الرمز لاغٍ بعد الخروج');
  await wapi.stop(); done();
})().catch((e) => { console.log('✗', e); process.exit(1); });
