// اختبار دخان لواجهة التوصيل (اللوحة، السائقون، الأجور، الأسعار) وعرض أجرة التوصيل في الكاشير، على DOM وهمي مع واجهة خلفية حقيقية
const { ok, eq, done } = require('./harness');
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), reports = require(S + 'reports'), delivery = require(S + 'delivery');
db.init(); orders.init(':memory:'); shifts.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'وجبات', sort: 1 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'برجر', price: 50 });
const burger = db.get().items[0].id, today = reports.ymd(new Date()), L1 = [{ itemId: burger, qty: 1 }];
const zk = delivery.saveConfig({ baseFee: 5, freeOver: 0, zones: [{ name: 'الكرادة', fee: 8 }, { name: 'المنصور <i>', fee: 12 }] }).zones[0];
const drv = delivery.saveDriver({ name: 'حيدر <b>', phone: '0780', wageMode: 'fixed', wage: 3 });
shifts.open(100);
const mk = (name, extra = {}) => orders.save({ type: 'delivery', customer: { name, phone: '0770', address: 'شارع <u>1' }, lines: L1, ...extra });
const prep = mk('عميل-تجهيز', { zoneId: zk.id });
const way = mk('عميل-طريق'); delivery.assign(way.id, drv.id); delivery.setStatus(way.id, 'on_the_way');
const owed = mk('عميل-بذمة <b>'); delivery.assign(owed.id, drv.id); delivery.setStatus(owed.id, 'on_the_way'); delivery.setStatus(owed.id, 'delivered');
const done1 = mk('عميل-مدفوع'); delivery.assign(done1.id, drv.id); delivery.setStatus(done1.id, 'on_the_way'); delivery.setStatus(done1.id, 'delivered'); orders.pay(done1.id, [{ method: 'cash', amount: 100 }]);

const stub = () => {
  const store = {}, cl = { add() {}, remove() {}, toggle() {} };
  return new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k in store ? store[k] : k === 'value' ? '' : k === 'classList' ? cl : k === 'style' ? {} : k === 'querySelectorAll' ? () => [] : k === 'querySelector' ? () => stub() : stub()),
    set: (t, k, v) => { store[k] = v; return true; }, apply: () => stub(),
  });
};
const els = {}, last = {}, flashes = [];
// querySelectorAll وهمي: يبني عناصر من سمات data-* الموجودة في HTML الحالي ليمكن استدعاء معالجاتها
const qsa = (sel) => {
  const m = sel.match(/^\[data-([a-z]+)\]$/); if (!m) return [];
  const html = (els.dvBody?.innerHTML || '') + (els.content?.innerHTML || '') + (els.pFields?.innerHTML || ''), out = [];
  for (const t of html.match(/<(button|select|input)\b[^>]*>/g) || []) {
    if (!new RegExp(`\\sdata-${m[1]}=`).test(t)) continue;
    const ds = {}; for (const a of t.matchAll(/data-([a-z]+)="([^"]*)"/g)) ds[a[1]] = a[2];
    out.push({ dataset: ds, value: ds.to || '' });
  }
  return (last[sel] = out);
};
let canFn = () => true;
const ctx = {
  document: { querySelectorAll: qsa }, console, Promise, Date, Math, Number, setTimeout, confirm: () => true,
  $: (id) => (els[id] ||= stub()), esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  errMsg: (e) => e.message, can: (p) => canFn(p), money: (c) => (c / 100).toFixed(2), flash: (m) => flashes.push(m), resume() {},
  api: {
    deliveryBoard: async (f) => delivery.board(f), deliveryDrivers: async () => delivery.drivers(), deliveryAssign: async (id, d) => delivery.assign(id, d), deliveryStatus: async (id, to) => delivery.setStatus(id, to),
    deliveryReport: async (r) => delivery.report(r), deliveryConfig: async () => delivery.config(), deliverySaveConfig: async (c) => delivery.saveConfig(c), deliverySaveDriver: async (d) => delivery.saveDriver(d),
    deliveryRemoveDriver: async (id) => delivery.removeDriver(id), orderGet: async (id) => orders.get(id), orderQuote: async (p) => orders.quote(p),
  },
};
vm.createContext(ctx);
for (const f of ['pos.js', 'delivery.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', f), 'utf8'), ctx, { filename: f });
ctx.flash = (m) => flashes.push(m); // pos.js يعرّف flash حقيقية؛ نستبدلها بنسخة تلتقط الرسائل
const tick = () => new Promise((r) => setTimeout(r, 30));
const clean = (h, m) => ok(h.length > 100 && !/undefined|NaN|\[object|Infinity/.test(h), m + ' بلا undefined/NaN');
const tab = async (t) => { vm.runInContext(`DV.tab='${t}'; DV.edit=null`, ctx); await ctx.viewDelivery(); return els.dvBody.innerHTML; };

(async () => {
  // ---- اللوحة ----
  let h = await tab('board'); clean(h, 'اللوحة');
  ok(h.includes('قيد التجهيز') && h.includes('في الطريق') && h.includes('تم التسليم'), 'أعمدة الحالات الثلاثة');
  const colOf = (n) => { const i = h.indexOf('#' + n + '<'); return ['preparing', 'on_the_way', 'delivered'].filter((s) => h.lastIndexOf('dvcol ' + s, i) >= 0).pop(); };
  eq(colOf(prep.number), 'preparing', 'طلب التجهيز في عموده'); eq(colOf(way.number), 'on_the_way', 'طلب الطريق في عموده'); eq(colOf(owed.number), 'delivered', 'المسلَّم في عموده');
  ok(h.includes('عميل-بذمة &lt;b&gt;') && !h.includes('عميل-بذمة <b>') && h.includes('شارع &lt;u&gt;1') && h.includes('حيدر &lt;b&gt;'), 'هروب HTML في الاسم والعنوان والسائق');
  ok(h.includes('خرج للتوصيل') && h.includes('تم التسليم ✓') && h.includes('توصيل 8.00') && h.includes('الكرادة'), 'الأزرار والأجرة والمنطقة');
  ok(h.includes('⚠ مسلَّم وغير مدفوع') && h.split('⚠ مسلَّم وغير مدفوع').length === 2, 'تنبيه واحد فقط للمسلَّم غير المدفوع');
  ok(h.includes('data-as="' + prep.id + '"') && !h.includes('data-as="' + owed.id + '"'), 'اختيار السائق قبل التسليم فقط');
  // ---- الإجراءات عبر المعالجات ----
  const goBtn = (id) => ctx.document.querySelectorAll('[data-go]').find((b) => b.dataset.go === String(id));
  const hooked = (sel) => { const o = ctx.document.querySelectorAll(sel); return o; };
  // لا سائق → رسالة خطأ بدل الانهيار
  await ctx.viewDelivery(); ctx.document.querySelectorAll('[data-go]'); // يملأ last
  const clickGo = async (id) => { const b = last['[data-go]'].find((x) => x.dataset.go === String(id)); await b.onclick(); await tick(); };
  // المعالجات تُسند على الكائنات المُعادة من آخر استدعاء، لذا نعيد الرسم ثم نستدعي ما أُسند
  await ctx.viewDelivery(); await clickGo(prep.id); ok(/عيّن سائقاً/.test(els.dvErr.textContent), 'خروج بلا سائق يعرض الخطأ'); eq(orders.get(prep.id).deliveryStatus, 'preparing', 'الحالة لم تتغير');
  await ctx.viewDelivery(); const as = last['[data-as]'].find((x) => x.dataset.as === String(prep.id)); as.value = drv.id; await as.onchange(); await tick();
  eq(orders.get(prep.id).driverId, drv.id, 'تعيين السائق من القائمة');
  await ctx.viewDelivery(); await clickGo(prep.id); eq(orders.get(prep.id).deliveryStatus, 'on_the_way', 'زر «خرج للتوصيل»');
  await ctx.viewDelivery(); await clickGo(prep.id); eq(orders.get(prep.id).deliveryStatus, 'delivered', 'زر «تم التسليم»'); ok(orders.get(prep.id).driverWageCents === 300, 'أجر السائق مثبّت');
  // ---- غير المدير: اللوحة فقط ----
  canFn = (p) => p !== 'delivery.manage'; await ctx.viewDelivery();
  ok(els.content.innerHTML.includes('لوحة التوصيل') && !els.content.innerHTML.includes('أجور السائقين') && !els.content.innerHTML.includes('data-dvt="pricing"'), 'الكاشير يرى اللوحة فقط');
  vm.runInContext("DV.tab='drivers'", ctx); await ctx.viewDelivery(); ok(vm.runInContext('DV.tab', ctx) === 'board', 'التبويب المقيّد يعود للوحة'); canFn = () => true;
  // ---- السائقون ----
  h = await tab('drivers'); clean(h, 'السائقون'); ok(h.includes('حيدر &lt;b&gt;') && h.includes('3.00 لكل توصيلة') && h.includes('data-dd='), 'قائمة السائقين وأجرهم وزر الحذف');
  ctx.$('drName').value = 'كرار'; ctx.$('drPhone').value = '0790'; ctx.$('drMode').value = 'percent'; ctx.$('drWage').value = '25'; await els.drSave.onclick(); await tick();
  ok(delivery.drivers().some((d) => d.name === 'كرار' && d.wageMode === 'percent' && d.wagePct === 25), 'إضافة سائق بنسبة 25%');
  h = await tab('drivers'); ok(h.includes('25% من أجرة التوصيل'), 'عرض أجر النسبة');
  ctx.$('drName').value = 'كرار'; await els.drSave.onclick(); await tick(); ok(/بنفس الاسم/.test(els.drErr.textContent), 'اسم مكرر يعرض الخطأ');
  // ---- الأجور ----
  vm.runInContext(`DV.from='${today}'; DV.to='${today}'`, ctx); h = await tab('wages'); clean(h, 'الأجور');
  ok(h.includes('حيدر &lt;b&gt;') && h.includes('عدد التوصيلات') && h.includes('أجور السائقين') && h.includes('غير مدفوع (بذمته)'), 'جدول الأجور بالعناوين'); ok(h.includes('<b>3</b>') || h.includes('>3<'), 'عدد التوصيلات 3 (بذمة + مدفوع + المُسلَّم الآن)');
  vm.runInContext("DV.from='2026-02-31'", ctx); h = await tab('wages'); ok(h.includes('تاريخ غير صالح'), 'خطأ التاريخ بدل الانهيار'); vm.runInContext(`DV.from='${today}'`, ctx);
  // ---- الأسعار ----
  h = await tab('pricing'); clean(h, 'الأسعار'); ok(h.includes('الكرادة | 8') && h.includes('المنصور &lt;i&gt; | 12') && h.includes('pcSave'), 'المناطق بصيغة «الاسم | الأجرة» مع الهروب');
  ctx.$('pcBase').value = '6'; ctx.$('pcFree').value = '150'; ctx.$('pcZones').value = 'الكرادة | 9\nزيونة | 7.5\n'; await els.pcSave.onclick(); await tick();
  const cfg = delivery.config(); eq(cfg.baseFeeCents, 600, 'الأجرة الافتراضية'); eq(cfg.freeOverCents, 15000, 'حد المجاني'); eq(cfg.zones.length, 2, 'منطقتان بعد الحفظ'); eq(cfg.zones[0].id, zk.id, 'المنطقة الباقية تحتفظ بمعرّفها'); ok(flashes.some((m) => /أسعار التوصيل/.test(m)), 'رسالة النجاح');
  ctx.$('pcZones').value = 'منطقة بلا أجرة'; await els.pcSave.onclick(); await tick(); ok(/غير صالح/.test(els.pcErr.textContent), 'سطر بلا أجرة يعرض الخطأ'); eq(delivery.config().zones.length, 2, 'الفشل لا يغيّر الإعدادات');

  // ---- الكاشير: المنطقة والأجرة ----
  ctx.resetPos(); vm.runInContext(`P.dcfg = ${JSON.stringify(delivery.config())}; P.type='delivery'; P.cust={name:'',phone:'0770',address:''}; P.cart=[{itemId:'${burger}',qty:1,mods:[],note:''}]`, ctx);
  ctx.drawFields(); let f = els.pFields.innerHTML; ok(f.includes('id="fZone"') && f.includes('الكرادة — 9.00') && f.includes('الأجرة الافتراضية 6.00') && f.includes('id="fFee"'), 'حقول المنطقة والأجرة المخصصة للمدير');
  vm.runInContext(`P.zoneId='${zk.id}'`, ctx);
  const pl = () => JSON.parse(JSON.stringify(vm.runInContext('payload()', ctx)));
  eq(pl().zoneId, zk.id, 'المنطقة في الحمولة'); ok(!('deliveryFee' in pl()) || pl().deliveryFee === undefined, 'بلا أجرة مخصصة: غير مُرسَلة');
  vm.runInContext("P.feeOv='3'", ctx); eq(pl().deliveryFee, 3, 'أجرة مخصصة رقم'); vm.runInContext("P.feeOv=''", ctx); eq(pl().deliveryFee, null, 'الحقل الفارغ = تلقائي (null)');
  vm.runInContext("P.feeOv=undefined", ctx); vm.runInContext("P.quote = null", ctx);
  const q = await api_quote(); vm.runInContext(`P.quote = ${JSON.stringify(q)}`, ctx); ctx.drawTotals(); ok(els.pTot.innerHTML.includes('أجرة التوصيل (الكرادة)') && els.pTot.innerHTML.includes('9.00'), 'الإجمالي يعرض أجرة التوصيل والمنطقة');
  clean(els.pTot.innerHTML + 'x'.repeat(100), 'إجماليات الكاشير');
  vm.runInContext("P.type='takeaway'", ctx); ok(pl().zoneId === undefined && pl().deliveryFee === undefined, 'غير التوصيل لا يرسل منطقة ولا أجرة');
  vm.runInContext("P.type='delivery'; P.zoneId='ghost'", ctx); ctx.drawFields(); eq(vm.runInContext('P.zoneId', ctx), '', 'منطقة محذوفة تُصفَّر');
  canFn = (p) => p !== 'discount'; vm.runInContext("P.feeOv='1'", ctx); ctx.drawFields(); ok(!els.pFields.innerHTML.includes('id="fFee"') && pl().deliveryFee === undefined, 'الكاشير بلا حقل أجرة مخصصة ولا يرسلها'); canFn = () => true;
  // استئناف طلب بأجرة يدوية
  const man = orders.save({ type: 'delivery', customer: { phone: '0770' }, lines: L1, deliveryFee: 2 });
  ctx.open = () => {}; await ctx.resume(orders.get(man.id)); eq(vm.runInContext('P.feeOv', ctx), '2', 'الاستئناف يحمل الأجرة اليدوية'); eq(vm.runInContext('P.zoneId', ctx), '', 'ولا منطقة');
  done();
})().catch((e) => { console.log('✗ استثناء:', e); process.exit(1); });
async function api_quote() { return orders.quote({ type: 'delivery', zoneId: zk.id, lines: L1 }); }
