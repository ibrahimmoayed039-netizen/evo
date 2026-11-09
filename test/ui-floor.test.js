// اختبار دخان لمخطط الصالة المرئي (أشكال، كراسي، ألوان الحالات، عدّاد المدة، طلب الحساب) على DOM وهمي مع واجهة خلفية حقيقية
const { ok, eq, done } = require('./harness');
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), tables = require(S + 'tables');
db.init(); orders.init(':memory:'); shifts.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'وجبات', sort: 1 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'برجر', price: 50 }); const burger = db.get().items[0].id, L = [{ itemId: burger, qty: 1 }];
const sq = tables.save({ name: 'مربعة <b>', seats: 4, shape: 'square', size: 'm', x: 20, y: 30 }), rd = tables.save({ name: 'دائرية', seats: 6, shape: 'round', size: 'l', x: 50, y: 30 }), rc = tables.save({ name: 'مستطيلة', seats: 20, shape: 'rect', size: 's', x: 80, y: 30 });
const ob = orders.save({ type: 'dine_in', tableId: sq.id, lines: L }), oc = orders.save({ type: 'dine_in', tableId: rd.id, lines: L }); orders.requestBill(oc.id);
orders.raw().prepare('UPDATE orders SET created_at=? WHERE id=?').run(new Date(Date.now() - 95 * 60000).toISOString(), oc.id); // جلوس منذ 95 دقيقة

const stub = () => {
  const store = {}, cl = { add() {}, remove() {}, toggle() {} };
  return new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : k in store ? store[k] : k === 'value' ? '' : k === 'classList' ? cl : k === 'style' ? {} : k === 'querySelectorAll' ? () => [] : k === 'querySelector' ? () => stub() : stub()), set: (t, k, v) => { store[k] = v; return true; }, apply: () => stub() });
};
const els = {}, dlg = { html: '' }, timers = [], cleared = [], flashes = []; let floorPresent = true, lastDlg = [];
const parse = (html, sel) => { const m = sel.match(/^\[data-([a-z]+)\]$/); if (!m) return []; const out = []; for (const t of html.match(/<(button|select|input|div|small)\b[^>]*>/g) || []) { if (!new RegExp(`\\sdata-${m[1]}=`).test(t)) continue; const ds = {}; for (const a of t.matchAll(/data-([a-z]+)="([^"]*)"/g)) ds[a[1]] = a[2]; out.push({ dataset: ds, textContent: '' }); } return out; };
const dlgEl = { set innerHTML(h) { dlg.html = h; }, get innerHTML() { return dlg.html; }, querySelectorAll: (sel) => (lastDlg = parse(dlg.html, sel)), querySelector: () => stub() };
const doc = { querySelectorAll: (sel) => (doc.last = parse(els.content?.innerHTML || '', sel)), getElementById: () => (floorPresent ? {} : null) };
const ctx = {
  document: doc, console, Promise, Date, Math, Number, confirm: () => true, setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval: (id) => cleared.push(id),
  $: (id) => (els[id] ||= stub()), esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  errMsg: (e) => e.message, can: () => true, money: (c) => (c / 100).toFixed(2),
  api: { tablesFloor: async () => tables.floor(), orderBill: async (id, on) => orders.requestBill(id, on), tableSave: async (t) => tables.save(t), orderGet: async (id) => orders.get(id) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/pos.js'), 'utf8'), ctx, { filename: 'pos.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/tables.js'), 'utf8'), ctx, { filename: 'tables.js' });
ctx.dlgOpen = (h) => { dlg.html = h; return dlgEl; }; ctx.dlgClose = () => {}; ctx.flash = (m) => flashes.push(m);
const clean = (h, m) => ok(h.length > 200 && !/undefined|NaN|\[object|Infinity/.test(h), m + ' بلا undefined/NaN');
const tick = () => new Promise((r) => setTimeout(r, 30));
const card = (h, name) => { const i = h.indexOf(name); const s = h.lastIndexOf('<div class="tbl', i); return h.slice(s, h.indexOf('</div>', i) + 6); };

(async () => {
  await ctx.viewTables(); let h = els.content.innerHTML; clean(h, 'المخطط');
  // الأشكال والأحجام
  ok(/class="tbl sq free/.test(card(h, 'مربعة')) === false, 'المربعة مشغولة وليست فاضية'); ok(card(h, 'مربعة').includes('tbl sq busy') && card(h, 'دائرية').includes('tbl rd bill') && card(h, 'مستطيلة').includes('tbl rc free'), 'شكل وحالة كل طاولة');
  ok(card(h, 'مربعة').includes('--s:1') && card(h, 'دائرية').includes('--s:1.25') && card(h, 'مستطيلة').includes('--s:0.85'), 'معامل الحجم');
  ok(h.includes('مربعة &lt;b&gt;') && !h.includes('مربعة <b>'), 'هروب HTML في اسم الطاولة');
  // الكراسي
  const chairs = (c) => (c.match(/class="ch"/g) || []).length; eq(chairs(card(h, 'مربعة')), 4, '4 كراسي'); eq(chairs(card(h, 'دائرية')), 6, '6 كراسي'); eq(chairs(card(h, 'مستطيلة')), 12, 'الحد الأقصى 12 كرسياً (20 مقعداً)');
  // العداد وطلب الحساب
  ok(card(h, 'مربعة').includes('data-since="' + ob.createdAt + '"') && card(h, 'مربعة').includes('⏱ 0 د'), 'عدّاد جلوس للمشغولة');
  const bc = card(h, 'دائرية'); ok(bc.includes('⏱ 1س 35د') && bc.includes('class="bl"') && bc.includes('🧾 0 د'), 'مدة الجلوس 1س 35د + مدة انتظار الحساب'); ok(!card(h, 'مربعة').includes('class="bl"'), 'المشغولة بلا شارة حساب'); ok(!card(h, 'مستطيلة').includes('data-since'), 'الفاضية بلا عدّاد');
  ok(card(h, 'مستطيلة').includes('20 مقاعد'), 'الفاضية تعرض عدد المقاعد');
  ok(h.includes('فاضية (1)') && h.includes('مشغولة (1)') && h.includes('تنتظر الحساب (1)') && h.includes('مقاعد مشغولة: 10 / 30'), 'ملخص الحالات والإشغال');
  // المؤقت
  eq(timers.length, 1, 'مؤقت واحد'); eq(timers[0].ms, 15000, 'تحديث كل 15 ثانية');
  const e1 = { dataset: { since: new Date(Date.now() - 125 * 60000).toISOString(), pre: '⏱ ' }, textContent: '' }; doc.querySelectorAll = () => [e1]; timers[0].fn(); eq(e1.textContent, '⏱ 2س 5د', 'العدّاد يتحدّث نصّه');
  await ctx.viewTables(); eq(timers.length, 2, 'إعادة الرسم تنشئ مؤقتاً جديداً'); eq(cleared.length >= 2, true, 'ويلغي السابق');
  floorPresent = false; const before = cleared.length; timers[1].fn(); ok(cleared.length > before, 'المؤقت يتوقف عند مغادرة الصفحة'); floorPresent = true; doc.querySelectorAll = (sel) => (doc.last = parse(els.content?.innerHTML || '', sel));
  // نافذة الطاولة وطلب الحساب
  const fl = tables.floor(), tSq = fl.find((t) => t.id === sq.id), tRd = fl.find((t) => t.id === rd.id);
  ctx.tableDialog(tSq, fl); ok(dlg.html.includes('جلوس منذ') && dlg.html.includes('طلب الحساب') && dlg.html.includes('data-on="1"') && !dlg.html.includes('تنتظر الحساب منذ'), 'نافذة المشغولة: زر طلب الحساب');
  const bl = dlgEl.querySelectorAll('[data-bl]')[0]; ok(bl && bl.dataset.bl === String(ob.id), 'زر الطلب مرتبط بالطلب');
  ctx.tableDialog(tRd, fl); ok(dlg.html.includes('تنتظر الحساب منذ') && dlg.html.includes('إلغاء طلب الحساب') && dlg.html.includes('data-on="0"') && dlg.html.includes('🧾 طلب الحساب'), 'نافذة المنتظرة: إلغاء الطلب وشارة');
  ctx.tableDialog(fl.find((t) => t.id === rc.id), fl); ok(dlg.html.includes('الطاولة فاضية') && !dlg.html.includes('data-bl'), 'الفاضية بلا زر حساب');
  // نافذة التعديل
  ctx.tableEditDialog(tRd, fl); ok(dlg.html.includes('id="teShape"') && dlg.html.includes('<option value="round" selected>') && dlg.html.includes('<option value="l" selected>'), 'حقل الشكل والحجم بقيمتهما الحالية');
  ctx.tableEditDialog(null, fl); ok(dlg.html.includes('<option value="square" selected>') && dlg.html.includes('<option value="m" selected>'), 'طاولة جديدة: مربعة متوسطة افتراضياً');
  // التنفيذ الفعلي عبر المعالج: طلب الحساب للمربعة
  ctx.tableDialog(tSq, fl); const click = dlgEl.querySelectorAll('[data-bl]')[0]; ok(!!click, 'العنصر موجود'); await ctx.api.orderBill(+click.dataset.bl, click.dataset.on === '1'); eq(tables.floor().find((t) => t.id === sq.id).status, 'bill', 'الطاولة صارت تنتظر الحساب');
  await ctx.viewTables(); h = els.content.innerHTML; ok(card(h, 'مربعة').includes('tbl sq bill') && h.includes('تنتظر الحساب (2)'), 'المخطط يعكس التغيير');
  // لا طاولات
  const keep = db.get().tables; db.get().tables = []; await ctx.viewTables(); ok(els.content.innerHTML.includes('لا توجد طاولات بعد'), 'رسالة لا طاولات'); db.get().tables = keep;
  done();
})().catch((e) => { console.log('✗ استثناء:', e); process.exit(1); });
