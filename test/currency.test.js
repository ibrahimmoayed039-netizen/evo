// العملة: الدينار العراقي — تنسيق موحّد، بلا كسور، ولا بقايا للريال في الكود
const { ok, eq, done } = require('./harness');
const fs = require('fs'), path = require('path'), vm = require('vm');
const S = '../src/main/', cur = require(S + 'currency');
eq(cur.code, 'IQD', 'رمز العملة'); eq(cur.symbol, 'د.ع', 'الرمز'); eq(cur.decimals, 0, 'بلا كسور');
eq(cur.fmt(2500000), '25,000', 'عرض بفواصل الآلاف'); eq(cur.plain(2500000), '25000', 'تصدير بلا فواصل'); eq(cur.withSymbol(125000), '1,250 د.ع', 'مع الرمز');
eq(cur.fmt(0), '0', 'صفر'); eq(cur.fmt(-50), '0', 'لا سالب صفري'); eq(cur.quant(33330), 33300, 'تقريب لأقرب دينار'); eq(cur.quant(33350), 33400, 'تقريب لأعلى');
// نسخة الواجهة تطابق نسخة الخلفية
const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/currency.js'), 'utf8') + ';this.o={CUR,f:curFmt(2500000),p:curPlain(2500000)}', ctx);
eq(JSON.stringify(ctx.o.CUR), JSON.stringify(cur.CUR), 'إعدادات الواجهة = الخلفية'); eq(ctx.o.f, '25,000', 'عرض الواجهة'); eq(ctx.o.p, '25000', 'قيمة حقل الواجهة');
// الخصم النسبي يُقرَّب لدينار كامل
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), orders = require(S + 'orders'), shifts = require(S + 'shifts');
db.init(); orders.init(':memory:'); shifts.init(); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'وجبات', sort: 1 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'برجر', price: 3333 }); shifts.open(1000);
const o = orders.save({ type: 'takeaway', lines: [{ itemId: db.get().items[0].id, qty: 1 }], discount: { type: 'percent', value: 10 } });
eq(o.discountCents, 33300, 'الخصم 10% من 3333 = 333 دينار كاملة'); eq(o.totalCents % 100, 0, 'المجموع دنانير كاملة'); eq(o.totalCents, 300000, 'المجموع 3000');
// الإيصال والتقرير ومنيو QR
const rc = require(S + 'receipt').buildReceiptHTML(orders.toReceipt(o.id)); ok(rc.includes('3,333') && !rc.includes('3333.00'), 'الإيصال بفواصل وبلا كسور');
ok(fs.readFileSync(path.join(__dirname, S + 'qrmenu.js'), 'utf8').includes('د.ع'), 'منيو QR بالدينار');
// لا بقايا للريال/الهجري في الكود
const bad = []; ['main', 'renderer'].forEach((d) => fs.readdirSync(path.join(__dirname, '../src', d)).filter((f) => /\.(js|html)$/.test(f)).forEach((f) => { const t = fs.readFileSync(path.join(__dirname, '../src', d, f), 'utf8'); if (/ر\.س|ar-SA|بالهللة/.test(t)) bad.push(f); }));
eq(bad.join(','), '', 'لا ريال ولا تقويم هجري في الملفات');
done();
