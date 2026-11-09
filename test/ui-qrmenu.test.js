// واجهة QR المنيو (صفحة الإدارة) + سكربت صفحة الزبون على DOM وهمي
const { ok, eq, done } = require('./harness');
const fs = require('fs'), vm = require('vm'), path = require('path');
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth'), menu = require(S + 'menu'), tables = require(S + 'tables'), orders = require(S + 'orders'), qrmenu = require(S + 'qrmenu');
db.init(); orders.init(':memory:'); auth.setupOwner('المالك', '1234'); auth.login(db.get().users[0].id, '1234');
menu.saveCategory({ name: 'مشروبات', sort: 1 }); menu.saveItem({ categoryId: db.get().categories[0].id, name: 'شاي <i>', price: 4 });
const T = tables.save({ name: 'T<1>', seats: 4 });

const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : k === 'value' ? '' : k === 'checked' ? false : k === 'classList' ? { add() {}, remove() {} } : k === 'style' ? {} : stub()), set: () => true, apply: () => stub() });
const els = {};
const ctx = { document: { querySelectorAll: () => [] }, console, Promise, Date, Math, esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), errMsg: (e) => e.message, flash() {}, loadPrintOpts: () => ({ width: 80 }), $: (id) => (els[id] ||= stub()), api: { qrGet: async () => qrmenu.info() } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/qrmenu.js'), 'utf8'), ctx);

// سكربت الزبون: DOM وهمي بسيط
const mkEl = (tag) => ({ tag, children: [], className: '', _t: '', set textContent(v) { this._t = v; if (v === '') this.children = []; }, get textContent() { return this._t; }, appendChild(c) { this.children.push(c); return c; } });
const flat = (e) => [e._t, ...e.children.map(flat)].join('|');
(async () => {
  // نلتقط innerHTML الذي كُتب على content
  const store = {}; ctx.$ = (id) => (store[id] ||= new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; }, get: (t, k) => (k in t ? t[k] : k === 'classList' ? { add() {}, remove() {} } : stub()) }));
  await ctx.viewQrMenu(); const page = store.content.innerHTML;
  ok(page.includes('QR المنيو') && page.includes('qSave') && page.includes('<svg') && page.includes('T&lt;1&gt;') && !page.includes('T<1>'), 'صفحة الإدارة: النموذج والرموز وهروب HTML');
  ok(page.includes('المنيو العام') && page.includes('data-qp="1"') && !/undefined|NaN|\[object/.test(page), 'رمز عام + رمز لكل طاولة بلا undefined');

  // سكربت صفحة الزبون
  const SCRIPT = require('fs').readFileSync(path.join(__dirname, '../src/main/qrmenu.js'), 'utf8').match(/const SCRIPT = `([\s\S]*?)`;\n/)[1].replace(/\\\\/g, '\\');
  const E = {}; const doc = { getElementById: (i) => (E[i] ||= mkEl('div')), createElement: mkEl, title: '' };
  const menuJson = JSON.parse(JSON.stringify(qrmenu.publicMenu(T.id)));
  const c2 = { document: doc, location: { pathname: '/m/' + T.id }, fetch: async (u) => { c2.url = u; return { ok: true, json: async () => menuJson }; }, setInterval() {}, Promise };
  vm.createContext(c2); vm.runInContext(SCRIPT, c2); await new Promise((r) => setTimeout(r, 20));
  eq(c2.url, '/api/menu?t=' + T.id, 'السكربت يطلب المنيو بمعرّف الطاولة');
  ok(flat(E.t).includes('اسم المطعم') && flat(E.s).includes('طاولة T<1>'), 'عنوان الصفحة واسم الطاولة (textContent آمن)');
  ok(flat(E.m).includes('شاي <i>') && flat(E.m).includes('4.00 ر.س') && flat(E.n).includes('مشروبات'), 'عرض الصنف والسعر والتصنيف');
  ok(flat(E.f).includes('15%'), 'ملاحظة الضريبة');
  done();
})().catch((e) => { console.log('✗ استثناء: ' + e.stack); process.exit(1); });
