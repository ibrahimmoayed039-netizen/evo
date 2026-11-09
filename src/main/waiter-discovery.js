// العثور التلقائي على الكاشير: يستمع على UDP ويردّ على بث «من هنا؟» من تطبيق النادل بعنوان الخادم وبصمة شهادته.
// لا يحمل الرد أي سر؛ التطبيق يتحقق من الشهادة نفسها عند الاتصال (البصمة هنا للمطابقة فقط، لا للثقة).
const dgram = require('dgram');

const DEFAULT_PORT = 3839;
const MAGIC = 'RESTAURANT-POS-WAITER?';
let sock = null, boundPort = null, lastError = '';
const hits = new Map();

function limited(ip) {
  const now = Date.now(); let h = hits.get(ip);
  if (!h || now - h.t > 60000) { h = { t: now, n: 0 }; hits.set(ip, h); }
  if (hits.size > 2000) for (const [k, v] of hits) if (now - v.t > 60000) hits.delete(k);
  return ++h.n > 30; // 30 ردّاً في الدقيقة لكل عنوان (يمنع استعمال الخادم لتضخيم الحركة)
}

function stop() {
  return new Promise((ok) => {
    if (!sock) return ok();
    const s = sock; sock = null; boundPort = null;
    try { s.close(() => ok()); } catch { ok(); }
  });
}

// getInfo() => { name, port, fp } ؛ فشل الربط لا يوقف تطبيق النادل (يبقى الإدخال اليدوي للعنوان)
function start(port, getInfo) {
  return new Promise((ok) => {
    lastError = '';
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', (msg, rinfo) => {
      if (msg.length > 64 || msg.toString('utf8').trim() !== MAGIC || limited(rinfo.address)) return;
      try {
        const i = getInfo();
        s.send(Buffer.from(JSON.stringify({ app: 'restaurant-pos-waiter', v: 2, name: i.name || '', port: i.port, fp: i.fp })), rinfo.port, rinfo.address);
      } catch { /* لا شيء */ }
    });
    s.once('error', (e) => { lastError = e.code === 'EADDRINUSE' ? `منفذ البحث التلقائي ${port} مستخدم` : e.message; try { s.close(); } catch { /* */ } ok(); });
    s.bind(port, '0.0.0.0', () => { sock = s; boundPort = s.address().port; s.on('error', (e) => { lastError = e.message; }); ok(); });
  });
}

const status = () => ({ running: !!sock, port: boundPort, error: lastError });
module.exports = { DEFAULT_PORT, MAGIC, start, stop, status };
