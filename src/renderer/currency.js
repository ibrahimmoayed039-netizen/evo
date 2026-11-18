// عملة الواجهة: الدينار العراقي — نسخة طبق الأصل من src/main/currency.js (المبالغ مخزّنة بالسنت ×100).
const CUR = { code: 'IQD', symbol: 'د.ع', decimals: 0 };
const curGrp = (v) => (Math.round(v * 10 ** CUR.decimals) / 10 ** CUR.decimals || 0).toLocaleString('en-US', { minimumFractionDigits: CUR.decimals, maximumFractionDigits: CUR.decimals });
const curFmt = (cents) => curGrp((cents || 0) / 100);                   // للعرض: 25,000
const curPlain = (cents) => ((cents || 0) / 100).toFixed(CUR.decimals); // لقيم الحقول: 25000
