const { ok, eq, throws, done } = require('./harness');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts');
const inv = require(S + 'inventory'), reports = require(S + 'reports'), { can } = require(S + 'permissions');
db.init(); orders.init(':memory:'); shifts.init(); inv.init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 });
const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'لاتيه', price: 10 }); menu.saveItem({ categoryId: cat, name: 'ماء', price: 2 });
const latte = db.get().items[0].id, water = db.get().items[1].id, today = reports.ymd(new Date());
const get = (id) => inv.list().ingredients.find((x) => x.id === id);

// المكوّنات
const beans = inv.save({ name: 'بن', unit: 'g', qty: 1000, minQty: 200, unitCost: 0.05 }).id;
const milk = inv.save({ name: 'حليب', unit: 'ml', qty: 5000, minQty: 1000, unitCost: 0.01 }).id;
eq(get(beans).qty, 1000, 'الرصيد الافتتاحي'); eq(get(beans).unitCostCents, 5, 'تكلفة الجرام بالهللات'); eq(get(beans).valueCents, 5000, 'قيمة المخزون');
eq(inv.moves(beans).length, 1, 'حركة افتتاحية'); eq(inv.moves(beans)[0].reason, 'initial', 'سبب الحركة');
throws(() => inv.save({ name: 'بن', unit: 'g' }), /بنفس الاسم/, 'اسم مكرر'); throws(() => inv.save({ name: ' بن ', unit: 'g' }), /بنفس الاسم/, 'اسم مكرر بمسافات');
throws(() => inv.save({ name: 'س', unit: 'kg' }), /وحدة/, 'وحدة خاطئة'); throws(() => inv.save({ name: 'س', unit: 'g', minQty: -1 }), /غير صالحة/, 'حد سالب');
throws(() => inv.save({ name: '', unit: 'g' }), /الاسم/, 'اسم فارغ'); throws(() => inv.save({ name: 'س', unit: 'g', qty: 'abc' }), /غير صالحة/, 'كمية نصية');
eq(inv.lowCount(), 0, 'لا نقص');

// الوصفات
throws(() => inv.recipeSave('x', []), /الصنف غير موجود/, 'صنف مجهول');
throws(() => inv.recipeSave(latte, [{ ingredientId: 'nope', qty: 1 }]), /المكوّن غير موجود/, 'مكوّن مجهول');
throws(() => inv.recipeSave(latte, [{ ingredientId: beans, qty: 0 }]), /أكبر من صفر/, 'كمية صفر');
throws(() => inv.recipeSave(latte, [{ ingredientId: beans, qty: 1 }, { ingredientId: beans, qty: 2 }]), /مكرر/, 'تكرار');
inv.recipeSave(latte, [{ ingredientId: beans, qty: 18 }, { ingredientId: milk, qty: 200 }]);
eq(inv.list().recipes[latte].length, 2, 'وصفة محفوظة');

// خصم تلقائي
const sale = (id, q) => { const o = orders.save({ type: 'takeaway', lines: [{ itemId: id, qty: q }] }); return orders.pay(o.id, [{ method: 'cash', amount: 10000 }]); };
shifts.open(0);
const o1 = sale(latte, 2);
eq(get(beans).qty, 964, 'خصم البن 36'); eq(get(milk).qty, 4600, 'خصم الحليب 400');
const sm = inv.moves(beans).find((m) => m.reason === 'sale'); ok(sm && sm.delta === -36 && sm.orderId === o1.id, 'حركة بيع مرتبطة بالطلب');
const before = inv.moves().length; inv.onPaid(o1.id); eq(inv.moves().length, before, 'لا خصم مرتين');
sale(water, 3); eq(get(beans).qty, 964, 'صنف بلا وصفة لا يخصم');

// التقرير: تكلفة وهامش
let r = reports.sales({ from: today, to: today });
eq(r.cogsCents, 580, 'تكلفة البضاعة = 36×5 + 400×1'); eq(r.revenueExVatCents, 2000 + 600, 'الإيراد بلا ضريبة (لاتيه 20 + ماء 6)'); eq(r.grossProfitCents, 2600 - 580, 'الهامش');
ok(reports.toCsv(r).includes('تكلفة البضاعة التقديرية'), 'CSV يتضمن التكلفة');

// إلغاء مدفوع يعيد المخزون ولا يتكرر
orders.voidOrder(o1.id, 'خطأ');
eq(get(beans).qty, 1000, 'الإرجاع'); eq(get(milk).qty, 5000, 'إرجاع الحليب');
const m2 = inv.moves().length; inv.onVoid(o1.id); eq(inv.moves().length, m2, 'لا إرجاع مرتين');
r = reports.sales({ from: today, to: today }); eq(r.cogsCents, 0, 'التكلفة صفر بعد الإلغاء'); eq(r.grossProfitCents, null, 'لا هامش بلا تكلفة');
// إلغاء طلب مفتوح لا يمس المخزون
const open = orders.save({ type: 'takeaway', lines: [{ itemId: latte, qty: 1 }] }); orders.voidOrder(open.id, ''); eq(get(beans).qty, 1000, 'إلغاء المفتوح لا يغيّر المخزون');

// رصيد سالب مسموح + تنبيهات
sale(latte, 60); // 1080 جرام بن > 1000
eq(get(beans).qty, -80, 'الرصيد السالب مسموح (البيع لا يتعطل)'); ok(get(beans).low, 'تنبيه نقص'); eq(get(milk).qty, -7000, 'الحليب سالب'); eq(inv.lowCount(), 2, 'عدّاد النقص (بن وحليب)');
inv.adjust(milk, 'add', 12000, 'توريد'); eq(inv.lowCount(), 1, 'ارتفع الحليب فبقي نقص البن فقط');

// تعديل يدوي وهدر
throws(() => inv.adjust(beans, 'waste', 10, ''), /سبب الهدر/, 'سبب الهدر مطلوب');
throws(() => inv.adjust(beans, 'add', 0, ''), /أكبر من صفر/, 'كمية صفر'); throws(() => inv.adjust(beans, 'x', 1, ''), /نوع/, 'نوع خاطئ');
inv.adjust(beans, 'add', 580, 'استلام يدوي'); eq(get(beans).qty, 500, 'إضافة'); inv.adjust(beans, 'waste', 50, 'انسكاب'); eq(get(beans).qty, 450, 'هدر');
const wm = inv.moves(beans)[0]; ok(wm.reason === 'waste' && wm.delta === -50 && wm.note === 'انسكاب', 'حركة الهدر');
r = reports.sales({ from: today, to: today }); eq(r.cogsCents, 60 * 18 * 5 + 60 * 200 * 1, 'الهدر لا يدخل تكلفة البضاعة');

// الجرد
throws(() => inv.count([]), /لا توجد/, 'جرد فارغ'); throws(() => inv.count([{ id: beans, counted: -1 }]), /غير صالحة/, 'جرد سالب');
const c = inv.count([{ id: beans, counted: 440 }, { id: milk, counted: get(milk).qty }]);
eq(c.checked, 2, 'عدد المفحوص'); eq(c.diffs.length, 1, 'فرق واحد فقط'); eq(c.diffs[0].diff, -10, 'الفرق'); eq(c.totalCents, -50, 'قيمة الفرق'); eq(get(beans).qty, 440, 'الرصيد بعد الجرد');
eq(inv.moves(beans)[0].reason, 'count', 'حركة جرد');

// أوامر الشراء + المتوسط المرجّح
throws(() => inv.poSave({ lines: [] }), /صنفاً واحداً/, 'أمر فارغ'); throws(() => inv.poSave({ lines: [{ ingredientId: beans, qty: 0, totalPrice: 5 }] }), /أكبر من صفر/, 'كمية صفر');
const po = inv.poSave({ supplier: 'مورد البن', lines: [{ ingredientId: beans, qty: 1000, totalPrice: 60 }] });
eq(po.status, 'draft', 'مسودة'); eq(po.number, 1, 'الرقم'); eq(po.totalCents, 6000, 'إجمالي الأمر'); eq(po.lines[0].unitCostCents, 6, 'سعر الوحدة');
const po2 = inv.poSave({ id: po.id, supplier: 'مورد البن', lines: [{ ingredientId: beans, qty: 1000, totalPrice: 60 }, { ingredientId: milk, qty: 2000, totalPrice: 30 }] }); eq(po2.lines.length, 2, 'تعديل المسودة');
throws(() => inv.poStatus(po.id, 'received'), /لا يمكن/, 'حالة غير مسموحة'); inv.poStatus(po.id, 'ordered');
throws(() => inv.poSave({ id: po.id, lines: [{ ingredientId: beans, qty: 1, totalPrice: 1 }] }), /المسودة/, 'لا تعديل بعد الطلب');
const lb = po2.lines.find((l) => l.name === 'بن'), lm = po2.lines.find((l) => l.name === 'حليب');
const rec = inv.poReceive(po.id, [{ lineId: lb.id, qty: 560, totalPrice: 33.6 }]); // الحليب بالافتراضي
eq(rec.status, 'received', 'مستلم'); eq(get(beans).qty, 1000, 'استلام جزئي للبن 440+560'); eq(get(milk).qty, 5000 + 2000, 'الحليب: افتراضي ما طُلب');
// المتوسط: بن 440 @5 مع 560 @6 → (2200+3360)/1000 = 5.56
ok(Math.abs(get(beans).unitCostCents - 5.56) < 1e-9, 'متوسط مرجّح للبن ' + get(beans).unitCostCents);
throws(() => inv.poReceive(po.id), /مستلَم/, 'لا استلام مرتين'); throws(() => inv.poStatus(po.id, 'cancelled'), /لا يمكن/, 'لا إلغاء بعد الاستلام');
const po3 = inv.poSave({ lines: [{ ingredientId: milk, qty: 10, totalPrice: 1 }] }); inv.poStatus(po3.id, 'cancelled'); eq(inv.poList()[0].status, 'cancelled', 'إلغاء'); eq(inv.poList().length, 2, 'قائمة الأوامر');
eq(inv.moves(beans)[0].reason, 'purchase', 'حركة شراء');

// الحذف والوحدة
throws(() => inv.remove(beans), /مستخدم/, 'لا حذف لمكوّن مستخدم'); throws(() => inv.save({ id: beans, name: 'بن', unit: 'ml' }), /وحدة/, 'لا تغيير وحدة');
const tmp = inv.save({ name: 'مؤقت', unit: 'pcs' }); inv.remove(tmp.id); ok(!get(tmp.id), 'حذف مكوّن غير مستخدم');
inv.save({ id: beans, name: 'بن', unit: 'g', minQty: 200, unitCost: 0.05, active: false }); ok(!get(beans).low, 'المعطّل لا ينبّه');
inv.recipeSave(latte, []); eq((inv.list().recipes[latte] || []).length, 0, 'مسح الوصفة');

// الصلاحيات
ok(can('manager', 'inventory') && can('owner', 'inventory') && !can('cashier', 'inventory') && !can('kitchen', 'inventory'), 'صلاحية المخزون');
done();
