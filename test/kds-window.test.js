// نافذة المطبخ المستقلة (شاشة ثانية): اختيار الشاشة، منع التكرار، الصلاحية، وعرض الواجهة في وضع kds
const { ok, eq, done } = require('./harness');
const Module = require('module'), fs = require('fs'), vm = require('vm'), path = require('path');
const handlers = {}, wins = [];
let displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
class Win {
  constructor(o) { this.o = o; this.destroyed = false; this.focused = 0; this.web = { on() {}, setZoomFactor() {}, getZoomFactor: () => 1, setVisualZoomLevelLimits: () => Promise.resolve() }; this.webContents = this.web; wins.push(this); }
  setMenuBarVisibility() {} maximize() {} once() {} on(ev, f) { (this.ev ||= {})[ev] = f; } show() {} focus() { this.focused++; }
  loadFile(f, opt) { this.file = f; this.query = opt?.query; } isDestroyed() { return this.destroyed; } getContentSize() { return [1366, 768]; } close() { this.destroyed = true; this.ev?.closed?.(); }
}
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return {
    app: { getPath: orig.call(this, req, ...r).app.getPath, whenReady: () => new Promise(() => {}), on() {}, quit() {} }, BrowserWindow: Win, dialog: {}, Menu: { setApplicationMenu() {} },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {} }, screen: { getPrimaryDisplay: () => displays[0], getAllDisplays: () => displays },
  };
  return orig.call(this, req, ...r);
};
const S = '../src/main/';
const db = require(S + 'db'), auth = require(S + 'auth');
db.init(); db.get().settings.vatRate = 0.15; auth.setupOwner('المالك', '1234'); auth.createUser({ name: 'نادل', role: 'waiter', pin: '2222' }); auth.createUser({ name: 'طباخ', role: 'kitchen', pin: '3333' });
require(S + 'main.js');
const call = (ch, ...a) => handlers[ch]({}, ...a);
const U = (n) => db.get().users.find((u) => u.name === n);
(async () => {
  ok(typeof handlers['app:kdsWindow'] === 'function', 'المعالج مسجّل');
  // بلا دخول / بلا صلاحية
  let err = null; try { await call('app:kdsWindow'); } catch (e) { err = e.message; } ok(!!err, 'مرفوض بلا دخول');
  auth.login(U('نادل').id, '2222'); err = null; try { await call('app:kdsWindow'); } catch (e) { err = e.message; } ok(!!err, 'النادل بلا kitchen.view مرفوض'); eq(wins.length, 0, 'لا نافذة');
  // شاشة واحدة: نافذة عادية على الرئيسية
  auth.login(U('طباخ').id, '3333');
  let r = await call('app:kdsWindow'); eq(r.external, false, 'بلا شاشة ثانية'); eq(wins.length, 1, 'نافذة واحدة'); const w = wins[0];
  eq(w.query.kds, '1', 'تحمّل index.html?kds=1'); ok(/index\.html$/.test(w.file), 'الملف الصحيح'); eq(w.o.fullscreen, false, 'ليست ملء الشاشة'); eq(w.o.x, 0, 'على الرئيسية');
  r = await call('app:kdsWindow'); eq(r.reused, true, 'لا تُفتح نافذة ثانية'); eq(wins.length, 1, 'ما زالت واحدة'); eq(w.focused, 1, 'تُفعَّل الموجودة');
  w.close();
  // شاشة ثانية: ملء الشاشة عليها
  displays = [displays[0], { id: 2, workArea: { x: 1920, y: 0, width: 1280, height: 720 } }];
  r = await call('app:kdsWindow'); eq(r.external, true, 'شاشة ثانية'); eq(wins.length, 2, 'نافذة جديدة بعد الإغلاق'); const w2 = wins[1];
  eq(w2.o.fullscreen, true, 'ملء الشاشة'); eq(w2.o.x, 1920, 'على إحداثيات الشاشة الثانية'); eq(w2.o.width, 1280, 'بعرضها');

  // الواجهة: زر النافذة المستقلة في الرئيسية، وزر الإغلاق في نافذة kds
  const src = (f) => fs.readFileSync(path.join(__dirname, '../src/renderer', f), 'utf8');
  for (const only of [false, true]) {
    const content = { innerHTML: '', classList: { add() {}, remove() {} } }, els = {};
    const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'value' ? '' : k === 'classList' ? { add() {}, remove() {} } : k === 'style' ? {} : stub()), apply: () => stub(), set: () => true });
    const ctx = { console, setTimeout, setInterval: () => 1, clearInterval() {}, Date, Promise, document: { querySelectorAll: () => [] }, KDS_ONLY: only, window: { close() { ctx.closed = true; } },
      $: (id) => (id === 'content' ? content : (els[id] ||= stub())), esc: (s) => String(s ?? ''), errMsg: (e) => e.message, can: () => true, flash() {}, dlgOpen: () => stub(), dlgClose() {},
      api: { kitchenStations: async () => [{ id: 's1', name: 'ساخن' }], kitchenBoard: async () => [] } };
    vm.createContext(ctx); vm.runInContext(src('kds.js'), ctx);
    await vm.runInContext('viewKds()', ctx);
    ok(only ? /id="kdClose"/.test(content.innerHTML) && !/id="kdWin"/.test(content.innerHTML) : /id="kdWin"/.test(content.innerHTML) && !/id="kdClose"/.test(content.innerHTML), only ? 'نافذة kds: زر إغلاق فقط' : 'الرئيسية: زر النافذة المستقلة فقط');
  }
  done();
})().catch((e) => { console.log('✗', e); process.exit(1); });
