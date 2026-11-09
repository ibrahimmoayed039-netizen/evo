// تشفير تطبيق النادل (HTTPS بشهادة ذاتية)، صور الأصناف، والعثور التلقائي على الكاشير (UDP)
const { ok, eq, done } = require('./harness');
const S = '../src/main/';
const https = require('https'), http = require('http'), dgram = require('dgram'), crypto = require('crypto');
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), kitchen = require(S + 'kitchen');
const wapi = require(S + 'waiter-api'), disc = require(S + 'waiter-discovery'), tlsCert = require(S + 'tls-cert');
db.init(); orders.init(':memory:'); require(S + 'shifts').init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
auth.createUser({ name: 'سالم', role: 'waiter', pin: '2222' });
const UID = db.get().users.find((u) => u.name === 'سالم').id;

const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8AARAAGgAH/9cB5uQAAAABJRU5ErkJggg==';
menu.saveCategory({ name: 'وجبات', sort: 1 }); menu.saveCategory({ name: 'مخفية', sort: 2 });
const [cA, cB] = db.get().categories.map((c) => c.id);
menu.saveItem({ categoryId: cA, name: 'برغر', price: 20, image: PNG1 });
menu.saveItem({ categoryId: cA, name: 'بلا صورة', price: 5 });
menu.saveItem({ categoryId: cA, name: 'معطّل', price: 5, image: PNG1, active: false });
menu.saveItem({ categoryId: cB, name: 'في مخفي', price: 5, image: PNG1 });
db.get().categories.find((c) => c.id === cB).active = false;
const I = (n) => db.get().items.find((i) => i.name === n);

const PORT = 45000 + Math.floor(Math.random() * 1500), DPORT = PORT + 2000;
// عميل يحاكي منطق التطبيق: يقبل الاتصال فقط إن طابقت بصمة الشهادة المتوقعة
const get = (path, { token, pin, method = 'GET', body } = {}) => new Promise((res, rej) => {
  const r = https.request({ host: '127.0.0.1', port: PORT, path, method, rejectUnauthorized: false, agent: false, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (rs) => {
    const fp = rs.socket.getPeerCertificate().fingerprint256.replace(/:/g, '').toLowerCase();
    if (pin && fp !== pin) { rs.destroy(); return rej(new Error('PIN_MISMATCH')); }
    const ch = []; rs.on('data', (c) => ch.push(c)); rs.on('end', () => res({ s: rs.statusCode, h: rs.headers, b: Buffer.concat(ch), fp }));
  });
  r.on('error', rej); r.end(body ? JSON.stringify(body) : undefined);
});
const json = (r) => { try { return JSON.parse(r.b.toString('utf8')); } catch { return {}; } };
const ask = (port, msg, wait = 500) => new Promise((res) => {
  const s = dgram.createSocket('udp4'); const got = [];
  s.on('message', (m) => got.push(m.toString('utf8')));
  s.send(Buffer.from(msg), port, '127.0.0.1', () => setTimeout(() => { s.close(); res(got); }, wait));
});

(async () => {
  wapi.init({ sendToKitchen: async (id) => ({ tickets: kitchen.send(id), printErrors: [] }) });
  db.get().settings.waiterApi = { enabled: false, port: PORT, discoveryPort: DPORT };
  await wapi.setConfig({ enabled: true, port: PORT });
  ok(wapi.status().running, 'يعمل');

  // ---- التشفير ----
  const fp = tlsCert.load().fp, inf = wapi.info();
  ok(/^[0-9a-f]{64}$/.test(fp), 'بصمة SHA-256 من 64 خانة');
  eq(inf.tls.fp, fp, 'info تعرض بصمة الشهادة');
  ok(/^[0-9A-F]{4}( [0-9A-F]{4}){4}$/.test(inf.tls.pretty) && inf.tls.pretty.replace(/ /g, '') === fp.slice(0, 20).toUpperCase(), 'شكل البصمة المعروضة (20 خانة)');
  let r = await get('/api/ping', { pin: fp }); eq(r.s, 200, 'ping عبر HTTPS ببصمة صحيحة'); eq(json(r).fp, fp, 'ping تعيد نفس البصمة');
  eq(r.fp, fp, 'بصمة الشهادة المستلمة في المصافحة = المخزنة');
  let bad = await get('/api/ping', { pin: 'a'.repeat(64) }).then(() => 'ok', (e) => e.message); eq(bad, 'PIN_MISMATCH', 'بصمة مختلفة = رفض (منطق التثبيت)');
  const plain = await new Promise((res) => { const q = http.get({ host: '127.0.0.1', port: PORT, path: '/api/ping', timeout: 1500 }, (rs) => { rs.resume(); res('answered ' + rs.statusCode); }); q.on('error', () => res('failed')); q.on('timeout', () => { q.destroy(); res('failed'); }); });
  eq(plain, 'failed', 'طلب HTTP عادي على المنفذ لا يُجاب (لا نص صريح)');
  const x = new crypto.X509Certificate(tlsCert.load().cert);
  ok(x.verify(x.publicKey) && !x.ca && new Date(x.validTo) > new Date(Date.now() + 5 * 365 * 864e5), 'شهادة سليمة التوقيع وليست CA وصالحة سنوات');
  eq(tlsCert.load().fp, fp, 'الشهادة ثابتة عبر الاستدعاءات (تُحفظ على القرص)');

  // ---- الدخول + صور الأصناف ----
  r = await get('/api/login', { method: 'POST', body: { id: UID, pin: '2222' } }); eq(r.s, 200, 'دخول'); const token = json(r).token;
  r = await get('/api/menu', { token }); const m = json(r);
  const byN = (n) => m.items.find((i) => i.name === n);
  ok(/^\/api\/img\/[A-Za-z0-9-]+\?v=[0-9a-f]{12}$/.test(byN('برغر').image), 'رابط صورة بنسخة: ' + byN('برغر').image);
  eq(byN('بلا صورة').image, null, 'صنف بلا صورة: null');
  ok(!byN('معطّل') && !byN('في مخفي'), 'المعطّل وتصنيف المخفي لا يظهران');
  const url1 = byN('برغر').image;
  r = await get(url1.split('?')[0]); eq(r.s, 401, 'الصورة تحتاج جلسة');
  r = await get(url1, { token }); eq(r.s, 200, 'الصورة بجلسة'); eq(r.h['content-type'], 'image/png', 'نوع الصورة');
  ok(r.b.equals(Buffer.from(PNG1.split(',')[1], 'base64')), 'بايتات الصورة مطابقة');
  ok(/private/.test(r.h['cache-control']) && /max-age/.test(r.h['cache-control']), 'تخزين مؤقت خاص'); eq(r.h['x-content-type-options'], 'nosniff', 'nosniff');
  r = await get('/api/img/nope', { token }); eq(r.s, 404, 'معرّف غير موجود');
  r = await get(`/api/img/${I('بلا صورة').id}`, { token }); eq(r.s, 404, 'صنف بلا صورة 404');
  r = await get(`/api/img/${I('معطّل').id}`, { token }); eq(r.s, 404, 'صنف معطّل 404');
  r = await get(`/api/img/${I('في مخفي').id}`, { token }); eq(r.s, 404, 'تصنيف مخفي 404');
  r = await get('/api/img/..%2f..%2fdata', { token }); eq(r.s, 404, 'محاولة اجتياز مسار');
  menu.saveItem({ id: I('برغر').id, categoryId: cA, name: 'برغر', price: 20, image: PNG2 });
  const url2 = json(await get('/api/menu', { token })).items.find((i) => i.name === 'برغر').image;
  ok(url2 !== url1 && url2.split('?')[0] === url1.split('?')[0], 'تغيير الصورة يغيّر رقم النسخة فيتجدد التخزين في التطبيق');
  r = await get(url2, { token }); ok(r.b.equals(Buffer.from(PNG2.split(',')[1], 'base64')), 'الصورة الجديدة تُخدم');

  // ---- العثور التلقائي ----
  eq(wapi.info().discovery.running, true, 'البحث التلقائي يعمل مع الخادم'); eq(wapi.info().discovery.port, DPORT, 'منفذ البحث');
  let a = await ask(DPORT, disc.MAGIC); eq(a.length, 1, 'ردّ واحد على البث'); const d = JSON.parse(a[0]);
  ok(d.app === 'restaurant-pos-waiter' && d.port === PORT && d.fp === fp && typeof d.name === 'string', 'الرد: التطبيق والمنفذ والبصمة والاسم');
  ok(!/pin|token|key/i.test(a[0].replace('restaurant-pos-waiter', '')), 'لا أسرار في الرد');
  eq((await ask(DPORT, 'hello')).length, 0, 'رسالة غريبة لا تُجاب'); eq((await ask(DPORT, 'x'.repeat(500))).length, 0, 'رسالة كبيرة لا تُجاب');
  let n = 0; for (let i = 0; i < 40; i++) n += (await ask(DPORT, disc.MAGIC, 15)).length;
  ok(n <= 30, 'حد المعدل للردود: ' + n);

  // ---- إعادة إنشاء الشهادة ----
  const info2 = await wapi.regenerateCert();
  ok(info2.tls.fp !== fp && info2.status.running && info2.discovery.running, 'شهادة جديدة والخادم يعمل');
  r = await get('/api/menu', { token }); eq(r.s, 401, 'الجلسات القديمة فُصلت');
  r = await get('/api/ping', { pin: info2.tls.fp }); eq(r.s, 200, 'الخادم يقدّم الشهادة الجديدة'); eq(r.fp, info2.tls.fp, 'البصمة الجديدة في المصافحة');
  bad = await get('/api/ping', { pin: fp }).then(() => 'ok', (e) => e.message); eq(bad, 'PIN_MISMATCH', 'البصمة القديمة تُرفض الآن');

  // ---- الإيقاف ومنفذ بحث مشغول ----
  await wapi.setConfig({ enabled: false, port: PORT });
  eq((await ask(DPORT, disc.MAGIC)).length, 0, 'لا ردّ بعد الإيقاف'); eq(wapi.info().discovery.running, false, 'البحث متوقف');
  const blocker = dgram.createSocket('udp4'); await new Promise((res) => blocker.bind(DPORT, '0.0.0.0', res)); // ربط حصري
  await wapi.setConfig({ enabled: true, port: PORT });
  ok(wapi.status().running, 'الخادم يعمل رغم انشغال منفذ البحث'); ok(/منفذ البحث/.test(wapi.info().discovery.error), 'رسالة خطأ البحث: ' + wapi.info().discovery.error);
  eq((await get('/api/ping')).s, 200, 'الإدخال اليدوي للعنوان يبقى ممكناً');
  blocker.close(); await wapi.stop();
  done();
})().catch((e) => { console.log('✗ استثناء', e); process.exit(1); });
