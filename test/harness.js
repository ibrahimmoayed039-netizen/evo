// بيئة اختبار بلا Electron: تحاكي electron و better-sqlite3 (عبر node:sqlite المدمج في Node 22+).
const Module = require('module'), os = require('os'), fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-'));
class Database {
  constructor(f) { this.db = new DatabaseSync(f); }
  exec(s) { this.db.exec(s); }
  pragma(s) { return this.db.prepare('PRAGMA ' + s).all(); }
  prepare(s) { return this.db.prepare(s); }
  transaction(fn) { return (...a) => { this.db.exec('BEGIN'); try { const r = fn(...a); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }; }
  close() { this.db.close(); }
}
const load = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp } };
  if (req === 'better-sqlite3') return Database;
  return load.call(this, req, ...r);
};
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m}: المتوقع ${b} والفعلي ${a}`);
const throws = (fn, re, m) => { try { fn(); ok(false, m + ' (لم يرمِ خطأ)'); } catch (e) { ok(re.test(e.message), `${m}: ${e.message}`); } };
const done = () => { console.log(bad ? `فشل ${bad} من ${n}` : `نجح ${n} فحصاً`); process.exit(bad ? 1 : 0); };
module.exports = { tmp, ok, eq, throws, done };
