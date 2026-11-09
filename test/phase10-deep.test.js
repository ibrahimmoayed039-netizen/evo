// تقارير أعمق: ربحية الأصناف، أداء الفريق، أوقات الذروة
const { ok, eq, throws, done } = require('./harness');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts');
const inv = require(S + 'inventory'), reports = require(S + 'reports'), deepR = require(S + 'reports-deep'), { can } = require(S + 'permissions');
db.init(); orders.init(':memory:'); shifts.init(); inv.init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 });
const cat = db.get().categories[0].id;
menu.saveItem({ categoryId: cat, name: 'لاتيه', price: 10 }); menu.saveItem({ categoryId: cat, name: 'ماء', price: 2 }); menu.saveItem({ categoryId: cat, name: 'كيك', price: 8 });
const [latte, water, cake] = db.get().items.map((i) => i.id), today = reports.ymd(new Date());
const beans = inv.save({ name: 'بن', unit: 'g', qty: 1000, unitCost: 0.05 }).id, milk = inv.save({ name: 'حليب', unit: 'ml', qty: 5000, unitCost: 0.01 }).id;
inv.recipeSave(latte, [{ ingredientId: beans, qty: 18 }, { ingredientId: milk, qty: 200 }]); // تكلفة 90+200 = 290 هللة
inv.recipeSave(water, [{ ingredientId: milk, qty: 50 }]);                                  // 50 هللة
shifts.open(100);
const sale = (itemId, qty, extra = {}) => { const o = orders.save({ type: 'takeaway', lines: [{ itemId, qty }], ...extra }); const p = orders.pay(o.id, [{ method: 'cash', amount: 100 }]); inv.onPaid(o.id); return p; };
// يضبط وقت الدفع محلياً لاختبار الذروة (الأحد قبل 14 يوماً من اليوم ليس ضرورياً: نستخدم اليوم نفسه بساعات مختلفة)
const at = (id, h) => { const d = new Date(); d.setHours(h, 5, 0, 0); orders.raw().prepare('UPDATE orders SET paid_at=? WHERE id=?').run(d.toISOString(), id); };

const o1 = sale(latte, 2), o2 = sale(latte, 1), o3 = sale(water, 5), o4 = sale(cake, 3);
at(o1.id, 12); at(o2.id, 12); at(o3.id, 13); at(o4.id, 20);
const R = deepR.deep({ from: today, to: today });

// ---- ربحية الأصناف ----
const row = (n) => R.items.rows.find((x) => x.name === n);
eq(row('لاتيه').qty, 3, 'كمية اللاتيه'); eq(row('لاتيه').revenueCents, 3000, 'إيراد اللاتيه 30.00');
eq(row('لاتيه').costCents, 870, 'تكلفة اللاتيه 3 × 2.90'); eq(row('لاتيه').profitCents, 2130, 'ربح اللاتيه'); eq(row('لاتيه').marginPct, 71, 'هامش اللاتيه 71%');
eq(row('ماء').costCents, 250, 'تكلفة الماء 5 × 0.50'); eq(row('ماء').profitCents, 750, 'ربح الماء');
eq(row('كيك').hasRecipe, false, 'الكيك بلا وصفة'); eq(row('كيك').profitCents, null, 'لا ربح بلا وصفة'); eq(row('كيك').costCents, null, 'لا تكلفة بلا وصفة');
const s = R.items.summary;
eq(s.revenueCents, 3000 + 1000 + 2400, 'إجمالي الإيراد'); eq(s.recipeRevenueCents, 4000, 'إيراد الأصناف بوصفة'); eq(s.costCents, 1120, 'إجمالي التكلفة'); eq(s.profitCents, 2880, 'إجمالي الربح');
eq(s.marginPct, 72, 'الهامش الإجمالي'); eq(s.coveragePct, 62.5, 'تغطية الوصفات'); eq(s.noRecipeCount, 1, 'صنف بلا وصفة');
eq(R.items.rows[0].name, 'لاتيه', 'الترتيب بالربح'); eq(R.items.rows[R.items.rows.length - 1].name, 'كيك', 'بلا وصفة في النهاية');
// تتفق التكلفة مع حركات المخزون الفعلية (تكلفة البضاعة في التقرير القديم)
eq(reports.sales({ from: today, to: today }).cogsCents, s.costCents, 'تتطابق مع تكلفة البضاعة في تقرير المبيعات');
// متوسط الكمية 4 والهامش المرجّح 72%: اللاتيه (3، 71%) ضعيف، والماء (5، 75%) نجم
eq(row('لاتيه').cls, 'dog', 'اللاتيه: أقل شعبية وهامشه تحت المتوسط'); eq(row('ماء').cls, 'star', 'الماء: شعبي وهامشه فوق المتوسط'); eq(row('كيك').cls, null, 'بلا وصفة بلا تصنيف');

// الخصم يُوزَّع على الإيراد بالتناسب
const od = orders.save({ type: 'takeaway', lines: [{ itemId: latte, qty: 1 }], discount: { type: 'percent', value: 50 } }); orders.pay(od.id, [{ method: 'cash', amount: 100 }]); inv.onPaid(od.id); at(od.id, 12);
const R2 = deepR.deep({ from: today, to: today }), l2 = R2.items.rows.find((x) => x.name === 'لاتيه');
eq(l2.revenueCents, 3500, 'الإيراد بعد خصم 50% على طلب (1000→500)'); eq(l2.costCents, 1160, 'التكلفة لا تتأثر بالخصم');

// ---- أداء الفريق ----
eq(R2.staff.length, 1, 'مستخدم واحد'); eq(R2.staff[0].name, 'المالك', 'الاسم'); eq(R2.staff[0].role, 'owner', 'الدور'); eq(R2.staff[0].orders, 5, 'عدد الطلبات');
eq(R2.staff[0].discountOrders, 1, 'طلب بخصم'); ok(R2.staff[0].discountCents > 0, 'مبلغ الخصم');
const bad = orders.save({ type: 'takeaway', lines: [{ itemId: water, qty: 1 }] }); orders.pay(bad.id, [{ method: 'cash', amount: 10 }]); inv.onPaid(bad.id);
orders.voidOrder(bad.id, 'خطأ'); inv.onVoid(bad.id);
const R3 = deepR.deep({ from: today, to: today });
eq(R3.staff[0].voidCount, 1, 'إلغاء مدفوع'); ok(R3.staff[0].voidCents > 0, 'مبلغ المرتجع'); eq(R3.staff[0].orders, 5, 'الملغي لا يُحتسب في الطلبات السارية');
const open = orders.save({ type: 'takeaway', lines: [{ itemId: water, qty: 1 }] }); orders.voidOrder(open.id, 'تراجع');
eq(deepR.deep({ from: today, to: today }).staff[0].voidCount, 2, 'إلغاء غير مدفوع يُحسب عدداً'); eq(deepR.deep({ from: today, to: today }).staff[0].voidCents, R3.staff[0].voidCents, 'ولا يُحسب مبلغاً');

// ---- أوقات الذروة ----
const P = R3.peaks, h = (x) => P.hours.find((y) => y.hour === x);
eq(h(12).count, 3, 'ساعة 12: ثلاثة طلبات'); eq(h(13).count, 1, 'ساعة 13'); eq(h(20).count, 1, 'ساعة 20'); eq(h(9), undefined, 'ساعات بلا مبيعات تُحذف');
eq(R3.days, 1, 'يوم واحد'); eq(h(12).avgPerDay, 3, 'متوسط الساعة 12'); eq(P.maxPerHour, 3, 'أعلى ساعة');
eq(P.blocks.length, 1, 'كتلة ذروة واحدة (≥60% من الأعلى)'); eq(P.blocks[0].from, 12, 'بداية الذروة'); eq(P.blocks[0].to, 13, 'نهاية الذروة'); eq(P.blocks[0].avgPerHour, 3, 'متوسط الذروة');
eq(P.lowConfidence, true, 'فترة قصيرة: دقة أقل'); eq(P.heat.length, 7, 'خريطة 7 أيام'); eq(P.heat[0].length, 24, 'بـ24 ساعة');
const w = new Date().getDay(); eq(P.dow[w].orders, 5, 'طلبات اليوم الحالي'); eq(P.heat[w][12], 3, 'خلية اليوم × الساعة');
// فترة يومين: المتوسط لكل يوم لا للمجموع، وكتلتان متصلتان عبر ساعات متجاورة
const yday = new Date(); yday.setDate(yday.getDate() - 1); yday.setHours(13, 30, 0, 0);
orders.raw().prepare('UPDATE orders SET paid_at=? WHERE id=?').run(yday.toISOString(), o3.id); // طلب الماء ← أمس 13:30
const R4 = deepR.deep({ from: reports.ymd(yday), to: today });
eq(R4.days, 2, 'يومان'); eq(R4.peaks.hours.find((x) => x.hour === 13).count, 1, 'ساعة 13 عبر اليومين'); eq(R4.peaks.hours.find((x) => x.hour === 13).avgPerDay, 0.5, 'متوسط 0.5 لكل يوم');
eq(R4.peaks.hours.find((x) => x.hour === 12).avgPerDay, 1.5, 'ساعة 12: 3 طلبات / يومين');
const wy = yday.getDay(); eq(R4.peaks.dow[wy].avgOrdersPerDay, 1, 'أمس: طلب واحد ÷ مرة واحدة'); eq(R4.peaks.dow[w].avgOrdersPerDay, 4, 'اليوم: 4 طلبات سارية');
eq(deepR.deep({ from: '2020-01-01', to: '2020-01-01' }).peaks.blocks.length, 0, 'فترة فارغة بلا ذروة'); eq(deepR.deep({ from: '2020-01-01', to: '2020-01-01' }).items.rows.length, 0, 'ولا أصناف');
eq(deepR.deep({ from: '2020-01-01', to: '2020-01-01' }).items.summary.marginPct, null, 'ولا هامش (بلا قسمة على صفر)');

// ---- هندسة المنيو: الفئات الأربع في يوم منفصل (قبل 3 أيام) ----
const bread = inv.save({ name: 'خبز', unit: 'pcs', qty: 100, unitCost: 4 }).id, tea = inv.save({ name: 'شاي', unit: 'g', qty: 1000, unitCost: 0.01 }).id;
const mk = (name) => { menu.saveItem({ categoryId: cat, name, price: 10 }); return db.get().items.find((i) => i.name === name).id; };
const sand = mk('ساندويتش'), juice = mk('عصير'), chai = mk('شاي كرك'), steak = mk('ستيك');
inv.recipeSave(sand, [{ ingredientId: bread, qty: 2 }]); inv.recipeSave(juice, [{ ingredientId: milk, qty: 100 }]); inv.recipeSave(chai, [{ ingredientId: tea, qty: 60 }]); inv.recipeSave(steak, [{ ingredientId: bread, qty: 2.25 }]);
const d3 = new Date(); d3.setDate(d3.getDate() - 3); d3.setHours(12, 0, 0, 0);
[[sand, 6], [juice, 1], [chai, 6], [steak, 1]].forEach(([id, q]) => { const o = sale(id, q); orders.raw().prepare('UPDATE orders SET paid_at=? WHERE id=?').run(d3.toISOString(), o.id); });
const R5 = deepR.deep({ from: reports.ymd(d3), to: reports.ymd(d3) }), c5 = (n) => R5.items.rows.find((x) => x.name === n);
eq(c5('ساندويتش').cls, 'horse', 'شعبي وهامش منخفض 20% = حصان عمل'); eq(c5('عصير').cls, 'puzzle', 'قليل المبيعات وهامش مرتفع = لغز'); eq(c5('شاي كرك').cls, 'star', 'شعبي وهامش مرتفع = نجم'); eq(c5('ستيك').cls, 'dog', 'قليل المبيعات وهامش منخفض = ضعيف');
eq(c5('ساندويتش').marginPct, 20, 'هامش الساندويتش'); eq(R5.items.avgQty, 3.5, 'متوسط الكمية'); eq(R5.items.avgMarginPct, 56, 'الهامش المرجّح');

// ---- التحقق والصلاحيات والتصدير ----
throws(() => deepR.deep({ from: '2026-13-01', to: today }), /تاريخ غير صالح/, 'تاريخ خاطئ'); throws(() => deepR.deep({ from: today, to: '2000-01-01' }), /قبل البداية/, 'نهاية قبل البداية');
throws(() => deepR.deep({ from: '2020-01-01', to: today }), /أطول من سنة/, 'أطول من سنة'); throws(() => deepR.deep(), /تاريخ غير صالح/, 'بلا معاملات');
eq(can('owner', 'reports'), true, 'المالك'); eq(can('manager', 'reports'), true, 'المدير'); eq(can('accountant', 'reports'), true, 'المحاسب'); eq(can('cashier', 'reports'), false, 'الكاشير لا يرى الأرباح'); eq(can('waiter', 'reports'), false, 'النادل لا يرى الأرباح');
const csv = deepR.toCsv(deepR.deep({ from: today, to: today }));
ok(csv.startsWith('\uFEFF'), 'BOM للعربي في Excel'); ok(csv.includes('لاتيه,4,35.00,11.60,23.40,66.9,نجم'), 'سطر صنف في CSV'); ok(csv.includes('بلا وصفة'), 'الكيك بلا وصفة في CSV'); ok(csv.includes('المالك,owner'), 'سطر مستخدم');
menu.saveItem({ categoryId: cat, name: '=HYPERLINK("x")', price: 1 }); const inj = db.get().items.find((i) => i.name.startsWith('=')).id; const oi = sale(inj, 1); at(oi.id, 10);
ok(deepR.toCsv(deepR.deep({ from: today, to: today })).includes(`"'=HYPERLINK`), 'حماية من حقن المعادلات في CSV');
done();
