// توليد رمز QR كـ SVG (بدون اعتماد على مكتبات خارجية؛ النواة في vendor/qrcode بترخيص MIT). تصحيح الأخطاء: M.
const QRCode = require('./vendor/qrcode');
const EC = require('./vendor/qrcode/QRErrorCorrectLevel');

function matrix(text) {
  const t = String(text);
  if (!/^[\x20-\x7e]+$/.test(t)) throw new Error('النص يجب أن يكون ASCII (رابط)');
  const q = new QRCode(-1, EC.M); q.addData(t); q.make();
  return q.modules;
}

function svg(text, { margin = 4 } = {}) {
  const m = matrix(text), n = m.length, size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

module.exports = { matrix, svg };
