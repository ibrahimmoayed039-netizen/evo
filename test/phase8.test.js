// المرحلة 8: العملاء + الولاء + كروت الهدايا + الحجوزات (منطق خلفي بلا Electron)
const { ok, eq, throws, done } = require('./harness');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts');
const tables = require(S + 'tables'), crm = require(S + 'crm'), res = require(S + 'reservations'), { can } = require(S + 'permissions');
db.init(); orders.init(':memory:'); shifts.init(); crm.init(); res.init();
auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 });
menu.saveItem({ categoryId: db.get().categories[0].id, name: 'لاتيه', price: 10 });
const latte = db.get().items[0].id;
shifts.open(100);

// يحاكي main.js: الدفع ثم احتساب النقاط، والإلغاء ثم عكسها
const mk = (qty, cid, type = 'takeaway', extra = {}) => orders.save({ type, lines: [{ itemId: latte, qty }], customerId: cid, ...extra });
const make = (qty, cid) => { const o = mk(qty); if (cid) crm.attach(o.id, cid); return o; };
const pay = (id, p) => { const o = orders.pay(id, p); crm.onPaid(id); return o; };
const voidIt = (id, why) => { const was = orders.get(id).status; const o = orders.voidOrder(id, why); if (was === 'paid') crm.onVoid(id); return o; };
const pts = (id) => crm.get(id).points;

// ---------- العملاء ----------
const sara = crm.save({ name: ' سارة ', phone: '٠٥٠١٢٣٤٥٦٧' });
eq(sara.phone, '0501234567', 'تحويل الأرقام العربية'); eq(sara.name, 'سارة', 'قص الاسم'); eq(sara.points, 0, 'رصيد ابتدائي صفر');
throws(() => crm.save({ name: 'أخرى', phone: '050 123 4567' }), /مسجّل/, 'جوال مكرر بمسافات');
throws(() => crm.save({ name: '', phone: '0555555555' }), /اسم/, 'اسم فارغ');
throws(() => crm.save({ name: 'س', phone: '123' }), /الجوال/, 'جوال قصير');
throws(() => crm.save({ id: 'nope', name: 'س', phone: '0555555555' }), /غير موجود/, 'تعديل عميل مجهول');
eq(crm.findByPhone('+966 50 123 4567'), null, 'جوال مختلف لا يطابق'); eq(crm.findByPhone('0501234567').id, sara.id, 'بحث بالجوال'); eq(crm.findByPhone('abc'), null, 'جوال غير صالح لا يرمي');
eq(crm.save({ id: sara.id, name: 'سارة محمد', phone: '0501234567', note: 'VIP' }).note, 'VIP', 'تعديل عميل');
eq(crm.list('محمد').length, 1, 'بحث بالاسم'); eq(crm.list('%').length, 0, 'علامة % لا تعمل كبدل');

// ---------- الولاء ----------
eq(crm.loyalty().enabled, false, 'الولاء معطّل افتراضياً');
const a = make(1, sara.id); pay(a.id, [{ method: 'cash', amount: 20 }]);
eq(pts(sara.id), 0, 'لا نقاط والولاء معطّل');
throws(() => crm.setLoyalty({ enabled: true, earnPerRiyal: -1, pointValueCents: 5 }), /نقاط الريال/, 'نقاط سالبة');
throws(() => crm.setLoyalty({ enabled: true, earnPerRiyal: 1, pointValueCents: 0.5 }), /قيمة النقطة/, 'قيمة نقطة كسرية');
crm.setLoyalty({ enabled: true, earnPerRiyal: 1, pointValueCents: 5 });
const b = make(2, sara.id); pay(b.id, [{ method: 'cash', amount: 23 }]);
eq(pts(sara.id), 20, '20 نقطة (مجموع 20 ريال قبل الضريبة)');
eq(crm.onPaid(b.id), 0, 'لا يكتسب مرتين'); eq(pts(sara.id), 20, 'الرصيد ثابت');
eq(crm.get(sara.id).visits, 2, 'زيارتان'); eq(crm.get(sara.id).spentCents, 3450, 'إجمالي الإنفاق 34.50');
// طلب بلا عميل لا يكسب
const noC = make(1); pay(noC.id, [{ method: 'cash', amount: 12 }]); eq(pts(sara.id), 20, 'بلا عميل لا نقاط');

// استرداد النقاط: 20 نقطة × 5 هللة = 1.00
const c = make(1, sara.id);
throws(() => orders.pay(c.id, [{ method: 'other', kind: 'points', amount: 0.07 }, { method: 'cash', amount: 11.43 }]), /مضاعفات/, 'مبلغ لا يطابق قيمة النقطة');
throws(() => orders.pay(c.id, [{ method: 'card', kind: 'points', amount: 1 }, { method: 'cash', amount: 10.5 }]), /نوع دفعة/, 'نقاط بطريقة غير other');
throws(() => orders.pay(c.id, [{ method: 'other', kind: 'points', amount: 2 }, { method: 'cash', amount: 9.5 }]), /رصيد العميل 20/, 'نقاط أكثر من الرصيد');
eq(orders.get(c.id).status, 'open', 'فشل الدفع يُبقي الطلب مفتوحاً'); eq(pts(sara.id), 20, 'ولا يخصم نقاطاً');
throws(() => orders.pay(c.id, [{ method: 'other', kind: 'points', amount: 0.05 }, { method: 'other', kind: 'points', amount: 0.05 }, { method: 'cash', amount: 11.4 }]), /واحدة/, 'دفعتا نقاط');
pay(c.id, [{ method: 'other', kind: 'points', amount: 1 }, { method: 'cash', amount: 10.5 }]);
eq(orders.get(c.id).status, 'paid', 'دفع مختلط بالنقاط'); eq(pts(sara.id), 9, '20 − 20 + 9 (10 − 1 استرداد)');
const nc = make(1); throws(() => orders.pay(nc.id, [{ method: 'other', kind: 'points', amount: 0.05 }, { method: 'cash', amount: 11.45 }]), /اربط/, 'نقاط بلا عميل');

// إلغاء طلب مدفوع يعكس النقاط
voidIt(c.id, 'خطأ'); eq(pts(sara.id), 20, 'عكس: −9 مكتسبة + 20 مستردة');
crm.onVoid(c.id); eq(pts(sara.id), 20, 'العكس لا يتكرر');
// تعديل يدوي
eq(crm.adjustPoints(sara.id, 50, 'هدية').points, 70, 'إضافة 50');
throws(() => crm.adjustPoints(sara.id, -100, 'x'), /لا يكفي/, 'خصم أكثر من الرصيد'); throws(() => crm.adjustPoints(sara.id, 0, 'x'), /غير صالح/, 'صفر'); throws(() => crm.adjustPoints(sara.id, 5, ' '), /سبب/, 'بلا سبب');
// تعطيل العميل يمنع الربط
const dis = crm.save({ name: 'معطّل', phone: '0522222222' }); crm.setActive(dis.id, false);
eq(crm.findByPhone('0522222222'), null, 'المعطّل لا يظهر في البحث'); throws(() => crm.attach(make(1).id, dis.id), /معطّل/, 'ربط عميل معطّل');
throws(() => crm.attach(a.id, sara.id), /مدفوع/, 'لا ربط لطلب مدفوع');

// ---------- كروت الهدايا ----------
const gc = crm.giftIssue({ amount: 100, method: 'cash', buyerNote: 'عيد ميلاد' });
ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(gc.code), 'شكل الرمز ' + gc.code); eq(gc.balanceCents, 10000, 'رصيد الكرت');
eq(shifts.summary(shifts.currentId()).movesInCents, 10000, 'النقدي دخل الدرج كإيداع');
const gcCard = crm.giftIssue({ amount: 50, method: 'card' });
eq(shifts.summary(shifts.currentId()).movesInCents, 10000, 'البطاقة لا تدخل الدرج');
throws(() => crm.giftIssue({ amount: 0.5, method: 'cash' }), /خارج/, 'مبلغ صغير'); throws(() => crm.giftIssue({ amount: 'abc', method: 'cash' }), /غير صالح/, 'مبلغ نصي');
throws(() => crm.giftIssue({ amount: 10, method: 'other' }), /طريقة/, 'طريقة خاطئة'); throws(() => crm.giftIssue({ amount: 10, method: 'card', expiryDays: 0 }), /الصلاحية/, 'صلاحية صفر');
eq(crm.giftGet(gc.code.toLowerCase().replace(/-/g, '')).balanceCents, 10000, 'البحث بالرمز بلا شرطات/حروف صغيرة');
throws(() => crm.giftGet('ZZZZ'), /غير موجود/, 'كرت مجهول');

const f = make(1);
pay(f.id, [{ method: 'other', kind: 'gift', ref: gc.code.toLowerCase(), amount: 11.5 }]);
eq(crm.giftGet(gc.code).balanceCents, 8850, 'خُصم 11.50 من الكرت'); eq(orders.get(f.id).status, 'paid', 'دفع كامل بالكرت');
// رصيد غير كافٍ يلغي كل شيء
const small = crm.giftIssue({ amount: 5, method: 'card' }), g = make(1);
throws(() => orders.pay(g.id, [{ method: 'other', kind: 'gift', ref: small.code, amount: 11.5 }]), /رصيد الكرت 5\.00/, 'رصيد الكرت لا يكفي');
eq(orders.get(g.id).status, 'open', 'الطلب بقي مفتوحاً'); eq(crm.giftGet(small.code).balanceCents, 500, 'الرصيد لم يتغير');
throws(() => orders.pay(g.id, [{ method: 'other', kind: 'gift', ref: 'NOPE', amount: 11.5 }]), /غير موجود/, 'كرت مجهول عند الدفع');
pay(g.id, [{ method: 'other', kind: 'gift', ref: small.code, amount: 5 }, { method: 'cash', amount: 6.5 }]);
eq(crm.giftGet(small.code).balanceCents, 0, 'دفع مجزأ يستنفد الكرت'); eq(orders.get(g.id).changeCents, 0, 'بلا باقي');
const h = make(1); throws(() => orders.pay(h.id, [{ method: 'other', kind: 'gift', ref: small.code, amount: 1 }, { method: 'cash', amount: 10.5 }]), /رصيد الكرت 0\.00/, 'كرت فارغ');
// منتهي وملغي
const exp = crm.giftIssue({ amount: 20, method: 'card', expiryDays: 30 });
orders.raw().prepare('UPDATE gift_cards SET expires_at=? WHERE code=?').run('2020-01-01T00:00:00.000Z', exp.code.replace(/-/g, ''));
throws(() => orders.pay(h.id, [{ method: 'other', kind: 'gift', ref: exp.code, amount: 11.5 }]), /منتهي/, 'كرت منتهي');
const vc = crm.giftIssue({ amount: 20, method: 'card' });
throws(() => crm.giftVoid(vc.code, ''), /سبب/, 'إلغاء بلا سبب');
const v2 = crm.giftVoid(vc.code, 'ضاع'); eq(v2.status, 'void', 'ملغي'); eq(v2.balanceCents, 0, 'الرصيد صفر');
throws(() => crm.giftVoid(vc.code, 'x'), /مسبقاً/, 'إلغاء مكرر'); throws(() => orders.pay(h.id, [{ method: 'other', kind: 'gift', ref: vc.code, amount: 11.5 }]), /ملغي/, 'الدفع بكرت ملغي');
// إلغاء الطلب المدفوع بالكرت يعيد الرصيد
voidIt(f.id, 'خطأ'); eq(crm.giftGet(gc.code).balanceCents, 10000, 'استُرجع 11.50'); crm.onVoid(f.id); eq(crm.giftGet(gc.code).balanceCents, 10000, 'لا يُسترجع مرتين');
ok(crm.giftGet(gc.code).moves.map((m) => m.type).join() === 'refund,redeem,issue', 'سجل حركات الكرت');
eq(crm.giftList().length, 5, 'قائمة الكروت');

// ---------- الحجوزات ----------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const T1 = tables.save({ name: 'T1', seats: 4 }), T2 = tables.save({ name: 'T2', seats: 2 });
const D = day(2), base = { name: 'خالد', phone: '0533333333', party: 4, date: D, time: '19:00', tableId: T1.id };
const r1 = res.save(base);
eq(r1.status, 'booked', 'حجز جديد'); eq(r1.table, 'T1', 'اسم الطاولة'); eq(r1.durationMin, 90, 'المدة الافتراضية');
throws(() => res.save({ ...base, time: '20:00' }), /محجوزة/, 'تعارض داخل الفترة');
eq(res.save({ ...base, time: '20:30' }).time, '20:30', 'حجز متتالٍ بلا تعارض');
eq(res.save({ ...base, time: '17:30' }).time, '17:30', 'ينتهي عند بداية الحجز التالي');
throws(() => res.save({ ...base, time: '18:30' }), /محجوزة/, 'تداخل مع حجز لاحق');
throws(() => res.save({ ...base, party: 5, time: '12:00' }), /تتسع 4/, 'تجاوز المقاعد'); throws(() => res.save({ ...base, tableId: T2.id, party: 3 }), /تتسع 2/, 'T2 صغيرة');
throws(() => res.save({ ...base, date: day(-1) }), /الماضي/, 'تاريخ ماضٍ'); throws(() => res.save({ ...base, date: '2031-02-30' }), /تاريخ/, 'تاريخ غير موجود');
throws(() => res.save({ ...base, time: '25:00' }), /وقت/, 'وقت خاطئ'); throws(() => res.save({ ...base, party: 0 }), /عدد/, 'عدد صفر');
throws(() => res.save({ ...base, durationMin: 5, time: '10:00' }), /مدة/, 'مدة قصيرة'); throws(() => res.save({ ...base, name: ' ' }), /اسم/, 'بلا اسم');
throws(() => res.save({ ...base, tableId: 'nope', time: '10:00' }), /الطاولة/, 'طاولة مجهولة');
// عبر منتصف الليل
res.save({ name: 'ليلى', phone: '0544444444', party: 2, date: D, time: '23:30', durationMin: 120, tableId: T2.id });
throws(() => res.save({ name: 'م', phone: '0544444445', party: 2, date: day(3), time: '00:30', tableId: T2.id }), /محجوزة/, 'تعارض عبر منتصف الليل');
eq(res.list({ date: D }).map((r) => r.time).join(), '17:30,19:00,20:30,23:30', 'ترتيب القائمة بالوقت'); throws(() => res.list({ date: 'x' }), /تاريخ/, 'تاريخ القائمة');
// ربط تلقائي بعميل مسجّل
eq(res.save({ name: 'سارة', phone: '0501234567', party: 2, date: D, time: '12:00' }).customerId, sara.id, 'ربط الحجز بالعميل');
// تعديل
eq(res.save({ ...base, id: r1.id, note: 'نافذة' }).note, 'نافذة', 'تعديل حجز بلا تعارض مع نفسه');
// الحالات
const free = res.save({ name: 'نورة', phone: '0566666666', party: 2, date: D, time: '15:00' });
throws(() => res.setStatus(free.id, 'seated'), /حدّد طاولة/, 'الجلوس بلا طاولة');
const T3 = tables.save({ name: 'T3', seats: 6 });
eq(res.setStatus(free.id, 'seated', T3.id).table, 'T3', 'تعيين طاولة عند الجلوس');
throws(() => res.save({ ...base, id: free.id, name: 'x' }), /لا يمكن تعديل/, 'لا تعديل بعد الجلوس');
eq(res.setStatus(free.id, 'completed').status, 'completed', 'انتهى'); throws(() => res.setStatus(free.id, 'booked'), /لا يمكن الانتقال/, 'منتهي لا يعود');
throws(() => res.setStatus(free.id, 'bogus'), /غير صالحة/, 'حالة مجهولة');
const busyRes = res.save({ name: 'عمر', phone: '0577777777', party: 2, date: D, time: '13:00' });
mk(1, undefined, 'dine_in', { tableId: T2.id });
throws(() => res.setStatus(busyRes.id, 'seated', T2.id), /طلب مفتوح/, 'الجلوس على طاولة عليها طلب');
// إلغاء ثم استعادة مع تعارض
eq(res.setStatus(r1.id, 'cancelled').status, 'cancelled', 'إلغاء');
const again = res.save({ ...base, name: 'بديل' }); eq(again.status, 'booked', 'الوقت المُلغى يُتاح لغيره');
throws(() => res.setStatus(r1.id, 'booked'), /محجوزة/, 'استعادة محجوز متعارض');
eq(res.setStatus(busyRes.id, 'no_show').status, 'no_show', 'لم يحضر');
// عدّاد اليوم
const t = new Date(); if (t.getHours() < 23 || t.getMinutes() < 40) res.save({ name: 'اليوم', phone: '0588888888', party: 2, date: day(0), time: '23:59' });
eq(res.pendingToday(), t.getHours() < 23 || t.getMinutes() < 40 ? 1 : 0, 'حجوزات اليوم المنتظرة');

// ---------- نواقص المرحلة 8: الإيصال، الدمج، الالتزامات، القسيمة، شارة الحجز، تعبئة الكاشير ----------
const { buildReceiptHTML, buildGiftHTML } = require(S + 'receipt');
const ana = crm.save({ name: 'أنا', phone: '0599000001' });
const ro = make(3, ana.id); pay(ro.id, [{ method: 'cash', amount: 40 }]);
const ri = crm.receiptInfo(ro.id);
eq(ri.name, 'أنا', 'معلومات الإيصال: الاسم'); eq(ri.earned, 30, 'معلومات الإيصال: النقاط المكتسبة'); eq(ri.balance, 30, 'معلومات الإيصال: الرصيد'); ok(ri.enabled, 'الولاء مفعّل');
const rh = buildReceiptHTML({ ...orders.toReceipt(ro.id), loyalty: ri });
ok(rh.includes('العميل: أنا') && rh.includes('نقاط مكتسبة: 30') && rh.includes('رصيد النقاط: 30'), 'الإيصال يعرض العميل والنقاط');
ok(!buildReceiptHTML(orders.toReceipt(ro.id)).includes('رصيد النقاط'), 'بلا عميل: لا سطر نقاط');
const xss = buildReceiptHTML({ ...orders.toReceipt(ro.id), loyalty: { ...ri, name: '<b>x</b>' } }); ok(!xss.includes('<b>x</b>'), 'هروب HTML لاسم العميل في الإيصال');
eq(crm.receiptInfo(mk(1).id), null, 'طلب بلا عميل: لا معلومات');

// دمج العملاء
const dup = crm.save({ name: 'أنا مكرر', phone: '0599000002' });
const dord = make(1, dup.id); pay(dord.id, [{ method: 'cash', amount: 12 }]); // 10 نقاط للمكرر
const resDup = res.save({ name: 'مكرر', phone: '0599000002', party: 2, date: day(5), time: '18:00' });
eq(resDup.customerId, dup.id, 'الحجز مربوط بالمكرر قبل الدمج');
throws(() => crm.merge(ana.id, ana.id), /مختلفين/, 'دمج عميل في نفسه'); throws(() => crm.merge('nope', ana.id), /غير موجود/, 'دمج عميل مجهول');
const before = pts(ana.id) + pts(dup.id);
const merged = crm.merge(dup.id, ana.id);
eq(merged.points, before, 'النقاط تُجمع عند الدمج'); eq(pts(dup.id), 0, 'رصيد المصدر صفر'); eq(crm.get(dup.id).active, false, 'المصدر معطّل');
eq(crm.get(ana.id).visits, 2, 'الطلبات انتقلت للهدف'); eq(crm.get(dup.id).visits, 0, 'المصدر بلا طلبات'); eq(res.get(resDup.id).customerId, ana.id, 'الحجز انتقل للهدف');
eq(crm.get(ana.id).moves.length >= 2, true, 'دفتر النقاط انتقل مع العميل');
throws(() => crm.merge(ana.id, dup.id), /معطّل/, 'الهدف المعطّل مرفوض');
voidIt(dord.id, 'اختبار'); eq(pts(ana.id), before - 10, 'إلغاء طلب انتقل يعكس نقاطه على الهدف');

// التزامات الكروت
const L0 = crm.giftLiabilities();
const g1 = crm.giftIssue({ amount: 50, method: 'card' });
const L1 = crm.giftLiabilities();
eq(L1.activeCents - L0.activeCents, 5000, 'الكرت الجديد يزيد الالتزامات'); eq(L1.activeCount - L0.activeCount, 1, 'عدد الكروت النشطة');
eq(L1.issuedCents - L0.issuedCents, 5000, 'المُصدر');
crm.giftVoid(g1.code, 'اختبار'); eq(crm.giftLiabilities().activeCents, L0.activeCents, 'الكرت الملغي لا يُحسب التزاماً');
// كرت منتهٍ برصيد
const E0 = crm.giftLiabilities();
const g2 = crm.giftIssue({ amount: 30, method: 'card', expiryDays: 1 });
orders.raw().prepare('UPDATE gift_cards SET expires_at=? WHERE code=?').run(new Date(Date.now() - 864e5).toISOString(), g2.code.replace(/-/g, ''));
const L2 = crm.giftLiabilities(); eq(L2.expiredCents - E0.expiredCents, 3000, 'كرت منتهٍ برصيد'); eq(L2.expiredCount - E0.expiredCount, 1, 'عدد المنتهية'); eq(L2.activeCents, L0.activeCents, 'المنتهي خارج النشط');

// قسيمة الكرت
const g3 = crm.giftIssue({ amount: 25, method: 'card', buyerNote: 'من <أحمد>' });
const gv = crm.giftVoucher(g3.code), gh = buildGiftHTML(gv, { width: 58 });
ok(gh.includes(g3.code) && gh.includes('25.00') && gh.includes('كرت هدية') && gh.includes('width:58mm'), 'قسيمة الكرت: الرمز والمبلغ والعرض');
ok(!gh.includes('<أحمد>') && gh.includes('&lt;أحمد&gt;'), 'هروب HTML في ملاحظة القسيمة'); ok(gh.includes('بلا تاريخ انتهاء'), 'قسيمة بلا انتهاء');
throws(() => crm.giftVoucher('ZZZZ-ZZZZ-ZZZZ'), /غير موجود/, 'قسيمة كرت مجهول');

// شارة الحجز على خريطة الطاولات
const T9 = tables.save({ name: 'T9', seats: 4 });
const soon = new Date(Date.now() + 40 * 60000), pad = (n) => String(n).padStart(2, '0');
const sd = ymd(soon), st = `${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
const rs9 = res.save({ name: 'قريب', phone: '0599000009', party: 2, date: sd, time: st, tableId: T9.id });
const fl9 = tables.floor().find((t) => t.id === T9.id);
ok(fl9.reservation && fl9.reservation.id === rs9.id && fl9.reservation.time === st && !fl9.reservation.late, 'الطاولة تعرض الحجز القريب');
eq(tables.floor().find((t) => t.id === T3.id).reservation, null, 'طاولة بلا حجز قريب');
const far = tables.save({ name: 'T10', seats: 4 }); res.save({ name: 'بعيد', phone: '0599000010', party: 2, date: day(3), time: '12:00', tableId: far.id });
eq(tables.floor().find((t) => t.id === far.id).reservation, null, 'حجز بعد أيام لا يظهر');
res.setStatus(rs9.id, 'cancelled'); eq(tables.floor().find((t) => t.id === T9.id).reservation, null, 'الحجز الملغي يختفي من الخريطة');

// تعبئة الكاشير عند الإجلاس
const T11 = tables.save({ name: 'T11', seats: 4 });
const rp = res.save({ name: 'سارة', phone: '0501234567', party: 3, date: day(0), time: '23:59', tableId: T11.id });
throws(() => res.seatPrefill(rp.id), /لم يُجلَس/, 'تعبئة قبل الإجلاس');
res.setStatus(rp.id, 'seated');
const pf = res.seatPrefill(rp.id);
eq(pf.tableId, T11.id, 'تعبئة: الطاولة'); eq(pf.table, 'T11', 'تعبئة: اسم الطاولة'); eq(pf.customer.id, sara.id, 'تعبئة: العميل المسجّل'); eq(pf.party, 3, 'تعبئة: عدد الأشخاص');
const rp2 = res.save({ name: 'زائر', phone: '0599000077', party: 2, date: day(0), time: '23:58', tableId: T3.id }); res.setStatus(rp2.id, 'seated');
eq(res.seatPrefill(rp2.id).customer, null, 'تعبئة: غير مسجّل');

// ---------- الصلاحيات ----------
ok(can('cashier', 'customers') && can('cashier', 'reservations') && can('cashier', 'giftcards'), 'الكاشير: عملاء وحجوزات وكروت');
ok(!can('cashier', 'crm.manage'), 'الكاشير لا يعدّل النقاط ولا يلغي الكروت'); ok(can('manager', 'crm.manage') && can('owner', 'crm.manage'), 'المدير والمالك يديرون');
ok(!can('accountant', 'customers') && !can('kitchen', 'reservations'), 'المحاسب والمطبخ بلا وصول');
done();
