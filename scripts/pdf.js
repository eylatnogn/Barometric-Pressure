/* Minimal dependency-free PDF writer: Letter pages, the standard Helvetica /
   Helvetica-Bold fonts (no embedding needed), accurate word-wrapping via the
   built-in AFM width tables, inline bold runs, bullets, colored callout boxes,
   simple tables, and vector drawing for the cover icon. */
const zlib = require("zlib");

// Helvetica + Helvetica-Bold advance widths (per 1000 units) for ASCII 32..126.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

function charWidth(ch, bold) {
  const c = ch.charCodeAt(0);
  if (c < 32 || c > 126) return (bold ? HELVB : HELV)[65 - 32]; // fallback ~'A'
  return (bold ? HELVB : HELV)[c - 32];
}
function runWidth(text, bold, size) {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w / 1000) * size;
}
function escape(s) { return s.replace(/[\\()]/g, (m) => "\\" + m); }

class PDF {
  constructor() {
    this.W = 612; this.H = 792;
    this.mL = 56; this.mR = 56; this.mT = 56; this.mB = 56;
    this.x = this.mL;
    this.y = this.mT;          // distance from top
    this.pages = [];
    this.buf = [];             // current page content ops
    this.newPage();
  }
  newPage() { if (this.buf.length) this.pages.push(this.buf.join("\n")); this.buf = []; this.y = this.mT; }
  get contentW() { return this.W - this.mL - this.mR; }
  pdfY(yFromTop) { return this.H - yFromTop; }

  ensure(h) { if (this.y + h > this.H - this.mB) this.newPage(); }
  space(h) { this.y += h; if (this.y > this.H - this.mB) this.newPage(); }

  // raw ops ---------------------------------------------------------------
  rgb(c) { return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`; }
  rect(x, yTop, w, h, color) {
    this.buf.push(`${this.rgb(color)} rg ${x.toFixed(2)} ${(this.pdfY(yTop) - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  line(x1, y1, x2, y2, color, lw = 1) {
    this.buf.push(`${this.rgb(color)} RG ${lw} w ${x1.toFixed(2)} ${this.pdfY(y1).toFixed(2)} m ${x2.toFixed(2)} ${this.pdfY(y2).toFixed(2)} l S`);
  }
  // Approximate a circle with 4 Bezier curves (yc measured from top).
  circle(xc, ycTop, r, { fill, stroke, lw = 1 } = {}) {
    const k = 0.5523, Y = this.pdfY(ycTop);
    const p = [
      [xc + r, Y], [xc + r, Y + r * k, xc + r * k, Y + r, xc, Y + r],
      [xc - r * k, Y + r, xc - r, Y + r * k, xc - r, Y],
      [xc - r, Y - r * k, xc - r * k, Y - r, xc, Y - r],
      [xc + r * k, Y - r, xc + r, Y - r * k, xc + r, Y]
    ];
    let s = "";
    if (fill) s += `${this.rgb(fill)} rg `;
    if (stroke) s += `${this.rgb(stroke)} RG ${lw} w `;
    s += `${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)} m `;
    for (let i = 1; i < p.length; i++) s += p[i].map((n) => n.toFixed(2)).join(" ") + " c ";
    s += fill && stroke ? "B" : fill ? "f" : "S";
    this.buf.push(s);
  }
  textLine(x, yTop, runs, size, color) {
    // runs: [{t, b}]
    let out = `BT ${this.rgb(color)} rg ${x.toFixed(2)} ${(this.pdfY(yTop) - size).toFixed(2)} Td`;
    let curFont = null;
    for (const r of runs) {
      const f = r.b ? "/F2" : "/F1";
      if (f !== curFont) { out += ` ${f} ${size} Tf`; curFont = f; }
      out += ` (${escape(r.t)}) Tj`;
    }
    out += " ET";
    this.buf.push(out);
  }

  // wrap runs into lines that fit maxWidth --------------------------------
  wrap(runs, size, maxWidth) {
    const words = [];
    for (const r of runs) {
      const parts = r.t.split(/(\s+)/);
      for (const p of parts) if (p.length) words.push({ t: p, b: !!r.b, space: /^\s+$/.test(p) });
    }
    const lines = [];
    let line = [], w = 0;
    for (const word of words) {
      const ww = runWidth(word.t, word.b, size);
      if (w + ww > maxWidth && line.length && !word.space) { lines.push(line); line = []; w = 0; }
      if (!(word.space && line.length === 0)) { line.push(word); w += ww; }
    }
    if (line.length) lines.push(line);
    // merge consecutive same-style words back for fewer Tj ops (optional)
    return lines.map((ln) => ln.map((x) => ({ t: x.t, b: x.b })));
  }

  paragraph(runs, { size = 10.5, leading = 15, color = INK, x = null, width = null, gap = 5 } = {}) {
    const px = x ?? this.x, pw = width ?? this.contentW;
    const lines = this.wrap(runs, size, pw);
    for (const ln of lines) {
      this.ensure(leading);
      this.textLine(px, this.y, ln, size, color);
      this.y += leading;
    }
    this.y += gap;
  }
  measure(runs, size, leading, width) { return this.wrap(runs, size, width).length * leading; }

  heading(text, level) {
    const map = { 1: [26, NAVY, 30, 6], 2: [15.5, NAVY, 22, 6], 3: [12, ACCENT, 17, 3] };
    const [size, color, leading, gap] = map[level];
    this.space(level === 2 ? 12 : 6);
    this.ensure(leading + 6);
    this.textLine(this.x, this.y, [{ t: text, b: true }], size, color);
    this.y += leading;
    if (level === 2) { this.line(this.x, this.y - 4, this.W - this.mR, this.y - 4, LINE, 1.2); this.y += 4; }
    this.y += gap;
  }

  bullets(items, { size = 10.5, leading = 14.5 } = {}) {
    for (const it of items) {
      const indent = 16;
      const lines = this.wrap(it, size, this.contentW - indent);
      this.ensure(leading);
      // dot
      this.circle(this.x + 3, this.y + size * 0.42, 1.7, { fill: ACCENT });
      this.textLine(this.x + indent, this.y, lines[0], size, INK);
      this.y += leading;
      for (let i = 1; i < lines.length; i++) {
        this.ensure(leading);
        this.textLine(this.x + indent, this.y, lines[i], size, INK);
        this.y += leading;
      }
      this.y += 3;
    }
    this.y += 3;
  }

  callout(titleRuns, bodyRuns, { bg = PANEL, bar = ACCENT } = {}) {
    const padX = 12, padY = 11, size = 10.5, leading = 14.5, innerW = this.contentW - padX * 2;
    const tLines = titleRuns ? this.wrap(titleRuns, 10.5, innerW) : [];
    const bLines = this.wrap(bodyRuns, size, innerW);
    const h = padY * 2 + tLines.length * 15 + bLines.length * leading;
    this.ensure(h + 4);
    const top = this.y;
    this.rect(this.x, top, this.contentW, h, bg);
    this.rect(this.x, top, 4, h, bar);
    let yy = top + padY;
    for (const ln of tLines) { this.textLine(this.x + padX, yy, ln, 10.5, INK); yy += 15; }
    for (const ln of bLines) { this.textLine(this.x + padX, yy, ln, size, INK); yy += leading; }
    this.y = top + h + 8;
  }

  // table: cols = [{w}], rows = [[cell,...]] where cell = {runs, color?, bold?}
  table(headers, rows, cols, { headerBg = NAVY } = {}) {
    const size = 10, leading = 13.5, padX = 7, padY = 7;
    const drawRow = (cells, { fill = null, headerText = false } = {}) => {
      const prep = cells.map((c, i) => {
        const runs = (headerText || c.bold) ? c.runs.map((r) => ({ ...r, b: true })) : c.runs;
        return { lines: this.wrap(runs, size, cols[i].w - padX * 2), color: headerText ? WHITE : (c.color || INK) };
      });
      const rowH = Math.max(...prep.map((p) => p.lines.length)) * leading + padY * 2;
      this.ensure(rowH);
      const top = this.y;
      if (fill) this.rect(this.x, top, this.contentW, rowH, fill);
      let cx = this.x;
      for (let i = 0; i < prep.length; i++) {
        let yy = top + padY;
        for (const ln of prep[i].lines) { this.textLine(cx + padX, yy, ln, size, prep[i].color); yy += leading; }
        cx += cols[i].w;
      }
      this.line(this.x, top + rowH, this.W - this.mR, top + rowH, LINE, 0.8);
      this.y = top + rowH;
    };
    this.space(2);
    if (headers) drawRow(headers, { fill: headerBg, headerText: true });
    for (const r of rows) drawRow(r);
    this.y += 8;
  }

  // assemble final PDF -----------------------------------------------------
  build() {
    if (this.buf.length) { this.pages.push(this.buf.join("\n")); this.buf = []; }
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };

    const fontReg = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    const pageObjNums = [];
    const contentObjNums = [];
    for (const content of this.pages) {
      const stream = zlib.deflateSync(Buffer.from(content, "latin1"));
      const cNum = add({ stream, dict: `<< /Length ${stream.length} /Filter /FlateDecode >>` });
      contentObjNums.push(cNum);
    }
    const pagesNum = objs.length + this.pages.length + 1; // placeholder index
    // create page objects referencing pages tree
    const pageNums = [];
    for (let i = 0; i < this.pages.length; i++) {
      const n = add(
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${this.W} ${this.H}] ` +
        `/Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> ` +
        `/Contents ${contentObjNums[i]} 0 R >>`
      );
      pageNums.push(n);
    }
    const kids = pageNums.map((n) => `${n} 0 R`).join(" ");
    const pagesObj = add(`<< /Type /Pages /Count ${pageNums.length} /Kids [${kids}] >>`);
    const catalog = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

    // serialize
    let out = "%PDF-1.4\n%âãÏÓ\n";
    const offsets = [];
    const bytes = [Buffer.from(out, "latin1")];
    let pos = bytes[0].length;
    objs.forEach((o, idx) => {
      offsets[idx + 1] = pos;
      let chunk;
      if (typeof o === "object" && o.stream) {
        const head = Buffer.from(`${idx + 1} 0 obj\n${o.dict}\nstream\n`, "latin1");
        const tail = Buffer.from("\nendstream\nendobj\n", "latin1");
        chunk = Buffer.concat([head, o.stream, tail]);
      } else {
        chunk = Buffer.from(`${idx + 1} 0 obj\n${o}\nendobj\n`, "latin1");
      }
      bytes.push(chunk); pos += chunk.length;
    });
    const xrefPos = pos;
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objs.length; i++) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    bytes.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(bytes);
  }
}

// shared colors (0..1 RGB)
const INK = [0.086, 0.125, 0.227];
const NAVY = [0.102, 0.165, 0.310];
const ACCENT = [0.184, 0.420, 0.863];
const DIM = [0.353, 0.420, 0.549];
const LINE = [0.843, 0.871, 0.925];
const PANEL = [0.957, 0.969, 0.988];
const WHITE = [1, 1, 1];
const GOOD = [0.110, 0.620, 0.486], GOOD_BG = [0.906, 0.965, 0.945];
const WARN = [0.725, 0.475, 0.039], WARN_BG = [0.988, 0.953, 0.878];
const BAD = [0.839, 0.271, 0.271], BAD_BG = [0.988, 0.914, 0.914];

module.exports = { PDF, colors: { INK, NAVY, ACCENT, DIM, LINE, PANEL, WHITE, GOOD, GOOD_BG, WARN, WARN_BG, BAD, BAD_BG } };
