const { BrowserWindow } = require('electron');
const net = require('net');

const PX = { 58: 384, 80: 576 }; // عرض نقاط الطابعة الحرارية (203dpi) تقريباً

async function loadHidden(html, widthPx) {
  const win = new BrowserWindow({ show: false, width: widthPx, height: 800 });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const h = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
  return { win, height: h };
}

// 1) طباعة عادية عبر النظام (تعمل مع أي طابعة، بما فيها الحرارية بتعريف ويندوز)
async function printSystem(html, { width = 80, deviceName = '', silent = false } = {}) {
  const { win, height } = await loadHidden(html, Math.round((width / 25.4) * 96));
  return new Promise((resolve, reject) => {
    win.webContents.print(
      {
        silent,
        deviceName,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: width * 1000, height: Math.max(50000, Math.round(height * 264.583) + 5000) },
      },
      (ok, err) => { win.destroy(); ok ? resolve(true) : reject(new Error(err || 'print failed')); }
    );
  });
}

// 2) ESC/POS عبر الشبكة (IP:9100) — نحول الإيصال لصورة ليعمل العربي بدون مشاكل الترميز
async function printEscPos(html, { width = 80, host, port = 9100 } = {}) {
  if (!host) throw new Error('أدخل عنوان IP للطابعة');
  const w = PX[width] || 576;
  const { win, height } = await loadHidden(html, w);
  win.setContentSize(w, height);
  await new Promise((r) => setTimeout(r, 150));
  let img = await win.webContents.capturePage();
  win.destroy();
  img = img.resize({ width: w });
  const { height: h } = img.getSize();
  const bmp = img.toBitmap(); // BGRA
  const wb = Math.ceil(w / 8);
  const chunks = [Buffer.from([0x1b, 0x40])]; // init
  const BAND = 200;
  for (let y0 = 0; y0 < h; y0 += BAND) {
    const rows = Math.min(BAND, h - y0);
    const data = Buffer.alloc(wb * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y0 + y) * w + x) * 4;
        const lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2];
        if (lum < 140) data[y * wb + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    chunks.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, wb & 255, wb >> 8, rows & 255, rows >> 8]), data);
  }
  chunks.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00])); // تغذية + قص
  const payload = Buffer.concat(chunks);
  await new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port }, () => s.end(payload));
    s.on('close', resolve);
    s.on('error', reject);
    s.setTimeout(8000, () => { s.destroy(); reject(new Error('timeout')); });
  });
  return true;
}

module.exports = { printSystem, printEscPos };
