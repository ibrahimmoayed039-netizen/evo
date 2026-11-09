// منيو QR: خادم HTTP حقيقي على منفذ محلي + اختبارات الأمان والمحتوى وورقة الطباعة
const { ok, eq, done } = require('./harness');
const net = require('net');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), tables = require(S + 'tables'), orders = require(S + 'orders');
const qrmenu = require(S + 'qrmenu'), qr = require(S + 'qr'), { buildQrSheetHTML } = require(S + 'receipt'), { can } = require(S + 'permissions');
db.init(); orders.init(':memory:');
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
menu.saveCategory({ name: 'مشروبات', sort: 1 }); menu.saveCategory({ name: 'فارغ', sort: 2 }); menu.saveCategory({ name: 'حلويات', sort: 3 });
const [cDrink, cEmpty, cSweet] = db.get().categories.map((c) => c.id);
menu.saveGroup({ name: 'الحجم', options: [{ name: 'كبير', price: 3 }, { name: 'صغير', price: 0 }] });
const g = db.get().modGroups[0].id;
menu.saveItem({ categoryId: cDrink, name: 'لاتيه <b>', price: 10, image: PNG, modifierGroupIds: [g] });
menu.saveItem({ categoryId: cDrink, name: 'مخفي', price: 5, active: false });
menu.saveItem({ categoryId: cSweet, name: 'كيك', price: 15 });
const [latte, , cake] = db.get().items.map((i) => i.id);
menu.setSoldOut(cake, true);
const T1 = tables.save({ name: 'T1', seats: 4 });
const PORT = 41000 + Math.floor(Math.random() * 2000);
const get = async (p, o) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, o); return { r, t: r.headers.get('content-type') || '', b: Buffer.from(await r.arrayBuffer()) }; };
const rejects = async (fn, re, m) => { try { await fn(); ok(false, m + ' (لم يرمِ)'); } catch (e) { ok(re.test(e.message), `${m}: ${e.message}`); } };

(async () => {
  // الإعدادات والتحقق
  eq(qrmenu.cfg().enabled, false, 'معطّل افتراضياً'); eq(qrmenu.status().running, false, 'الخادم متوقف افتراضياً');
  await rejects(() => qrmenu.setConfig({ enabled: true, port: 80 }), /المنفذ/, 'منفذ نظامي مرفوض');
  await rejects(() => qrmenu.setConfig({ enabled: true, port: 'x' }), /المنفذ/, 'منفذ غير رقمي');
  await rejects(() => qrmenu.setConfig({ enabled: true, port: PORT, host: 'a b' }), /العنوان/, 'عنوان بمسافة');
  await rejects(() => qrmenu.setConfig({ enabled: true, port: PORT, host: 'مطعم.com' }), /العنوان/, 'عنوان عربي');
  eq(qrmenu.status().running, false, 'الإعدادات الخاطئة لا تشغّل الخادم');
  const i1 = await qrmenu.setConfig({ enabled: true, port: PORT, showPrices: true, host: '192.168.1.50' });
  ok(i1.status.running && i1.status.port === PORT, 'الخادم يعمل بعد التفعيل');

  // المحتوى
  let x = await get(`/api/menu?t=${T1.id}`); const j = JSON.parse(x.b.toString());
  eq(x.r.status, 200, 'API المنيو'); eq(j.table, 'T1', 'اسم الطاولة'); eq(j.items.length, 2, 'الأصناف الفعّالة فقط (المخفي مستبعد)');
  eq(j.categories.map((c) => c.name).join(), 'مشروبات,حلويات', 'التصنيف الفارغ مستبعد ومرتّب');
  const l = j.items.find((i) => i.id === latte); eq(l.price, 1000, 'السعر بالهللات'); eq(l.image, `/img/${latte}`, 'الصورة برابط لا data URL'); eq(l.mods[0].options[0].price, 300, 'سعر الإضافة');
  eq(j.items.find((i) => i.id === cake).soldOut, true, 'نفد');
  const raw = x.b.toString();
  ok(!/stationId|modifierGroupIds|pin|salt|hash|users|audit|data:image/i.test(raw), 'لا تسرّب حقول داخلية ولا data URL'); eq(j.vatPercent, 15, 'نسبة الضريبة للملاحظة');
  eq(JSON.parse((await get('/api/menu?t=nope')).b.toString()).table, null, 'طاولة مجهولة: بلا اسم');
  eq(JSON.parse((await get('/api/menu?t=' + encodeURIComponent('../x'))).b.toString()).table, null, 'معرّف غير صالح يُتجاهل');

  // الصفحات والملفات
  x = await get(`/m/${T1.id}`); eq(x.r.status, 200, 'صفحة الطاولة'); ok(x.t.startsWith('text/html') && x.b.toString().includes('/menu.js'), 'HTML يحمّل السكربت');
  const csp = x.r.headers.get('content-security-policy'); ok(/script-src 'self'/.test(csp) && /default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), 'CSP صارم'); eq(x.r.headers.get('x-content-type-options'), 'nosniff', 'nosniff');
  eq((await get('/')).r.status, 200, 'الصفحة العامة'); x = await get('/menu.js'); ok(x.r.status === 200 && x.t.includes('javascript') && !/innerHTML/.test(x.b.toString()), 'السكربت بلا innerHTML');
  x = await get(`/img/${latte}`); ok(x.r.status === 200 && x.t === 'image/png' && x.b.length > 20, 'الصورة تُخدم بنوعها');
  eq((await get(`/img/${cake}`)).r.status, 404, 'صنف بلا صورة 404'); eq((await get('/img/nope')).r.status, 404, 'صورة مجهولة'); eq((await get('/img/..%2Fdata.json')).r.status, 404, 'تجاوز المسار في الصور');
  for (const p of ['/data.json', '/../data.json', '/m/../data.json', '/m/a/b', '/api/users', '/orders.db']) eq((await get(p)).r.status, 404, 'مسار غير معروف ' + p);
  x = await get('/api/menu', { method: 'POST', body: '{}' }); eq(x.r.status, 405, 'POST مرفوض'); eq((await get('/', { method: 'HEAD' })).r.status, 200, 'HEAD مسموح');

  // التحديث المباشر لحالة النفاد وإخفاء الأسعار
  menu.setSoldOut(cake, false); eq(JSON.parse((await get('/api/menu')).b.toString()).items.find((i) => i.id === cake).soldOut, false, 'تحديث النفاد يظهر فوراً');
  await qrmenu.setConfig({ enabled: true, port: PORT, showPrices: false, host: '192.168.1.50' });
  const np = JSON.parse((await get('/api/menu')).b.toString()); ok(np.items.every((i) => i.price === null && i.mods.every((m) => m.options.every((o) => o.price === null))), 'بلا أسعار حين تُعطَّل'); eq(np.showPrices, false, 'علَم الأسعار');

  // رموز QR والروابط
  const info = qrmenu.info(); eq(info.links.length, 2, 'رمز عام + طاولة'); eq(info.links[0].url, 'http://192.168.1.50:' + PORT + '/', 'رابط عام بالعنوان المخصص'); eq(info.links[1].url, `http://192.168.1.50:${PORT}/m/${T1.id}`, 'رابط الطاولة');
  ok(info.links[1].svg.startsWith('<svg') && info.links[1].svg.includes('<path') && !/<script|onload/i.test(info.links[1].svg), 'SVG سليم');
  const m = qr.matrix('http://192.168.1.50:3737/m/abc'); ok(m.length >= 21 && m.length === m[0].length, 'مصفوفة QR مربعة');
  try { qr.matrix('مرحبا'); ok(false, 'نص غير ASCII'); } catch (e) { ok(/ASCII/.test(e.message), 'نص غير ASCII مرفوض'); }
  const sheet = buildQrSheetHTML([{ name: '<T1>', url: 'http://x/m/1', svg: '<svg></svg>' }], { width: 58, restaurant: 'مطعم' });
  ok(sheet.includes('width:58mm') && sheet.includes('&lt;T1&gt;') && sheet.includes('امسح الرمز') && sheet.includes('<svg>'), 'ورقة الطباعة (هروب + عرض 58)');
  require('fs').writeFileSync(require('path').join(require('./harness').tmp, 'qr.svg'), info.links[1].svg); console.log('QR_SVG=' + require('path').join(require('./harness').tmp, 'qr.svg'));

  // الصلاحيات
  ok(can('owner', 'qrmenu') && can('manager', 'qrmenu') && !can('cashier', 'qrmenu') && !can('accountant', 'qrmenu') && !can('kitchen', 'qrmenu'), 'صلاحية qrmenu للمالك والمدير فقط');

  // حد المعدل
  let c429 = 0; for (let k = 0; k < 140; k++) if ((await get('/api/menu')).r.status === 429) c429++;
  ok(c429 > 0, 'حد المعدل يرفض الإفراط (' + c429 + ' طلباً مرفوضاً)');

  // إيقاف
  await qrmenu.setConfig({ enabled: false, port: PORT, showPrices: true, host: '' });
  eq(qrmenu.status().running, false, 'الإيقاف'); try { await get('/'); ok(false, 'يجب أن ينقطع الاتصال'); } catch { ok(true, 'الاتصال مرفوض بعد الإيقاف'); }

  // منفذ مشغول
  const blocker = net.createServer().listen(PORT + 5000, '0.0.0.0'); await new Promise((r) => blocker.once('listening', r));
  const bi = await qrmenu.setConfig({ enabled: true, port: PORT + 5000, showPrices: true, host: '' });
  ok(!bi.status.running && /مستخدم/.test(bi.status.error), 'منفذ مشغول: خطأ مفهوم بلا انهيار'); blocker.close();
  await qrmenu.setConfig({ enabled: false, port: PORT, showPrices: true, host: '' }); await qrmenu.stop();
  done();
})().catch((e) => { console.log('✗ استثناء: ' + e.stack); process.exit(1); });
