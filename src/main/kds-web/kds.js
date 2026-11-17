// شاشة المطبخ للمتصفح (تابلت/تلفزيون/كمبيوتر على نفس الشبكة). كل النصوص تُدرج بـ textContent (لا innerHTML) منعاً للحقن.
'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* التخزين غير متاح */ } } };
const ACTIONS = {
  new: [['start', 'بدء'], ['ready', 'جاهز']],
  preparing: [['ready', 'جاهز'], ['back', '↩']],
  ready: [['done', 'تم التسليم'], ['back', '↩']],
  cancelled: [['ack', 'تم']],
};
let token = store.get('kdsToken'), station = store.get('kdsStation'), user = store.get('kdsUser');
let skew = 0, seen = new Set(), first = true, timer = null, audio = null, wake = null;

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { signOut(); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'خطأ'), { status: r.status });
  return j;
}

function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(); o.connect(audio.destination); o.frequency.value = 880; o.start(); setTimeout(() => o.stop(), 300);
  } catch { /* الصوت غير متاح */ }
}
async function keepAwake() { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* غير مدعوم */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && token) keepAwake(); });

// ---------- الدخول ----------
async function showLogin() {
  clearInterval(timer); timer = null;
  $('app').classList.add('hide'); $('login').classList.remove('hide');
  $('lerr').textContent = '';
  const sel = $('who'); sel.textContent = '';
  try {
    const { staff } = await api('GET', '/api/staff?kds=1');
    staff.forEach((s) => { const o = el('option', '', s.name); o.value = s.id; sel.appendChild(o); });
    if (!staff.length) $('lerr').textContent = 'لا يوجد مستخدم بدور «مطبخ». أنشئه من صفحة المستخدمين في الكاشير.';
  } catch (e) { $('lerr').textContent = 'تعذر الاتصال بالكاشير: ' + e.message; }
}
async function doLogin() {
  $('lerr').textContent = '';
  audio = audio || (() => { try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } })(); // يحتاج لمسة المستخدم
  try {
    const r = await api('POST', '/api/login', { id: $('who').value, pin: $('pin').value, kds: true });
    token = r.token; user = r.user.name; store.set('kdsToken', token); store.set('kdsUser', user);
    $('pin').value = ''; start();
  } catch (e) { $('lerr').textContent = e.message; $('pin').value = ''; }
}
function signOut() { token = ''; store.set('kdsToken', ''); clearInterval(timer); timer = null; showLogin(); }

// ---------- الشاشة ----------
function start() {
  $('login').classList.add('hide'); $('app').classList.remove('hide');
  $('who2').textContent = user; seen = new Set(); first = true;
  keepAwake(); refresh(); clearInterval(timer); timer = setInterval(refresh, 3000);
}
function drawTabs(stations) {
  if (station && !stations.some((s) => s.id === station)) station = '';
  const t = $('tabs'); t.textContent = '';
  [{ id: '', name: 'كل المحطات' }, ...stations].forEach((s) => {
    const b = el('button', s.id === station ? 'on' : '', s.name);
    b.onclick = () => { station = s.id; store.set('kdsStation', station); first = true; seen = new Set(); refresh(); };
    t.appendChild(b);
  });
}
// نافذة اختيار سبب الإلغاء (أزرار كبيرة للمس)
function askReason(t, idx) {
  const i = t.items[idx], ov = el('div', 'ov'), box = el('div', 'bx');
  box.appendChild(el('h3', '', `إلغاء «${i.name}» (${i.qty}×)`));
  box.appendChild(el('div', 'muted', 'يُحذف من الفاتورة ويصل النادل تنبيه بالسبب.'));
  const err = el('div', 'err');
  ['نفد', 'خطأ في الطلب', 'لا يمكن تحضيره', 'سبب آخر'].forEach((r) => {
    const b = el('button', '', r);
    b.onclick = async () => {
      b.disabled = true;
      try { await api('POST', `/api/kds/tickets/${t.id}/reject`, { index: idx, reason: r }); ov.remove(); refresh(); } catch (e) { err.textContent = e.message; b.disabled = false; }
    };
    box.appendChild(b);
  });
  const x = el('button', 'sec', 'تراجع'); x.onclick = () => ov.remove();
  box.appendChild(x); box.appendChild(err); ov.appendChild(box); document.body.appendChild(ov);
}
function card(t) {
  const m = Math.max(0, Math.floor((Date.now() - skew - new Date(t.createdAt)) / 60000));
  const c = el('div', `kt ${t.status} ${m >= 20 ? 'late' : m >= 10 ? 'warn' : ''}`);
  const h = el('div', 'kh');
  h.appendChild(el('b', '', `#${t.orderNumber}${t.batch > 1 ? ` · دفعة ${t.batch}` : ''}`));
  h.appendChild(el('span', '', `${t.type}${t.tableLabel ? ' ' + t.tableLabel : ''}`));
  h.appendChild(el('span', 'tm', `${m} د`));
  c.appendChild(h);
  if (!station) c.appendChild(el('div', 'ks', t.stationName));
  if (t.status === 'cancelled') c.appendChild(el('div', 'xx', 'ملغاة — أوقف التحضير'));
  const ul = el('ul');
  t.items.forEach((i, idx) => {
    const li = el('li'); li.appendChild(el('b', '', `${i.qty}× `));
    if (i.rejected) {
      const s = el('s', '', i.name); li.appendChild(s); li.appendChild(el('small', 'nt', 'ملغى: ' + i.rejected.reason));
    } else li.appendChild(document.createTextNode(i.name));
    if (i.itemId && !i.rejected && ['new', 'preparing'].includes(t.status)) {
      const rj = el('button', 'so sec', 'إلغاء');
      rj.onclick = () => askReason(t, idx);
      li.appendChild(rj);
    }
    if (i.itemId && !i.rejected && t.status !== 'cancelled') {
      const so = el('button', 'so' + (i.soldOut ? ' on' : ''), i.soldOut ? 'متوفر' : 'نفد');
      so.onclick = async () => {
        if (!i.soldOut && !confirm(`إيقاف «${i.name}» في المنيو؟ لن يستطيع الكاشير ولا النادل إضافته حتى تعيده متوفراً.`)) return;
        so.disabled = true;
        try { await api('POST', '/api/kds/soldout', { itemId: i.itemId, variantId: i.variantId || null, soldOut: !i.soldOut }); } catch (e) { $('net').textContent = e.message; $('net').classList.remove('hide'); }
        refresh();
      };
      li.appendChild(so);
      if (i.soldOut) li.appendChild(el('small', 'nt', 'نفد في المنيو'));
    }
    if ((i.mods || []).length) li.appendChild(el('small', '', '+ ' + i.mods.join('، ')));
    if (i.note) li.appendChild(el('small', 'nt', '** ' + i.note));
    ul.appendChild(li);
  });
  c.appendChild(ul);
  const ba = el('div', 'ba');
  (ACTIONS[t.status] || []).forEach(([a, label]) => {
    const b = el('button', a === 'back' ? 'sm' : '', label);
    b.onclick = async () => {
      b.disabled = true;
      try { await api('POST', `/api/kds/tickets/${t.id}/${a}`); } catch (e) { $('net').textContent = e.message; $('net').classList.remove('hide'); }
      refresh();
    };
    ba.appendChild(b);
  });
  c.appendChild(ba);
  return c;
}
async function refresh() {
  if (!token) return;
  let d;
  try { d = await api('GET', '/api/kds/board' + (station ? '?station=' + encodeURIComponent(station) : '')); }
  catch (e) { if (token) { $('net').textContent = 'انقطع الاتصال بالكاشير… تُعاد المحاولة تلقائياً'; $('net').classList.remove('hide'); } return; }
  $('net').classList.add('hide');
  skew = Date.now() - new Date(d.now).getTime();
  drawTabs(d.stations);
  if (d.tickets.some((t) => t.status === 'new' && !seen.has(t.id)) && !first) beep();
  d.tickets.forEach((t) => seen.add(t.id)); first = false;
  const b = $('board'); b.textContent = '';
  if (!d.stations.length) b.appendChild(el('div', 'empty', 'لم تُعرَّف محطات مطبخ بعد (من برنامج الكاشير ← المطبخ ← إدارة المحطات).'));
  else if (!d.tickets.length) b.appendChild(el('div', 'empty', 'لا توجد تذاكر'));
  else d.tickets.forEach((t) => b.appendChild(card(t)));
}

$('go').onclick = doLogin;
$('pin').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
$('out').onclick = async () => { try { await api('POST', '/api/logout'); } catch { /* تجاهل */ } signOut(); };
$('fs').onclick = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch { /* غير مدعوم */ } };
if (token) start(); else showLogin();
