// تخزين محلي بسيط (JSON بكتابة آمنة). الواجهة ثابتة ليسهل الانتقال لاحقاً إلى SQLite.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
let file, data;

function init() {
  file = path.join(app.getPath('userData'), 'data.json');
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  data.users ??= [];
  data.audit ??= [];
  data.categories ??= [];
  data.items ??= [];
  data.modGroups ??= [];
  data.tables ??= [];
  data.stations ??= [];
  data.drivers ??= [];
  data.settings ??= {};
  data.settings.restaurant ??= 'اسم المطعم';
  data.settings.delivery ??= { baseFeeCents: 0, freeOverCents: 0, zones: [] }; // أجرة التوصيل (الافتراضي 0 = بلا أجرة)
  data.settings.vatRate ??= 0.15; // الضريبة تُضاف فوق سعر المنيو (غير شاملة)
  return data;
}
function save() {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
module.exports = { init, save, get: () => data };
