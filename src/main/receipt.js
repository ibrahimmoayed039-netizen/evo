// بناء HTML الإيصال (يُستخدم للمعاينة وللطباعة بنفس الشكل)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Number(n || 0).toFixed(2);

function buildReceiptHTML(order, { width = 80 } = {}) {
  const rows = order.items
    .map((i) => `<tr><td>${esc(i.name)}${(i.mods || []).length ? `<br><small>+ ${esc(i.mods.join('، '))}</small>` : ''}${i.note ? `<br><small>ملاحظة: ${esc(i.note)}</small>` : ''}</td><td class="c">${i.qty}</td><td class="e">${money(i.price * i.qty)}</td></tr>`)
    .join('');
  // إن وُجدت totals (طلب حقيقي) نستخدمها؛ وإلا نحسب كما في صفحة اختبار الطباعة
  let T = order.totals;
  if (!T) {
    const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
    const vat = subtotal * (order.vatRate ?? 0.15);
    T = { subtotal, discount: order.discount || 0, vat, total: subtotal + vat - (order.discount || 0) };
  }
  const pays = (order.payments || []).map((p) => `<tr><td colspan="2">${esc(p.method)}</td><td class="e">${money(p.amount)}</td></tr>`).join('');
  const cust = order.customer && (order.customer.name || order.customer.phone || order.customer.address)
    ? `<div class="meta">${esc(order.customer.name)} ${esc(order.customer.phone)}<br>${esc(order.customer.address)}</div>` : '';
  const L = order.loyalty;
  const loy = L ? `<div class="meta">العميل: ${esc(L.name)}${L.enabled && (L.earned || L.redeemed) ? `<br>${L.earned ? 'نقاط مكتسبة: ' + L.earned + ' ' : ''}${L.redeemed ? 'نقاط مستخدمة: ' + L.redeemed + ' ' : ''}` : ''}${L.enabled ? `<br>رصيد النقاط: ${L.balance}` : ''}</div>` : '';
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
  @page { margin: 0 }
  *{box-sizing:border-box}
  body{margin:0;padding:2mm;width:${width}mm;font:${width === 58 ? 12 : 14}px/1.4 Tahoma,Arial,sans-serif;color:#000;background:#fff}
  h1{font-size:1.4em;text-align:center;margin:0 0 4px}
  .c{text-align:center}.e{text-align:left}
  .meta{text-align:center;font-size:.9em}
  table{width:100%;border-collapse:collapse;margin:6px 0}
  th{border-bottom:1px dashed #000;text-align:right}
  td{padding:2px 0;vertical-align:top}
  .tot td{border-top:1px dashed #000;font-weight:bold}
  small{font-size:.85em}
  .foot{text-align:center;margin-top:8px;font-size:.9em}
  </style></head><body>
  <h1>${esc(order.restaurant || 'اسم المطعم')}</h1>
  <div class="meta">فاتورة #${esc(order.number)} — ${esc(order.date)}<br>${esc(order.type || '')} ${order.table ? '— طاولة ' + esc(order.table) : ''}</div>${cust}${loy}${order.status === 'void' ? '<h1>*** ملغاة ***</h1>' : ''}
  <table><thead><tr><th>الصنف</th><th class="c">الكمية</th><th class="e">السعر</th></tr></thead><tbody>${rows}</tbody>
  <tfoot>
   <tr class="tot"><td colspan="2">المجموع</td><td class="e">${money(T.subtotal)}</td></tr>
   ${T.discount ? `<tr><td colspan="2">الخصم</td><td class="e">-${money(T.discount)}</td></tr>` : ''}
   <tr><td colspan="2">الضريبة (${Math.round((order.vatRate ?? 0.15) * 100)}%)</td><td class="e">${money(T.vat)}</td></tr>
   ${T.deliveryFee ? `<tr><td colspan="2">أجرة التوصيل</td><td class="e">${money(T.deliveryFee)}</td></tr>` : ''}
   <tr class="tot"><td colspan="2">الإجمالي</td><td class="e">${money(T.total)}</td></tr>
   ${pays}${T.change ? `<tr><td colspan="2">الباقي</td><td class="e">${money(T.change)}</td></tr>` : ''}
  </tfoot></table>
  <div class="foot">شكراً لزيارتكم</div>
  </body></html>`;
}


// تذكرة المطبخ: خط كبير بلا أسعار
function buildKotHTML(t, { width = 80 } = {}) {
  const rows = t.items.map((i) => `<div class="it"><b>${i.qty} ×</b> ${esc(i.name)}${(i.mods || []).length ? `<div class="s">+ ${esc(i.mods.join('، '))}</div>` : ''}${i.note ? `<div class="s">** ${esc(i.note)} **</div>` : ''}</div>`).join('');
  const time = new Date(t.createdAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
  @page{margin:0}*{box-sizing:border-box}
  body{margin:0;padding:2mm;width:${width}mm;font:${width === 58 ? 15 : 18}px/1.35 Tahoma,Arial,sans-serif;color:#000;background:#fff}
  h1{font-size:1.3em;text-align:center;margin:0}.m{text-align:center;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:6px}
  .it{padding:4px 0;border-bottom:1px dashed #000}.s{font-size:.8em;padding-right:1.5em}.x{text-align:center;font-size:1.3em;border:2px solid #000;margin:4px 0}
  </style></head><body>
  <h1>${esc(t.stationName)}</h1>
  <div class="m">طلب #${esc(t.orderNumber)}${t.batch > 1 ? ` — دفعة ${t.batch}` : ''}<br>${esc(t.type)}${t.tableLabel ? ' — طاولة ' + esc(t.tableLabel) : ''} — ${esc(time)}</div>
  ${t.status === 'cancelled' ? '<div class="x">*** ملغاة ***</div>' : ''}${rows}</body></html>`;
}

// تقرير الوردية (X إن كانت مفتوحة، Z إن كانت مغلقة). أرقام المتوقع/الفرق تظهر فقط إن طُلبت (الإغلاق الأعمى للكاشير)
function buildShiftHTML(s, { width = 80, showExpected = true } = {}) {
  const dt = (iso) => (iso ? new Date(iso).toLocaleString('ar-SA') : '-');
  const m = (c) => money((c || 0) / 100), row = (a, b, cls = '') => `<tr class="${cls}"><td>${a}</td><td class="e">${b}</td></tr>`;
  const PL = { cash: 'نقدي', card: 'بطاقة', other: 'أخرى' };
  const moves = (s.moves || []).map((x) => row(`${x.type === 'in' ? 'إيداع' : 'مصروف'}: ${esc(x.reason)}`, (x.type === 'in' ? '+' : '-') + m(x.amountCents))).join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
  @page{margin:0}*{box-sizing:border-box}
  body{margin:0;padding:2mm;width:${width}mm;font:${width === 58 ? 12 : 14}px/1.4 Tahoma,Arial,sans-serif;color:#000;background:#fff}
  h1{font-size:1.3em;text-align:center;margin:0 0 4px}.meta{text-align:center;font-size:.9em}
  table{width:100%;border-collapse:collapse;margin:6px 0}td{padding:2px 0}.e{text-align:left}
  .tot td{border-top:1px dashed #000;font-weight:bold}h2{font-size:1em;margin:8px 0 0;border-bottom:1px solid #000}
  </style></head><body>
  <h1>${esc(s.restaurant || 'اسم المطعم')}</h1>
  <div class="meta">${s.closedAt ? 'تقرير إغلاق الوردية (Z)' : 'تقرير الوردية الحالية (X)'} #${esc(s.id)}<br>فتح: ${esc(dt(s.openedAt))} — ${esc(s.openedBy || '-')}<br>${s.closedAt ? 'إغلاق: ' + esc(dt(s.closedAt)) + ' — ' + esc(s.closedBy || '-') : ''}</div>
  <h2>المبيعات</h2><table>
   ${row('عدد الطلبات', s.sales.count)}${row('المجموع قبل الخصم', m(s.sales.subtotalCents))}${row('الخصومات', '-' + m(s.sales.discountCents))}${row('الضريبة', m(s.sales.vatCents))}
   ${row('إجمالي المبيعات', m(s.sales.totalCents), 'tot')}${row(`المرتجعات (${s.refunds.count})`, '-' + m(s.refunds.totalCents))}${row('الصافي', m(s.netCents), 'tot')}</table>
  <h2>طرق الدفع (صافي)</h2><table>${['cash', 'card', 'other'].map((k) => row(PL[k], m(s.payments[k].netCents))).join('')}</table>
  <h2>الصندوق (نقدي)</h2><table>
   ${row('رصيد الافتتاح', m(s.openingCents))}${row('نقدي المبيعات', m(s.payments.cash.inCents))}${s.payments.cash.refundCents ? row('نقدي المرتجعات', '-' + m(s.payments.cash.refundCents)) : ''}${moves}
   ${showExpected ? row('المتوقع في الدرج', m(s.expectedCents), 'tot') : ''}
   ${s.closedAt ? row('المعدود فعلياً', m(s.countedCents), 'tot') + (showExpected ? row(s.diffCents === 0 ? 'الفرق' : s.diffCents > 0 ? 'زيادة' : 'عجز', m(Math.abs(s.diffCents))) : '') : ''}</table>
  ${s.note ? `<div class="meta">ملاحظة: ${esc(s.note)}</div>` : ''}
  </body></html>`;
}

// قسيمة كرت الهدية (تُطبع عند الإصدار)
function buildGiftHTML(g, { width = 80 } = {}) {
  const m = (c) => money((c || 0) / 100);
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
  @page{margin:0}*{box-sizing:border-box}
  body{margin:0;padding:3mm;width:${width}mm;font:${width === 58 ? 12 : 14}px/1.5 Tahoma,Arial,sans-serif;color:#000;background:#fff;text-align:center}
  h1{font-size:1.4em;margin:0}.amt{font-size:2em;font-weight:bold;margin:8px 0}.code{direction:ltr;font:bold 1.4em monospace;border:2px dashed #000;padding:6px;margin:8px 0}
  small{font-size:.85em}
  </style></head><body>
  <h1>${esc(g.restaurant || 'اسم المطعم')}</h1><div>كرت هدية</div>
  <div class="amt">${m(g.initialCents)} ر.س</div>
  <div class="code">${esc(g.code)}</div>
  ${g.expiresAt ? `<div>صالح حتى: ${esc(new Date(g.expiresAt).toLocaleDateString('ar-SA'))}</div>` : '<div>بلا تاريخ انتهاء</div>'}
  ${g.buyerNote ? `<div>من: ${esc(g.buyerNote)}</div>` : ''}
  <small>يُستخدم رمز الكرت عند الدفع. يُرجى الاحتفاظ به.</small>
  </body></html>`;
}

// ورقة رموز QR للطاولات (كل رمز في صفحة/قصاصة مستقلة)
function buildQrSheetHTML(list, { width = 80, restaurant = '' } = {}) {
  const sz = width === 58 ? 44 : 62;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
  @page{margin:0}*{box-sizing:border-box}
  body{margin:0;width:${width}mm;font:${width === 58 ? 12 : 14}px/1.4 Tahoma,Arial,sans-serif;color:#000;background:#fff;text-align:center}
  .q{padding:4mm 2mm;page-break-after:always;break-after:page}.q svg{width:${sz}mm;height:${sz}mm;display:block;margin:4px auto}
  h1{font-size:1.3em;margin:0}h2{font-size:1.6em;margin:2px 0}small{font-size:.75em;direction:ltr;display:block;word-break:break-all}
  </style></head><body>${list.map((x) => `<div class="q"><h1>${esc(restaurant || 'اسم المطعم')}</h1><div>امسح الرمز لعرض المنيو</div>${x.svg}<h2>${esc(x.name)}</h2><small>${esc(x.url)}</small></div>`).join('')}</body></html>`;
}

module.exports = { buildQrSheetHTML, buildGiftHTML, buildReceiptHTML, buildKotHTML, buildShiftHTML };
