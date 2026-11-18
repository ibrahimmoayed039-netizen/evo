// الطبقة الفاخرة: الملفات موجودة ومربوطة، والخطوط المحلية كلها موجودة (التطبيق يعمل بلا إنترنت وبسياسة CSP صارمة)
const { ok, eq, done } = require('./harness');
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '../src/renderer'), read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const html = read('index.html'), lux = read('luxury.css'), fonts = read('fonts.css');
const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
ok(links.indexOf('fonts.css') >= 0 && links.indexOf('fonts.css') < links.indexOf('theme.css'), 'fonts.css قبل theme.css');
ok(links.indexOf('luxury.css') > links.indexOf('theme3d.css') && links.indexOf('luxury.css') < links.indexOf('responsive.css'), 'luxury.css بعد theme3d وقبل responsive');
const files = [...fonts.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]); ok(files.length >= 10, 'عُرّفت خطوط كافية: ' + files.length);
files.forEach((f) => ok(fs.existsSync(path.join(R, f)), 'ملف الخط موجود: ' + f));
ok(!/https?:\/\//.test(fonts + lux), 'لا روابط خارجية في الخطوط/التنسيق (CSP)');
ok(fs.existsSync(path.join(R, 'art/lattice.svg')) && lux.includes('art/lattice.svg'), 'زخرفة الشبكة موجودة ومستخدمة');
ok(lux.includes('prefers-reduced-motion') && lux.includes(':focus-visible'), 'تقليل الحركة وحلقة التركيز');
ok(/OFL|Open Font/i.test(read('fonts/OFL-ReemKufi.txt')) && fs.existsSync(path.join(R, 'fonts/OFL-IBMPlexSansArabic.txt')), 'رخص الخطوط مرفقة');
const open = (lux.match(/\{/g) || []).length, close = (lux.match(/\}/g) || []).length; eq(open, close, 'أقواس luxury.css متوازنة');
done();
