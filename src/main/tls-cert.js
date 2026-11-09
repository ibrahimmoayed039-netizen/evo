// شهادة TLS ذاتية التوقيع لخادم تطبيق النادل، تُنشأ محلياً بلا مكتبات خارجية (ترميز DER يدوي + crypto).
// الثقة: لا سلطة شهادات في شبكة المطعم، فيُثبّت التطبيق «بصمة» الشهادة (SHA-256) عند أول اتصال بعد تأكيدها من الشاشة.
// المفتاح الخاص يُحفظ في userData/waiter-tls.json ولا يظهر في الواجهة ولا في data.json.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const YEARS = 10;
const file = () => path.join(app.getPath('userData'), 'waiter-tls.json');

// ---------- ترميز DER ----------
const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => tlv(0x30, ...p);
const oid = (s) => {
  const a = s.split('.').map(Number), out = [a[0] * 40 + a[1]];
  for (const n of a.slice(2)) { const st = [n & 127]; let v = n >> 7; while (v) { st.unshift((v & 127) | 128); v >>= 7; } out.push(...st); }
  return tlv(0x06, Buffer.from(out));
};
const utcTime = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const name = (cn) => seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value));

function build(cn = 'Restaurant POS Waiter') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serial = crypto.randomBytes(16); serial[0] = (serial[0] & 0x7f) | 0x40; // موجب وبترميز أدنى
  const from = new Date(Date.now() - 24 * 3600 * 1000), to = new Date(from); to.setUTCFullYear(to.getUTCFullYear() + YEARS);
  const sigAlg = seq(oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
  const exts = tlv(0xa3, seq(
    ext('2.5.29.19', true, seq()),                                   // basicConstraints: ليست CA
    ext('2.5.29.15', true, Buffer.from([0x03, 0x02, 0x07, 0x80])),   // keyUsage: digitalSignature
    ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),          // extKeyUsage: serverAuth
  ));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), tlv(0x02, serial), sigAlg, name(cn), seq(utcTime(from), utcTime(to)), name(cn),
    publicKey.export({ type: 'spki', format: 'der' }), exts,
  );
  const sig = crypto.sign('sha256', tbs, privateKey); // DER (ECDSA-Sig-Value)
  const der = seq(tbs, sigAlg, tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const pem = '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').replace(/(.{64})/g, '$1\n').trim() + '\n-----END CERTIFICATE-----\n';
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem, notAfter: to.toISOString() };
}

const fingerprint = (certPem) => new crypto.X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase(); // 64 خانة hex
// الشكل المعروض للمقارنة بالعين: أول 20 خانة بمجموعات من 4 (نفس ما يعرضه التطبيق)
const pretty = (fp) => fp.slice(0, 20).toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');

let cache = null;
function load(force = false) {
  if (!force && cache) return cache;
  let s = null;
  if (!force) {
    try {
      s = JSON.parse(fs.readFileSync(file(), 'utf8'));
      const x = new crypto.X509Certificate(s.cert);
      if (!s.key || new Date(x.validTo).getTime() < Date.now() + 30 * 24 * 3600 * 1000) s = null; // منتهية أو قريبة الانتهاء
    } catch { s = null; }
  }
  if (!s) {
    s = build();
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    fs.renameSync(tmp, file());
  }
  cache = { key: s.key, cert: s.cert, fp: fingerprint(s.cert), notAfter: s.notAfter };
  return cache;
}
const regenerate = () => load(true);

module.exports = { load, regenerate, pretty, build };
