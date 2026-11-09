const crypto = require('crypto');
const db = require('./db');
const { ROLES, can } = require('./permissions');

let session = null;               // المستخدم الحالي (في ذاكرة العملية الرئيسية فقط)
const fails = new Map();          // userId -> { n, until }

const hash = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
const checkPin = (pin) => { if (!/^\d{4,8}$/.test(String(pin))) throw new Error('الرمز السري يجب أن يكون 4 إلى 8 أرقام'); };
const pub = (u) => ({ id: u.id, name: u.name, role: u.role, active: u.active });
const activeOwners = () => db.get().users.filter((u) => u.role === 'owner' && u.active);

function audit(action, detail = '') {
  const d = db.get();
  d.audit.push({ ts: new Date().toISOString(), userId: session?.id || null, userName: session?.name || '-', action, detail });
  if (d.audit.length > 5000) d.audit.splice(0, d.audit.length - 5000);
  db.save();
}

const current = () => session;
const status = () => ({ needsSetup: db.get().users.length === 0, user: session && { ...session, perms: ROLES[session.role] } });
const loginList = () => db.get().users.filter((u) => u.active).map(({ id, name, role }) => ({ id, name, role }));

function setupOwner(name, pin) {
  if (db.get().users.length) throw new Error('تم الإعداد مسبقاً');
  if (!String(name).trim()) throw new Error('الاسم مطلوب');
  checkPin(pin);
  const salt = crypto.randomBytes(16).toString('hex');
  db.get().users.push({ id: crypto.randomUUID(), name: String(name).trim(), role: 'owner', active: true, salt, pinHash: hash(pin, salt) });
  db.save();
  audit('setup', 'إنشاء حساب المالك');
}

// تشغيل دالة متزامنة بهوية مستخدم آخر (لطلبات تطبيق النادل) دون المساس بجلسة الكاشير على الشاشة
function runAs(user, fn) {
  const prev = session;
  session = pub(user);
  try { return fn(); } finally { session = prev; }
}

// فحص الرمز السري مع قفل المحاولات. api=true: لا يُسجَّل خروج مستخدم الشاشة عند الفشل ولا يُغيَّر session
function check(id, pin, api = false) {
  const f = fails.get(id);
  if (f && f.until > Date.now()) throw new Error(`محاولات كثيرة، انتظر ${Math.ceil((f.until - Date.now()) / 1000)} ثانية`);
  const u = db.get().users.find((x) => x.id === id && x.active);
  const ok = u && crypto.timingSafeEqual(Buffer.from(hash(String(pin), u.salt)), Buffer.from(u.pinHash));
  if (!ok) {
    const n = (f?.n || 0) + 1;
    fails.set(id, { n, until: n >= 5 ? Date.now() + 30000 : 0 });
    if (u) { if (api) runAs(u, () => audit('waiter_login_failed', u.name)); else { session = null; audit('login_failed', u.name); } }
    throw new Error('الرمز السري غير صحيح');
  }
  fails.delete(id);
  return u;
}

function login(id, pin) {
  const u = check(id, pin);
  session = pub(u);
  audit('login');
  return status().user;
}
// دخول تطبيق النادل: يتحقق من الرمز ويعيد المستخدم دون فتح جلسة على الشاشة
function loginApi(id, pin) {
  const u = check(id, pin, true);
  runAs(u, () => audit('waiter_login'));
  return pub(u);
}
function logout() { if (session) audit('logout'); session = null; }

// ---- إدارة المستخدمين (الصلاحية تُفحص في main.js) ----
const list = () => db.get().users.map(pub);

function createUser({ name, role, pin }) {
  if (!ROLES[role]) throw new Error('دور غير صالح');
  if (role === 'owner' && session.role !== 'owner') throw new Error('فقط المالك يضيف مالكاً');
  if (!String(name).trim()) throw new Error('الاسم مطلوب');
  checkPin(pin);
  const salt = crypto.randomBytes(16).toString('hex');
  db.get().users.push({ id: crypto.randomUUID(), name: String(name).trim(), role, active: true, salt, pinHash: hash(pin, salt) });
  db.save();
  audit('user_create', `${name} (${role})`);
}

function updateUser(id, { role, active }) {
  const d = db.get();
  const u = d.users.find((x) => x.id === id);
  if (!u) throw new Error('المستخدم غير موجود');
  if ((u.role === 'owner' || role === 'owner') && session.role !== 'owner') throw new Error('فقط المالك يعدّل حسابات المالك');
  const newRole = role ?? u.role, newActive = active ?? u.active;
  if (u.role === 'owner' && u.active && (newRole !== 'owner' || !newActive) && activeOwners().length <= 1) throw new Error('لا يمكن تعطيل آخر مالك');
  if (!ROLES[newRole]) throw new Error('دور غير صالح');
  u.role = newRole; u.active = newActive;
  if (session.id === u.id) session = pub(u);
  db.save();
  audit('user_update', `${u.name}: ${newRole}, ${newActive ? 'مفعّل' : 'معطّل'}`);
}

function resetPin(id, pin) {
  const u = db.get().users.find((x) => x.id === id);
  if (!u) throw new Error('المستخدم غير موجود');
  if (u.role === 'owner' && session.role !== 'owner') throw new Error('فقط المالك يغيّر رمز المالك');
  checkPin(pin);
  u.salt = crypto.randomBytes(16).toString('hex');
  u.pinHash = hash(pin, u.salt);
  db.save();
  audit('pin_reset', u.name);
}

const auditList = () => db.get().audit.slice(-200).reverse();

module.exports = { current, status, loginList, setupOwner, login, loginApi, runAs, logout, list, createUser, updateUser, resetPin, auditList, audit, can };
