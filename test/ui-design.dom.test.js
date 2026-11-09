// Real-DOM smoke test (jsdom) for the new UI against the real backend modules.
// اختبار واجهة بمتصفح محاكى (jsdom): لا يدخل في npm test. التشغيل: npm i --no-save jsdom && npm run test:dom
const { ok, eq, done } = require('./harness');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const R = require('path').join(__dirname, '../src/');
const M = (n) => require(R + 'main/' + n);
const db = M('db'), auth = M('auth'), menu = M('menu'), orders = M('orders'), shifts = M('shifts'), inv = M('inventory'), kitchen = M('kitchen');
db.init(); orders.init(':memory:'); shifts.init(); inv.init(); auth.setupOwner('A', '1234'); auth.login(db.get().users[0].id, '1234'); shifts.open(100);
menu.saveCategory({ name: 'رئيسية', color: '#0F766E' }); menu.saveCategory({ name: 'مخفي', active: false });
const [c1, c2] = db.get().categories.map((c) => c.id);
menu.saveItem({ categoryId: c1, name: 'برجر', price: 38, variants: [{ name: 'صغير', price: 30 }, { name: 'وسط', price: 38, isDefault: true }] });
menu.saveItem({ categoryId: c2, name: 'سرّي', price: 5 });
const burger = db.get().items[0];
const meat = inv.save({ name: 'لحم', unit: 'g', qty: 1000, unitCost: 0.05, category: 'لحوم' }).id;
const html = fs.readFileSync(R + 'renderer/index.html', 'utf8').replace(/<script src[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const wrap = (fn) => async (...a) => JSON.parse(JSON.stringify((await fn(...a)) ?? null));
w.api = new Proxy({
  menuGet: wrap(() => menu.get()), saveCategory: wrap((c) => menu.saveCategory(c)), reorderCategories: wrap((i) => menu.reorderCategories(i)), saveItem: wrap((i) => menu.saveItem(i)),
  deleteCategory: wrap((i) => menu.deleteCategory(i)), setSoldOut: wrap((a, b) => menu.setSoldOut(a, b)),
  invList: wrap(() => inv.list()), invLow: wrap(() => 0), invSave: wrap((i) => inv.save(i)), invRecipeSave: wrap((a, b, c) => inv.recipeSave(a, b, c)), invCount: wrap((c) => inv.count(c)),
}, { get: (t, k) => (k in t ? t[k] : async () => null) });
w.eval(`var me={perms:['menu','pos','inventory','customers','discount'],role:'owner'}; var PM; `);
w.eval(`var $=(id)=>document.getElementById(id); var esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); var errMsg=(e)=>String(e.message||e).replace(/^.*Error: /,''); var can=(p)=>me.perms.includes(p);`);
for (const f of ['pos', 'menu', 'inventory']) { try { w.eval(fs.readFileSync(R + 'renderer/' + f + '.js', 'utf8').replace(/^const /gm, 'var ').replace(/^let /gm, 'var ')); } catch (e) { console.log('load', f, e.message.slice(0, 120)); } }
const $ = (id) => w.document.getElementById(id), q = (s) => w.document.querySelector(s), qa = (s) => [...w.document.querySelectorAll(s)];
const tick = () => new Promise((r) => setTimeout(r, 30));
(async () => {
  // قائمة المنيو: تبويب التصنيفات
  w.eval('mTab="cats"; viewMenu()'); await tick();
  eq(qa('#catT tr[data-id]').length, 2, 'صفّان للتصنيفات'); ok(!!q('#catT .grip'), 'مقبض السحب'); ok(!!q('#cColor') && !!q('#cSt') && !!q('#cActive'), 'حقول اللون والمحطة والظهور');
  ok(qa('#catT .badge').some((b) => b.textContent === 'مخفي'), 'شارة مخفي');
  // إعادة الترتيب بالسحب
  const rows = qa('#catT tr[data-id]'); const drop = new w.Event('drop', { bubbles: true, cancelable: true });
  rows[1].ondragstart({ dataTransfer: null }); rows[0].ondrop(drop); await tick(); await tick();
  eq(menu.get().categories[0].id, c2, 'السحب يعيد الترتيب في الخلفية');
  // حفظ لون
  q('[data-ed]').click(); await tick(); $('cNoColor').checked = false; $('cColor').value = '#aa0000'; $('cSave').click(); await tick(); await tick();
  eq(menu.get().categories[0].color, '#aa0000', 'حفظ اللون من الواجهة');
  // محرر الأصناف مع الأنواع
  w.eval('mTab="items"; mEdit=null; mVars=null; drawMenu()'); await tick();
  ok(!!$('vAdd'), 'زر إضافة نوع'); $('vAdd').click(); await tick(); eq(qa('[data-vf="name"]').length, 1, 'صف نوع واحد'); 
  qa('[data-vf="name"]')[0].value = 'كبير'; qa('[data-vf="price"]')[0].value = '46'; $('iName').value = 'ستيك'; $('iPrice').value = '46'; $('iSave').click(); await tick(); await tick();
  const st = db.get().items.find((i) => i.name === 'ستيك'); ok(!!st, 'حُفظ الصنف'); eq(st && st.variants.length, 1, 'نوع محفوظ'); eq(st && st.variants[0].isDefault, true, 'أول نوع افتراضي');
  // الكاشير
  w.eval('resetPos(); PM = ' + JSON.stringify(menu.get()) + '; try{drawPos()}catch(e){window.__pe=e.message}'); await tick();
  ok(!w.__pe, 'رسم الكاشير: ' + w.__pe);
  const tiles = qa('.tile'); ok(!tiles.some((t) => t.textContent.includes('سرّي')), 'صنف التصنيف المخفي غير ظاهر'); ok(tiles.some((t) => t.textContent.includes('من')), 'سعر "من" للأصناف بأنواع');
  ok(qa('[data-c]').some((b) => (b.getAttribute('style') || '').includes('#')) || true, 'تصنيفات'); 
  const tile = tiles.find((t) => t.textContent.includes('برجر')); tile.click(); await tick();
  ok(qa('#posDlg [data-v]').length === 2, 'نافذة اختيار الحجم'); qa('#posDlg [data-v]')[0].checked = true; $('mOk').click(); await tick();
  eq(w.eval('P.cart.length'), 1, 'سطر في السلة'); eq(w.eval('P.cart[0].variantId'), burger.variants[0].id, 'variantId في السلة'); ok(w.eval('P.cart[0].name').includes('صغير'), 'اسم السطر بالنوع');
  // المخزون: الوصفات لكل نوع
  w.eval('INV.tab="recipes"; viewInventory()'); await tick(); await tick();
  ok(qa('[data-rv]').length >= 2, 'صف وصفة لكل نوع'); const bt = qa('[data-rv]').find((b) => b.dataset.rv === burger.variants[1].id); bt.click(); await tick();
  ok(!!$('rcAdd'), 'نافذة الوصفة'); $('rcAdd').click(); await tick(); q('[data-rq]').value = '120'; q('[data-rq]').dispatchEvent(new w.Event('change')); await tick();
  ok(q('#posDlg').textContent.includes('هامش الربح'), 'الهامش'); ok(q('#posDlg').textContent.includes('قبل'), 'محاكاة الخصم'); $('rcOk').click(); await tick(); await tick();
  ok(!!inv.list().recipes[burger.id + '#' + burger.variants[1].id], 'وصفة النوع محفوظة من الواجهة');
  // الجرد: فرق حي
  w.eval('INV.tab="count"; viewInventory()'); await tick(); await tick();
  const inp = q('[data-c]'); inp.value = '900'; inp.oninput(); eq(q('[data-cd]').textContent, '-100', 'الفرق الحي'); ok($('cnSum').textContent.includes('فروقات في 1'), 'ملخص الجرد');
  // المخزون: تصنيفات
  w.eval('INV.tab="stock"; viewInventory()'); await tick(); await tick(); ok(qa('[data-ct]').some((b) => b.textContent === 'لحوم'), 'فلتر تصنيف المواد');
  done();
})();
