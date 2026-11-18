// عملة البرنامج: الدينار العراقي (IQD).
// المبالغ تُخزَّن كأعداد صحيحة بوحدة «سنت» (= 1/100 من الوحدة) كما كانت دائماً، فلا حاجة لترحيل أي بيانات.
// الدينار يُتداول بلا كسور، لذلك decimals = 0: كل المبالغ تُعرض وتُقرَّب لأقرب دينار كامل.
// نسخة الواجهة في src/renderer/currency.js يجب أن تطابق هذا الملف (يتحقق منه test/currency.test.js).
const CUR = { code: 'IQD', symbol: 'د.ع', decimals: 0 };
const grp = (v) => (Math.round(v * 10 ** CUR.decimals) / 10 ** CUR.decimals || 0).toLocaleString('en-US', { minimumFractionDigits: CUR.decimals, maximumFractionDigits: CUR.decimals });
const fmtUnits = (units) => grp(Number(units) || 0);              // 25000 → "25,000" (للعرض والطباعة)
const fmt = (cents) => fmtUnits((cents || 0) / 100);               // سنت → "25,000"
const plain = (cents) => ((cents || 0) / 100).toFixed(CUR.decimals); // للتصدير وCSV (بلا فواصل آلاف)
const withSymbol = (cents) => `${fmt(cents)} ${CUR.symbol}`;
const quant = (cents) => { const u = 10 ** (2 - CUR.decimals); return Math.round(cents / u) * u; }; // تقريب لأقرب دينار
module.exports = { CUR, ...CUR, fmt, fmtUnits, plain, withSymbol, quant };
