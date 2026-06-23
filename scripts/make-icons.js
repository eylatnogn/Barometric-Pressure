/* Generates the app PNG icons with no external dependencies.
   Draws a simple barometer gauge so the icon reads as a "pressure" app.
   Run: node scripts/make-icons.js   (re-run if you change the design) */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function makeIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const R = size * (maskable ? 0.30 : 0.36); // gauge radius
  const bgR = size * 0.5;

  // palette
  const bgTop = [26, 42, 79];   // #1a2a4f
  const bgBot = [14, 22, 38];   // #0e1626
  const ring = [91, 141, 239];  // accent
  const needle = [78, 201, 168];

  function set(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const ia = a / 255;
    buf[i] = Math.round(buf[i] * (1 - ia) + r * ia);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - ia) + g * ia);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - ia) + b * ia);
    buf[i + 3] = Math.max(buf[i + 3], a);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      // background: rounded (circle) for normal, full-bleed for maskable
      const t = y / size;
      const bg = [
        Math.round(bgTop[0] + (bgBot[0] - bgTop[0]) * t),
        Math.round(bgTop[1] + (bgBot[1] - bgTop[1]) * t),
        Math.round(bgTop[2] + (bgBot[2] - bgTop[2]) * t)
      ];
      if (maskable) {
        set(x, y, bg[0], bg[1], bg[2], 255);
      } else if (d <= bgR) {
        const edge = Math.min(1, (bgR - d) / 2);
        set(x, y, bg[0], bg[1], bg[2], Math.round(255 * edge));
      }
      // gauge ring
      const ringW = size * 0.045;
      if (Math.abs(d - R) <= ringW) {
        const aa = 1 - Math.abs(d - R) / ringW;
        set(x, y, ring[0], ring[1], ring[2], Math.round(220 * aa));
      }
      // tick marks around the ring
      const ang = Math.atan2(dy, dx);
      const deg = ((ang * 180) / Math.PI + 360) % 360;
      if (d > R - size * 0.11 && d < R - ringW) {
        const near = Math.abs(((deg + 11.25) % 22.5) - 11.25);
        if (near < 1.6) set(x, y, ring[0], ring[1], ring[2], 150);
      }
    }
  }

  // needle pointing up-right (rising pressure)
  const na = -Math.PI / 4;
  const len = R - size * 0.05;
  for (let s = 0; s <= len; s++) {
    const x = cx + Math.cos(na) * s;
    const y = cy + Math.sin(na) * s;
    const w = size * 0.018 * (1 - s / len) + size * 0.006;
    for (let oy = -w; oy <= w; oy++)
      for (let ox = -w; ox <= w; ox++)
        set(Math.round(x + ox), Math.round(y + oy), needle[0], needle[1], needle[2], 255);
  }
  // hub
  const hub = size * 0.045;
  for (let y = -hub; y <= hub; y++)
    for (let x = -hub; x <= hub; x++)
      if (Math.hypot(x, y) <= hub) set(Math.round(cx + x), Math.round(cy + y), 238, 242, 251, 255);

  return encodePNG(buf, size, size);
}

function encodePNG(rgba, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const tb = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-180.png", 180, false],
  ["icon-maskable-512.png", 512, true]
];
for (const [name, size, maskable] of targets) {
  fs.writeFileSync(path.join(outDir, name), makeIcon(size, { maskable }));
  console.log("wrote icons/" + name);
}
