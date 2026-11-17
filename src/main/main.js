const { app, BrowserWindow, ipcMain, dialog, screen, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const menu = require('./menu');
const orders = require('./orders');
const tables = require('./tables');
const kitchen = require('./kitchen');
const shifts = require('./shifts');
const inventory = require('./inventory');
const reports = require('./reports');
const reportsDeep = require('./reports-deep');
const crm = require('./crm');
const reservations = require('./reservations');
const delivery = require('./delivery');
const qrmenu = require('./qrmenu');
const waiterApi = require('./waiter-api');
const { buildReceiptHTML, buildKotHTML, buildShiftHTML, buildGiftHTML, buildQrSheetHTML } = require('./receipt');
const { printSystem, printEscPos } = require('./printing');

let mainWin, kdsWin = null;

// نافذة مطبخ مستقلة: تُفتح ملء الشاشة على الشاشة الثانية إن وُجدت (HDMI/تلفزيون)، وإلا نافذة عادية على الشاشة الرئيسية.
// تشارك جلسة الدخول مع النافذة الرئيسية (العملية الرئيسية واحدة) وتعرض شاشة المطبخ فقط.
function openKdsWindow() {
  if (kdsWin && !kdsWin.isDestroyed()) { kdsWin.focus(); return { external: !!kdsWin.__external, reused: true }; }
  const primary = screen.getPrimaryDisplay(), ext = screen.getAllDisplays().find((d) => d.id !== primary.id), b = (ext || primary).workArea;
  kdsWin = new BrowserWindow({
    x: b.x, y: b.y, width: ext ? b.width : Math.min(1100, b.width), height: ext ? b.height : Math.min(720, b.height),
    fullscreen: !!ext, autoHideMenuBar: true, backgroundColor: '#EEF1F0', title: 'شاشة المطبخ',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  kdsWin.__external = !!ext;
  kdsWin.setMenuBarVisibility(false);
  kdsWin.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { kds: '1' } });
  kdsWin.on('closed', () => { kdsWin = null; });
  return { external: !!ext, reused: false };
}

function createWindow() {
  // حجم النافذة يتبع مساحة الشاشة المتاحة (بدون شريط المهام) بدل رقم ثابت
  const wa = screen.getPrimaryDisplay().workArea;
  mainWin = new BrowserWindow({
    x: wa.x, y: wa.y,
    width: Math.min(1366, wa.width), height: Math.min(860, wa.height),
    minWidth: 900, minHeight: 600,
    show: false,
    autoHideMenuBar: true,           // إخفاء File/Edit/View (يظهر مؤقتاً بزر Alt)
    backgroundColor: '#EEF1F0',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);     // إزالة القائمة نهائياً من نسخة الإنتاج
  mainWin.setMenuBarVisibility(false);
  mainWin.maximize();                // يملأ الشاشة
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('closed', () => { if (kdsWin && !kdsWin.isDestroyed()) kdsWin.close(); }); // إغلاق الرئيسية يغلق شاشة المطبخ معها

  // تكبير/تصغير تلقائي: التصميم الأساسي 1366x768. الشاشات الأصغر تُصغَّر والأكبر تُكبَّر (بين 0.8 و 1.3)
  const fit = () => {
    if (!mainWin || mainWin.isDestroyed()) return;
    const [w, h] = mainWin.getContentSize();
    const f = Math.max(0.8, Math.min(1.3, Math.min(w / 1366, h / 768)));
    mainWin.webContents.setZoomFactor(Math.round(f * 100) / 100);
  };
  mainWin.webContents.on('did-finish-load', fit);
  mainWin.on('resize', fit);
  mainWin.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  // Ctrl + / Ctrl - / Ctrl 0 للتحكم اليدوي بالحجم
  mainWin.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown' || !i.control) return;
    const z = mainWin.webContents.getZoomFactor();
    if (i.key === '=' || i.key === '+') { mainWin.webContents.setZoomFactor(Math.min(1.6, z + 0.1)); e.preventDefault(); }
    else if (i.key === '-') { mainWin.webContents.setZoomFactor(Math.max(0.6, z - 0.1)); e.preventDefault(); }
    else if (i.key === '0') { fit(); e.preventDefault(); }
  });
  mainWin.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  db.init();
  orders.init();
  shifts.init();
  inventory.init();
  crm.init();
  reservations.init();
  qrmenu.apply().catch((e) => auth.audit('qrmenu_error', e.message));
  waiterApi.init({ sendToKitchen });
  waiterApi.apply().catch((e) => auth.audit('waiter_api_error', e.message));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('will-quit', () => { qrmenu.stop(); waiterApi.stop(); orders.close(); });
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());

// كل فحص الصلاحيات هنا في العملية الرئيسية (لا نثق بالواجهة)
const handle = (channel, perm, fn) =>
  ipcMain.handle(channel, (_e, ...args) => {
    if (perm) {
      const u = auth.current();
      if (!u || ![].concat(perm).some((p) => auth.can(u.role, p))) throw new Error('غير مصرح لك بهذا الإجراء');
    }
    return fn(...args);
  });

handle('auth:status', null, () => auth.status());
handle('auth:setup', null, (name, pin) => auth.setupOwner(name, pin));
handle('auth:users', null, () => auth.loginList());
handle('auth:login', null, (id, pin) => auth.login(id, pin));
handle('auth:logout', null, () => auth.logout());

handle('users:list', 'users.manage', () => auth.list());
handle('users:create', 'users.manage', (u) => auth.createUser(u));
handle('users:update', 'users.manage', (id, patch) => auth.updateUser(id, patch));
handle('users:resetPin', 'users.manage', (id, pin) => auth.resetPin(id, pin));
handle('audit:list', 'audit.view', () => auth.auditList());

handle('menu:get', ['menu', 'pos'], () => menu.get());
handle('menu:saveCategory', 'menu', (c) => menu.saveCategory(c));
handle('menu:deleteCategory', 'menu', (id) => menu.deleteCategory(id));
handle('menu:reorderCategories', 'menu', (ids) => menu.reorderCategories(ids));
handle('menu:setVariantSoldOut', ['menu', 'pos'], (id, vid, v) => menu.setVariantSoldOut(id, vid, v));
handle('menu:saveItem', 'menu', (i) => menu.saveItem(i));
handle('menu:deleteItem', 'menu', (id) => menu.deleteItem(id));
handle('menu:setSoldOut', ['menu', 'pos'], (id, v) => menu.setSoldOut(id, v));
handle('menu:saveGroup', 'menu', (g) => menu.saveGroup(g));
handle('menu:deleteGroup', 'menu', (id) => menu.deleteGroup(id));

handle('orders:quote', 'pos', (p) => orders.quote(p));
// customerId: ربط العميل بالطلب (null لإزالته). غير المُرسَل يُبقي الربط كما هو
handle('orders:save', 'pos', async (p) => {
  const o = orders.save(p);
  if (p.customerId !== undefined) crm.attach(o.id, p.customerId || null);
  else if (o.type === 'delivery' && p.customer?.phone && !crm.customerOf(o.id)) { // ربط تلقائي بعميل مسجّل بنفس جوال التوصيل
    const c = crm.findByPhone(p.customer.phone); if (c) crm.attach(o.id, c.id);
  }
  const out = orders.get(o.id);
  // أصناف أُرسلت ثم قُلّلت/حُذفت: تذكرة «ملغاة» على شاشة المحطة + ورقة إلغاء مطبوعة (إن فُعّلت الطباعة التلقائية)
  if (o.removedSent?.length && kitchen.enabled()) {
    out.cancelNotified = [], out.printErrors = [];
    try {
      for (const t of kitchen.cancelItems(o.id, o.removedSent)) {
        out.cancelNotified.push(t.stationName);
        const st = kitchen.station(t.stationId);
        if (st?.autoPrint) { try { await printKot(t); } catch (e) { out.printErrors.push(`${st.name}: ${e.message}`); } }
      }
    } catch (e) { auth.audit('kitchen_error', e.message); }
  }
  return out;
});
// طباعة تذكرة مطبخ على طابعة محطتها (صامتة)
async function printKot(t) {
  const pr = kitchen.station(t.stationId)?.printer;
  if (!pr) throw new Error('المحطة غير موجودة');
  const html = buildKotHTML(t, { width: pr.width });
  if (pr.mode === 'escpos') return printEscPos(html, { width: pr.width, host: pr.host });
  if (!pr.deviceName) throw new Error('لم تُحدد طابعة للمحطة');
  return printSystem(html, { width: pr.width, deviceName: pr.deviceName, silent: true });
}
async function sendToKitchen(orderId) {
  const tickets = kitchen.send(orderId), printErrors = [];
  for (const t of tickets) {
    const st = kitchen.station(t.stationId);
    if (st?.autoPrint) { try { await printKot(t); } catch (e) { printErrors.push(`${st.name}: ${e.message}`); } }
  }
  return { tickets, printErrors };
}
// الدفع يُرسل أي أصناف لم تُرسل بعد حتى لا يفوت المطبخ شيء
handle('orders:pay', 'pos', async (id, payments) => {
  const o = orders.pay(id, payments);
  try { crm.onPaid(id); } catch (e) { auth.audit('crm_error', `#${o.number}: ${e.message}`); } // خطأ ولاء لا يوقف البيع
  if (kitchen.enabled()) { try { await sendToKitchen(id); } catch (e) { if (!/لا توجد أصناف/.test(e.message)) auth.audit('kitchen_error', e.message); } }
  return o;
});
handle('kitchen:stations', ['kitchen.view', 'kitchen'], () => kitchen.stations());
handle('kitchen:stationSave', 'kitchen', (s) => kitchen.saveStation(s));
handle('kitchen:stationDelete', 'kitchen', (id) => kitchen.deleteStation(id));
handle('kitchen:send', 'pos', (orderId) => sendToKitchen(orderId));
handle('kitchen:board', 'kitchen.view', (stationId) => kitchen.board(stationId));
handle('kitchen:bump', 'kitchen.view', (id, action) => kitchen.bump(id, action));
handle('app:kdsWindow', 'kitchen.view', () => openKdsWindow());
handle('kitchen:reject', 'kitchen.view', (id, index, reason) => kitchen.rejectItem(id, index, reason));
handle('kitchen:soldOut', 'kitchen.view', (itemId, variantId, v) => kitchen.setSoldOut(itemId, variantId || null, v));
handle('kitchen:reprint', ['pos', 'kitchen.view'], (id) => printKot(kitchen.ticket(id)));
handle('orders:get', 'pos', (id) => orders.get(id));
handle('orders:list', 'pos', (f) => orders.list(f));
handle('orders:void', 'pos', async (id, reason) => {
  const was = orders.get(id).status;
  // التذاكر الحية قبل الإلغاء: هذه التي يجب إبلاغ المطبخ بإيقافها
  const live = kitchen.enabled() ? kitchen.board().filter((t) => t.orderId === id && ['new', 'preparing', 'ready'].includes(t.status)) : [];
  const o = orders.voidOrder(id, reason);
  if (was === 'paid') { try { crm.onVoid(id); } catch (e) { auth.audit('crm_error', `#${o.number}: ${e.message}`); } }
  // ورقة إلغاء على طابعة كل محطة لها طباعة تلقائية (فشل الطباعة لا يوقف الإلغاء)
  const printErrors = [];
  for (const t of live) {
    const st = kitchen.station(t.stationId);
    if (st?.autoPrint) { try { await printKot({ ...t, status: 'cancelled' }); } catch (e) { printErrors.push(`${st.name}: ${e.message}`); } }
  }
  return { ...o, printErrors };
});
handle('tables:floor', 'tables', () => tables.floor());
handle('tables:save', 'tables.manage', (t) => tables.save(t));
handle('tables:delete', 'tables.manage', (id) => tables.remove(id));
handle('orders:move', 'tables', (id, to) => orders.moveOrder(id, to));
handle('orders:bill', 'tables', (id, on) => orders.requestBill(id, on !== false));
handle('orders:merge', 'tables', (a, b) => orders.merge(a, b));
handle('orders:split', 'tables', (id, picks) => {
  const r = orders.split(id, picks), cid = crm.customerOf(id);
  if (cid) crm.attach(r.created.id, cid); // الفاتورة الجديدة ترث العميل
  return r;
});
const receiptData = (id) => ({ ...orders.toReceipt(id), loyalty: crm.receiptInfo(id) });
handle('orders:receipt', 'print', (id, opts) => buildReceiptHTML(receiptData(id), opts));
handle('orders:print', 'print', async (id, opts) => {
  const o = receiptData(id);
  const html = buildReceiptHTML(o, opts);
  const r = opts.mode === 'escpos' ? await printEscPos(html, opts) : await printSystem(html, opts);
  auth.audit('print', `إيصال #${o.number} (${opts.mode}, ${opts.width}mm)`);
  return r;
});

// ---------- الورديات والتقارير ----------
// الكاشير لا يرى «المتوقع» قبل أن يدخل المعدود (إغلاق أعمى)؛ المدير/المالك/المحاسب يرونه
const sees = () => auth.can(auth.current().role, 'reports');
const hide = (s) => (s && !s.closedAt && !sees() ? { ...s, expectedCents: null } : s);
handle('shift:current', 'shift', () => ({ shift: hide(shifts.current()), requireShift: shifts.requireShift() }));
handle('shift:open', 'shift', (cash) => hide(shifts.open(cash)));
handle('shift:move', 'shift', (type, amount, reason) => hide(shifts.addMove(type, amount, reason)));
handle('shift:close', 'shift', (counted, note) => shifts.close(counted, note));
handle('shift:require', 'settings', (v) => shifts.setRequireShift(v));
handle('shift:list', 'reports', () => shifts.list());
handle('shift:get', ['reports', 'shift'], (id) => { const s = shifts.summary(id); if (!s.closedAt && !sees()) return hide(s); return s; });
const shiftHtml = (id, opts) => buildShiftHTML(shifts.summary(id), { ...opts, showExpected: sees() || !!shifts.summary(id).closedAt });
handle('shift:html', 'print', (id, opts) => shiftHtml(id, opts));
handle('shift:print', 'print', async (id, opts) => {
  const html = shiftHtml(id, opts);
  const r = opts.mode === 'escpos' ? await printEscPos(html, opts) : await printSystem(html, opts);
  auth.audit('print', `تقرير وردية #${id} (${opts.mode}, ${opts.width}mm)`);
  return r;
});
handle('report:sales', 'reports', (r) => reports.sales(r));
handle('report:export', 'reports', async (r) => {
  const csv = reports.toCsv(reports.sales(r));
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, { defaultPath: `sales-${r.from}_${r.to}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, csv, 'utf8');
  auth.audit('report_export', `مبيعات ${r.from} → ${r.to}`);
  return true;
});

// التوصيل: الكاشير يرى الإعدادات (للأجرة) ويدير لوحة التوصيل؛ السائقون والأجور والأسعار للمالك/المدير
handle('delivery:config', ['delivery', 'pos'], () => delivery.config());
handle('delivery:saveConfig', 'delivery.manage', (c) => delivery.saveConfig(c));
handle('delivery:drivers', ['delivery', 'delivery.manage'], () => delivery.drivers());
handle('delivery:saveDriver', 'delivery.manage', (d) => delivery.saveDriver(d));
handle('delivery:removeDriver', 'delivery.manage', (id) => delivery.removeDriver(id));
handle('delivery:board', 'delivery', (f) => delivery.board(f));
handle('delivery:assign', 'delivery', (id, driverId) => delivery.assign(id, driverId));
handle('delivery:status', 'delivery', (id, to) => delivery.setStatus(id, to));
handle('delivery:report', 'delivery.manage', (r) => delivery.report(r));

handle('report:deep', 'reports', (r) => reportsDeep.deep(r));
handle('report:exportDeep', 'reports', async (r) => {
  const csv = reportsDeep.toCsv(reportsDeep.deep(r));
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, { defaultPath: `deep-${r.from}_${r.to}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, csv, 'utf8');
  auth.audit('report_export', `تقارير أعمق ${r.from} → ${r.to}`);
  return true;
});

// ---------- العملاء والولاء وكروت الهدايا والحجوزات ----------
handle('cust:list', 'customers', (q) => crm.list(q));
handle('cust:get', 'customers', (id) => crm.get(id));
handle('cust:find', ['customers', 'pos'], (phone) => crm.findByPhone(phone));
handle('cust:save', 'customers', (c) => crm.save(c));
handle('cust:active', 'crm.manage', (id, v) => crm.setActive(id, v));
handle('cust:points', 'crm.manage', (id, d, note) => crm.adjustPoints(id, d, note));
handle('loyalty:get', ['customers', 'pos'], () => crm.loyalty());
handle('loyalty:set', 'settings', (s) => crm.setLoyalty(s));
handle('gift:list', 'giftcards', () => crm.giftList());
handle('gift:get', ['giftcards', 'pos'], (code) => crm.giftGet(code));
handle('gift:issue', 'giftcards', (p) => crm.giftIssue(p));
handle('gift:void', 'crm.manage', (code, reason) => crm.giftVoid(code, reason));
handle('waiter:get', 'qrmenu', () => waiterApi.info());
handle('waiter:set', 'qrmenu', (p) => waiterApi.setConfig(p));
handle('waiter:revoke', 'qrmenu', () => { waiterApi.revokeAll(); return waiterApi.info(); });
handle('waiter:regenCert', 'qrmenu', () => waiterApi.regenerateCert());
handle('qr:get', 'qrmenu', () => qrmenu.info());
handle('qr:set', 'qrmenu', (p) => qrmenu.setConfig(p));
// tableId فارغ = كل الرموز (العام + الطاولات)
const qrSheet = (tableId, opts) => {
  const all = qrmenu.info().links, pick = tableId === '__general__' ? all.filter((l) => !l.id) : tableId ? all.filter((l) => l.id === tableId) : all;
  if (!pick.length) throw new Error('الطاولة غير موجودة');
  return buildQrSheetHTML(pick, { width: opts.width, restaurant: db.get().settings.restaurant });
};
handle('qr:html', 'qrmenu', (tableId, opts) => qrSheet(tableId, opts));
handle('qr:print', 'qrmenu', async (tableId, opts) => {
  const html = qrSheet(tableId, opts);
  const r = opts.mode === 'escpos' ? await printEscPos(html, opts) : await printSystem(html, opts);
  auth.audit('print', `رموز QR (${opts.mode}, ${opts.width}mm)`);
  return r;
});
handle('gift:liab', 'crm.manage', () => crm.giftLiabilities());
handle('gift:html', ['giftcards', 'print'], (code, opts) => buildGiftHTML(crm.giftVoucher(code), opts));
handle('gift:print', ['giftcards', 'print'], async (code, opts) => {
  const html = buildGiftHTML(crm.giftVoucher(code), opts);
  const r = opts.mode === 'escpos' ? await printEscPos(html, opts) : await printSystem(html, opts);
  auth.audit('print', `قسيمة كرت هدية (${opts.mode}, ${opts.width}mm)`);
  return r;
});
handle('cust:merge', 'crm.manage', (from, into) => crm.merge(from, into));
handle('res:prefill', 'reservations', (id) => reservations.seatPrefill(id));
handle('res:list', 'reservations', (f) => reservations.list(f));
handle('res:save', 'reservations', (r) => reservations.save(r));
handle('res:status', 'reservations', (id, to, tableId) => reservations.setStatus(id, to, tableId));
handle('res:pending', 'reservations', () => reservations.pendingToday());

// ---------- المخزون ----------
handle('inv:list', 'inventory', () => inventory.list());
handle('inv:low', ['inventory'], () => inventory.lowCount());
handle('inv:save', 'inventory', (i) => inventory.save(i));
handle('inv:delete', 'inventory', (id) => inventory.remove(id));
handle('inv:adjust', 'inventory', (id, type, qty, note) => inventory.adjust(id, type, qty, note));
handle('inv:count', 'inventory', (c) => inventory.count(c));
handle('inv:recipeSave', 'inventory', (itemId, lines, variantId) => inventory.recipeSave(itemId, lines, variantId));
handle('inv:moves', 'inventory', (id, limit) => inventory.moves(id, limit));
handle('po:list', 'inventory', () => inventory.poList());
handle('po:save', 'inventory', (p) => inventory.poSave(p));
handle('po:status', 'inventory', (id, to) => inventory.poStatus(id, to));
handle('po:receive', 'inventory', (id, lines) => inventory.poReceive(id, lines));

handle('printers:list', 'print', async () => (await mainWin.webContents.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault })));
handle('receipt:html', 'print', (order, opts) => buildReceiptHTML(order, opts));
handle('print:do', 'print', async (order, opts) => {
  const html = buildReceiptHTML(order, opts);
  const r = opts.mode === 'escpos' ? await printEscPos(html, opts) : await printSystem(html, opts);
  auth.audit('print', `إيصال #${order.number} (${opts.mode}, ${opts.width}mm)`);
  return r;
});
