// ربط التصميم: تصنيفات (لون/ظهور/محطة/ترتيب)، أصناف بأحجام وأنواع، وصفات لكل حجم، خصم يدوي، حقول المواد
const { ok, eq, throws, done } = require('./harness');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts'), inv = require(S + 'inventory'), kitchen = require(S + 'kitchen');
db.init(); orders.init(':memory:'); shifts.init(); inv.init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234'); shifts.open(100);

// ---- التصنيفات ----
menu.saveCategory({ name: 'رئيسية' }); menu.saveCategory({ name: 'مقبلات' }); menu.saveCategory({ name: 'مشروبات' });
let cats = menu.get().categories; eq(cats.map((c) => c.name).join(','), 'رئيسية,مقبلات,مشروبات', 'الترتيب التلقائي بالإضافة');
const [c1, c2, c3] = cats.map((c) => c.id);
menu.saveCategory({ id: c1, name: 'رئيسية', color: '#0F766E', active: true }); eq(menu.get().categories[0].color, '#0F766E', 'لون التصنيف');
throws(() => menu.saveCategory({ id: c1, name: 'رئيسية', color: 'red' }), /لون/, 'لون غير صالح');
menu.saveCategory({ id: c2, name: 'مقبلات', active: false }); eq(menu.get().categories.find((c) => c.id === c2).active, false, 'إخفاء التصنيف');
menu.saveCategory({ id: c1, name: 'رئيسية' }); eq(menu.get().categories[0].color, '#0F766E', 'التعديل بلا لون لا يمسح اللون');
menu.saveCategory({ id: c1, name: 'رئيسية', color: '' }); eq(menu.get().categories[0].color, '', 'مسح اللون');
throws(() => menu.saveCategory({ id: c1, name: 'رئيسية', stationId: 'nope' }), /محطة/, 'محطة مجهولة');
kitchen.saveStation({ name: 'الشواية' }); const st = db.get().stations[0].id;
menu.saveCategory({ id: c1, name: 'رئيسية', stationId: st }); eq(menu.get().categories[0].stationId, st, 'محطة التصنيف');
menu.reorderCategories([c3, c1, c2]); eq(menu.get().categories.map((c) => c.id).join(), [c3, c1, c2].join(), 'إعادة الترتيب');
throws(() => menu.reorderCategories([c1, c2]), /ترتيب/, 'ناقص'); throws(() => menu.reorderCategories([c1, c1, c2, c3]), /ترتيب/, 'مكرر'); throws(() => menu.reorderCategories([c1, c2, 'x']), /ترتيب/, 'مجهول');

// ---- الأصناف بأنواع وأحجام ----
menu.saveItem({ categoryId: c1, name: 'برجر', price: 38, kind: 'normal', barcode: '123', variants: [
  { name: 'صغير', price: 30, cost: 8.1, sku: 'BRG-S' }, { name: 'وسط', price: 38, cost: 9.6, sku: 'BRG-M', isDefault: true }, { name: 'كبير', price: 46, cost: 12.4, sku: 'BRG-L' }] });
let burger = db.get().items.find((i) => i.name === 'برجر'); eq(burger.variants.length, 3, 'ثلاثة أنواع'); eq(burger.priceCents, 3800, 'السعر الظاهر = الافتراضي');
eq(burger.variants[1].isDefault, true, 'الافتراضي'); eq(burger.variants[0].costCents, 810, 'تكلفة النوع'); eq(burger.barcode, '123', 'باركود'); eq(burger.kind, 'normal', 'نوع الصنف'); eq(burger.stockMode, 'auto', 'خصم تلقائي افتراضياً');
throws(() => menu.saveItem({ id: burger.id, categoryId: c1, name: 'برجر', price: 1, variants: [{ name: 'أ', price: 1 }, { name: 'أ', price: 2 }] }), /مكرر/, 'نوع مكرر');
throws(() => menu.saveItem({ id: burger.id, categoryId: c1, name: 'برجر', price: 1, variants: [{ name: 'أ', price: 1, sku: 'X' }, { name: 'ب', price: 2, sku: 'X' }] }), /الرمز/, 'رمز مكرر');
throws(() => menu.saveItem({ categoryId: c1, name: 'س', price: 1, kind: 'bogus' }), /نوع/, 'نوع صنف غير صالح');
menu.saveItem({ id: burger.id, categoryId: c1, name: 'برجر لحم', price: 38 }); burger = db.get().items.find((i) => i.id === burger.id); eq(burger.variants.length, 3, 'التعديل بلا variants يحفظ الأنواع'); eq(burger.variants[1].id.length > 10, true, 'معرّف نوع');
const [vS, vM, vL] = burger.variants.map((v) => v.id);
menu.saveItem({ id: burger.id, categoryId: c1, name: 'برجر لحم', price: 38, variants: burger.variants.map((v) => ({ ...v, price: v.priceCents / 100, cost: v.costCents / 100 })) });
eq(db.get().items.find((i) => i.id === burger.id).variants[0].id, vS, 'معرّف النوع ثابت عند الحفظ');

// ---- الطلبات ----
let o = orders.save({ type: 'takeaway', lines: [{ itemId: burger.id, variantId: vL, qty: 2 }] });
eq(o.lines[0].name, 'برجر لحم · كبير', 'اسم السطر بالنوع'); eq(o.lines[0].unitCents, 4600, 'سعر النوع'); eq(o.lines[0].variantId, vL, 'variantId');
o = orders.save({ type: 'takeaway', lines: [{ itemId: burger.id, qty: 1 }] }); eq(o.lines[0].variantName, 'وسط', 'بلا اختيار = الافتراضي'); eq(o.lines[0].unitCents, 3800, 'سعر الافتراضي');
throws(() => orders.save({ type: 'takeaway', lines: [{ itemId: burger.id, variantId: 'nope', qty: 1 }] }), /اختر نوع/, 'نوع مجهول');
menu.setVariantSoldOut(burger.id, vS, true);
throws(() => orders.save({ type: 'takeaway', lines: [{ itemId: burger.id, variantId: vS, qty: 1 }] }), /نفد/, 'نوع نفد');
ok(!!orders.save({ type: 'takeaway', lines: [{ itemId: burger.id, variantId: vM, qty: 1 }] }), 'الأنواع الأخرى تعمل'); menu.setVariantSoldOut(burger.id, vS, false);
throws(() => menu.setVariantSoldOut(burger.id, 'x', true), /النوع غير موجود/, 'نوع مجهول للنفاد');
const two = orders.save({ type: 'takeaway', lines: [{ itemId: burger.id, variantId: vM, qty: 1 }, { itemId: burger.id, variantId: vL, qty: 1 }] }); eq(two.lines.length, 2, 'نوعان = سطران');
// صنف بلا أنواع يعمل كما كان
menu.saveItem({ categoryId: c3, name: 'ماء', price: 2 }); const water = db.get().items.find((i) => i.name === 'ماء'); eq(water.variants.length, 0, 'بلا أنواع');
eq(orders.save({ type: 'takeaway', lines: [{ itemId: water.id, qty: 1 }] }).lines[0].name, 'ماء', 'اسم بلا نوع');

// ---- المواد والوصفات لكل حجم ----
const meat = inv.save({ name: 'لحم برجر', unit: 'g', qty: 4200, unitCost: 0.048, category: 'لحوم', supplier: 'مورد 1', packLabel: 'كرتون 10 كجم' });
eq(meat.category, 'لحوم', 'تصنيف المادة'); eq(meat.supplier, 'مورد 1', 'المورّد'); eq(meat.packLabel, 'كرتون 10 كجم', 'وحدة الشراء');
inv.save({ id: meat.id, name: 'لحم برجر', unit: 'g', unitCost: 0.048 }); eq(inv.list().ingredients[0].category, 'لحوم', 'التعديل بلا تصنيف لا يمسحه');
inv.save({ id: meat.id, name: 'لحم برجر', unit: 'g', unitCost: 0.048, category: '' }); eq(inv.list().ingredients[0].category, '', 'مسح التصنيف صراحةً');
const cheese = inv.save({ name: 'جبنة', unit: 'g', qty: 3000, unitCost: 0.04 }).id, mid = meat.id;
throws(() => inv.recipeSave(burger.id, [{ ingredientId: mid, qty: 1 }], 'nope'), /النوع غير موجود/, 'وصفة لنوع مجهول');
inv.recipeSave(burger.id, [{ ingredientId: mid, qty: 100 }], vM); inv.recipeSave(burger.id, [{ ingredientId: mid, qty: 200 }, { ingredientId: cheese, qty: 30 }], vL);
ok(!!inv.list().recipes[`${burger.id}#${vM}`] && !!inv.list().recipes[`${burger.id}#${vL}`], 'وصفات منفصلة لكل نوع'); eq(inv.list().recipes[burger.id], undefined, 'لا وصفة للصنف نفسه');
const q = (id) => inv.list().ingredients.find((x) => x.id === id).qty;
const pay = (lines) => { const x = orders.save({ type: 'takeaway', lines }); orders.pay(x.id, [{ method: 'cash', amount: 100000 }]); return x; };
const p1 = pay([{ itemId: burger.id, variantId: vL, qty: 2 }, { itemId: burger.id, variantId: vM, qty: 1 }]);
eq(q(mid), 4200 - 400 - 100, 'خصم لحم حسب كل نوع'); eq(q(cheese), 3000 - 60, 'خصم الجبنة للنوع الكبير فقط');
pay([{ itemId: burger.id, variantId: vS, qty: 5 }]); eq(q(mid), 3700, 'نوع بلا وصفة لا يخصم');
orders.voidOrder ? orders.voidOrder(p1.id, 'test') : null; eq(q(mid), 4200, 'إلغاء المدفوع يُرجع الكميات');
// وصفة الصنف العامة تُستعمل كاحتياط للنوع بلا وصفة خاصة
inv.recipeSave(burger.id, [{ ingredientId: mid, qty: 10 }]); pay([{ itemId: burger.id, variantId: vS, qty: 3 }]); eq(q(mid), 4200 - 30, 'احتياط وصفة الصنف');
// خصم يدوي
menu.saveItem({ id: burger.id, categoryId: c1, name: 'برجر لحم', price: 38, stockMode: 'manual' }); eq(db.get().items.find((i) => i.id === burger.id).stockMode, 'manual', 'وضع يدوي');
pay([{ itemId: burger.id, variantId: vM, qty: 4 }]); eq(q(mid), 4170, 'الخصم اليدوي لا يخصم تلقائياً');
throws(() => menu.saveItem({ id: burger.id, categoryId: c1, name: 'برجر لحم', price: 38, stockMode: 'x' }), /وضع/, 'وضع غير صالح');

done();
