// اختبار دخان لصفحة المخزون على DOM وهمي مع واجهة خلفية حقيقية
const { ok, eq, done } = require('./harness');
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), inv = require(S + 'inventory');
db.init(); orders.init(':memory:'); shifts.init(); inv.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'لاتيه <i>', price: 10 });
const latte = db.get().items[0].id;
const beans = inv.save({ name: 'بن', unit: 'g', qty: 1500, minQty: 2000, unitCost: 0.05 }).id;
const milk = inv.save({ name: 'حليب', unit: 'ml', qty: 8000, minQty: 1000, unitCost: 0.01 }).id;
inv.recipeSave(latte, [{ ingredientId: beans, qty: 18 }, { ingredientId: milk, qty: 200 }]);
inv.adjust(beans, 'waste', 100, 'انسكاب');
const po = inv.poSave({ supplier: 'مورد <b>', lines: [{ ingredientId: beans, qty: 1000, totalPrice: 60 }] });

const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'value' ? t.value ?? '' : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? {} : k === 'querySelector' ? () => stub() : k === 'querySelectorAll' ? () => [] : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
const els = {}, dlg = { html: '' };
const ctx = {
  document: { querySelectorAll: () => [] }, console, Promise, Date,
  $: (id) => (els[id] ||= stub()),
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  errMsg: (e) => e.message, can: () => true, money: (c) => (c / 100).toFixed(2), flash() {}, dlgClose() {},
  dlgOpen: (h) => { dlg.html = h; return stub(); },
  api: { invList: async () => inv.list(), menuGet: async () => menu.get(), poList: async () => inv.poList(), invMoves: async (id, n) => inv.moves(id, n) },
};
vm.createContext(ctx);
for (const f of ['shift.js', 'inventory.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', f), 'utf8'), ctx, { filename: f });
const clean = (h, m) => ok(h.length > 50 && !/undefined|NaN|\[object/.test(h), m + ' بلا undefined/NaN');
const tab = async (t) => { vm.runInContext(`INV.tab='${t}'`, ctx); await ctx.viewInventory(); return els.invBody.innerHTML; };

(async () => {
  let h = await tab('stock');
  ok(els.content.innerHTML.includes('⚠') && els.content.innerHTML.includes('بن'), 'تنبيه النقص يظهر'); // البن 1400 < 2000
  ok(h.includes('1.4 كجم') && h.includes('8 لتر'), 'تنسيق الكميات: 1.4 كجم، 8 لتر'); ok(h.includes('50.00 / كجم'), 'التكلفة لكل كجم: 0.05×1000'); clean(h, 'تبويب المخزون');
  h = await tab('recipes'); ok(h.includes('لاتيه &lt;i&gt;') && !h.includes('<i>'), 'هروب HTML لاسم الصنف'); ok(h.includes('تعديل') && h.includes('%'), 'الوصفة والهامش'); clean(h, 'تبويب الوصفات');
  // تكلفة لاتيه: 18×5 + 200×1 = 290 هللة = 2.90 ← هامش (10−2.9)/10 = 71%
  ok(h.includes('2.90') && h.includes('71%'), 'تكلفة 2.90 وهامش 71%');
  h = await tab('count'); ok(h.includes('اعتماد الجرد') && h.includes('data-c'), 'الجرد'); clean(h, 'تبويب الجرد');
  h = await tab('po'); ok(h.includes('مورد &lt;b&gt;') && h.includes('60.00') && h.includes('مسودة'), 'أمر الشراء'); clean(h, 'تبويب المشتريات');
  h = await tab('moves'); ok(h.includes('هدر') && h.includes('انسكاب') && h.includes('رصيد افتتاحي'), 'الحركات'); clean(h, 'تبويب الحركات');
  // الحوارات
  const I = inv.list();
  ctx.ingDialog(null); clean(dlg.html, 'حوار مكوّن جديد'); ctx.ingDialog(I.ingredients[0]); ok(dlg.html.includes('مفعّل'), 'حوار تعديل مكوّن');
  ctx.recipeDialog(db.get().items[0]); ok(dlg.html.includes('وصفة:') && dlg.html.includes('2.90'), 'حوار الوصفة بالتكلفة');
  ctx.adjDialog(I.ingredients[0], 'waste'); ok(dlg.html.includes('السبب (إلزامي)'), 'حوار الهدر');
  ctx.poDialog(inv.poList()[0], I); clean(dlg.html, 'حوار أمر الشراء'); ctx.receiveDialog(inv.poList()[0]); ok(dlg.html.includes('استلام أمر شراء #1'), 'حوار الاستلام');
  done();
})().catch((e) => { console.log('✗ استثناء:', e); process.exit(1); });
