// طبقة المجسمات (theme3d.css + art/*.svg): ربط الملفات، توافق CSP، منطق الكراسي، ألوان بلاطات الأصناف
const { ok, eq, done } = require('./harness');
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '../src/renderer/');
const read = (f) => fs.readFileSync(R + f, 'utf8');
const html = read('index.html'), css = read('theme3d.css');

// ---- الربط ----
ok(html.indexOf('href="theme3d.css"') > html.indexOf('href="theme.css"') && html.includes('href="theme.css"'), 'theme3d.css يُحمَّل بعد theme.css');
ok(html.includes('class="scene"'), 'مشهد شاشة الدخول موجود');
ok(/default-src 'self'/.test(html) && !/img-src[^;]*https?:/.test(html), 'سياسة CSP بلا مصادر خارجية');

// ---- ملفات الرسومات ----
const refs = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
ok(refs.length >= 4, 'الـCSS يشير إلى الرسومات: ' + refs.length);
for (const r of refs) {
  ok(!/^(https?:|\/\/|data:)/.test(r), 'مرجع محلي فقط: ' + r);
  ok(fs.existsSync(R + r), 'الملف موجود: ' + r);
  const svg = fs.readFileSync(R + r, 'utf8');
  ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>') && /viewBox="0 0 \d+ \d+"/.test(svg), 'SVG سليم: ' + r);
  ok(!/<script|href="http|xlink:href="http|<image/i.test(svg), 'SVG بلا سكربت أو مراجع خارجية: ' + r);
}
ok(!/@import|https?:\/\//.test(css), 'الـCSS بلا @import ولا روابط خارجية');

// ---- أيقونات لوحة التحكم ----
const dash = read('dashboard.js');
for (const k of ['art-coins', 'art-boxes', 'art-receipt']) { ok(dash.includes(k), 'لوحة التحكم تستعمل ' + k); ok(css.includes('.dbk.' + k + '::after'), 'قاعدة CSS لـ ' + k); }
ok(dash.includes("'main art-coins'"), 'البطاقة الرئيسية تحافظ على الصنف main');

// ---- الكراسي (منطق خالص مستخرج من tables.js) ----
const tsrc = read('tables.js');
const chairsSrc = tsrc.slice(tsrc.indexOf('function tblChairs'), tsrc.indexOf('function tblCard'));
const tblChairs = new Function(chairsSrc + '; return tblChairs;')();
eq(tblChairs('square', 4, 100, 100).length, 4, 'أربعة كراسي');
eq(tblChairs('round', 8, 112, 112).length, 8, 'ثمانية كراسي دائرية');
eq(tblChairs('round', 30, 112, 112).length, 12, 'الحد الأقصى 12 كرسياً');
eq(tblChairs('rect', 0, 150, 92).length, 1, 'الحد الأدنى كرسي واحد');
const two = tblChairs('square', 2, 100, 100); eq(two[0][0] + two[1][0], 0, 'كرسيان متقابلان: متماثلان أفقياً'); ok(two[0][1] < 0 && two[1][1] > 0, 'كرسيان: واحد فوق وواحد تحت');
const one = tblChairs('rect', 1, 150, 92); eq(one[0][0], 0, 'كرسي واحد في منتصف الجهة (لا زاوية)');
ok(tsrc.includes('--a:${Math.round((Math.atan2(y, x)'), 'زاوية مسند الكرسي تُحسب في tblCard');
const ang = (x, y) => Math.round((Math.atan2(y, x) * 180) / Math.PI);
eq(ang(10, 0), 0, 'كرسي يمين الطاولة: مسنده لليمين'); eq(ang(0, -10), -90, 'كرسي أعلى الطاولة: مسنده للأعلى'); eq(ang(-10, 0), 180, 'كرسي يسار: مسنده لليسار');

// ---- لون بلاطة الصنف ----
const psrc = read('pos.js'), line = psrc.split('\n').find((l) => l.startsWith('const tileColor'));
ok(!!line, 'tileColor معرّفة في pos.js');
const tileColor = new Function('PM', line + '; return tileColor;')({ categories: [{ id: 'a', color: '#0F766E' }, { id: 'b', color: 'red' }, { id: 'c' }] });
eq(tileColor({ categoryId: 'a' }), ' style="--cc:#0F766E"', 'لون صالح يُمرَّر كمتغيّر');
eq(tileColor({ categoryId: 'b' }), '', 'لون غير صالح يُتجاهل (لا حقن في style)');
eq(tileColor({ categoryId: 'c' }), '', 'تصنيف بلا لون');
eq(tileColor({ categoryId: 'zzz' }), '', 'تصنيف مجهول');
ok(psrc.includes('<div class="ph">${esc('), 'حرف الصنف على الصحن يمرّ عبر esc');

done();
