/* Builds a downloadable PDF report from the user's log — entirely in the
   browser, no libraries. Streams are stored uncompressed (no zlib needed),
   using the standard Helvetica fonts so nothing has to be embedded. */
window.PS = window.PS || {};

PS.report = (() => {
  // Helvetica / Helvetica-Bold advance widths (per 1000) for ASCII 32..126.
  const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  function cw(ch, bold) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) return (bold ? HELVB : HELV)[c - 32];
    return 556; // reasonable default for degree sign, accented chars, etc.
  }
  function runWidth(t, bold, size) { let w = 0; for (const ch of t) w += cw(ch, bold); return (w / 1000) * size; }
  function esc(s) { return s.replace(/[\\()]/g, (m) => "\\" + m); }
  function ascii(s) {
    return String(s)
      .replace(/[—–]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...")
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  }

  const INK = [0.09, 0.13, 0.23], NAVY = [0.10, 0.16, 0.31], ACCENT = [0.18, 0.42, 0.86],
    DIM = [0.35, 0.42, 0.55], LINE = [0.84, 0.87, 0.93], PANEL = [0.95, 0.97, 0.99],
    WHITE = [1, 1, 1], GOOD = [0.11, 0.62, 0.49], WARN = [0.72, 0.48, 0.04], BAD = [0.84, 0.27, 0.27];

  class PDF {
    constructor() {
      this.W = 612; this.H = 792; this.mL = 54; this.mR = 54; this.mT = 54; this.mB = 54;
      this.x = this.mL; this.y = this.mT; this.pages = []; this.buf = [];
    }
    newPage() { if (this.buf.length) this.pages.push(this.buf.join("\n")); this.buf = []; this.y = this.mT; }
    get contentW() { return this.W - this.mL - this.mR; }
    pdfY(y) { return this.H - y; }
    ensure(h) { if (this.y + h > this.H - this.mB) this.newPage(); }
    space(h) { this.y += h; if (this.y > this.H - this.mB) this.newPage(); }
    rgb(c) { return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`; }
    rect(x, yTop, w, h, color) {
      this.buf.push(`${this.rgb(color)} rg ${x.toFixed(2)} ${(this.pdfY(yTop) - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    }
    hline(y, color) { this.buf.push(`${this.rgb(color)} RG 0.8 w ${this.mL} ${this.pdfY(y).toFixed(2)} m ${this.W - this.mR} ${this.pdfY(y).toFixed(2)} l S`); }
    textLine(x, yTop, runs, size, color) {
      let out = `BT ${this.rgb(color)} rg ${x.toFixed(2)} ${(this.pdfY(yTop) - size).toFixed(2)} Td`;
      let cur = null;
      for (const r of runs) {
        const f = r.b ? "/F2" : "/F1";
        if (f !== cur) { out += ` ${f} ${size} Tf`; cur = f; }
        out += ` (${esc(ascii(r.t))}) Tj`;
      }
      this.buf.push(out + " ET");
    }
    wrap(runs, size, maxW) {
      const words = [];
      for (const r of runs) for (const p of r.t.split(/(\s+)/)) if (p.length) words.push({ t: p, b: !!r.b, sp: /^\s+$/.test(p) });
      const lines = []; let line = [], w = 0;
      for (const word of words) {
        const ww = runWidth(word.t, word.b, size);
        if (w + ww > maxW && line.length && !word.sp) { lines.push(line); line = []; w = 0; }
        if (!(word.sp && line.length === 0)) { line.push(word); w += ww; }
      }
      if (line.length) lines.push(line);
      return lines.map((ln) => ln.map((x) => ({ t: x.t, b: x.b })));
    }
    paragraph(runs, { size = 10.5, leading = 14.5, color = INK, gap = 5, x = null, width = null } = {}) {
      const px = x ?? this.x, pw = width ?? this.contentW;
      for (const ln of this.wrap(runs, size, pw)) { this.ensure(leading); this.textLine(px, this.y, ln, size, color); this.y += leading; }
      this.y += gap;
    }
    heading(text, level) {
      const map = { 1: [22, NAVY, 27, 6], 2: [14.5, NAVY, 21, 5], 3: [11.5, ACCENT, 16, 3] };
      const [size, color, leading, gap] = map[level];
      this.space(level === 2 ? 10 : 5); this.ensure(leading + 6);
      this.textLine(this.x, this.y, [{ t: text, b: true }], size, color); this.y += leading;
      if (level === 2) { this.hline(this.y - 4, LINE); this.y += 4; }
      this.y += gap;
    }
    // rows: [[cell,...]] cell={t, color?, bold?}; cols: [{w}]
    table(headers, rows, cols) {
      const size = 9.5, leading = 13, padX = 6, padY = 6;
      const draw = (cells, { fill = null, head = false } = {}) => {
        const prep = cells.map((c, i) => ({
          lines: this.wrap([{ t: c.t, b: head || c.bold }], size, cols[i].w - padX * 2),
          color: head ? WHITE : (c.color || INK)
        }));
        const rowH = Math.max(...prep.map((p) => p.lines.length)) * leading + padY * 2;
        this.ensure(rowH);
        const top = this.y;
        if (fill) this.rect(this.x, top, this.contentW, rowH, fill);
        let cx = this.x;
        prep.forEach((p, i) => { let yy = top + padY; for (const ln of p.lines) { this.textLine(cx + padX, yy, ln, size, p.color); yy += leading; } cx += cols[i].w; });
        this.hline(top + rowH, LINE); this.y = top + rowH;
      };
      this.space(2);
      if (headers) draw(headers, { fill: NAVY, head: true });
      rows.forEach((r) => draw(r));
      this.y += 8;
    }
    build() {
      if (this.buf.length) { this.pages.push(this.buf.join("\n")); this.buf = []; }
      const objs = [];
      const add = (s) => { objs.push(s); return objs.length; };
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");       // 1
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");  // 2
      const contentNums = this.pages.map((c) => add({ raw: c }));
      const pagesNum = objs.length + this.pages.length + 1;
      const pageNums = this.pages.map((_, i) => add(
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${this.W} ${this.H}] ` +
        `/Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contentNums[i]} 0 R >>`));
      const pagesObj = add(`<< /Type /Pages /Count ${pageNums.length} /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] >>`);
      const catalog = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

      let head = "%PDF-1.4\n%âãÏÓ\n";
      const parts = [head]; let pos = head.length; const offsets = [];
      objs.forEach((o, idx) => {
        offsets[idx + 1] = pos;
        const body = (o && o.raw != null)
          ? `${idx + 1} 0 obj\n<< /Length ${o.raw.length} >>\nstream\n${o.raw}\nendstream\nendobj\n`
          : `${idx + 1} 0 obj\n${o}\nendobj\n`;
        parts.push(body); pos += body.length;
      });
      const xrefPos = pos;
      let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i <= objs.length; i++) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
      xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
      parts.push(xref);
      const str = parts.join("");
      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
      return bytes;
    }
  }

  const R = (t) => [{ t, b: false }];
  const RB = (t) => [{ t, b: true }];

  /* ---- report content ---- */
  function sevLabel(v) {
    if (v <= 0) return "None"; if (v <= 3) return "Mild"; if (v <= 6) return "Moderate";
    if (v <= 8) return "Strong"; return "Severe";
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function generate() {
    const settings = PS.store.getSettings();
    const pUnit = settings.pressureUnit, tUnit = settings.tempUnit;
    const logs = PS.store.getLogs().slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
    if (!logs.length) return false;

    const pdf = new PDF();
    pdf.newPage();

    // Header
    pdf.heading("PressureSense — Symptom & Weather Report", 1);
    const dates = logs.map((l) => new Date(l.ts).getTime());
    const range = `${fmtDate(Math.min(...dates))}  to  ${fmtDate(Math.max(...dates))}`;
    pdf.paragraph(R(`Location: ${settings.location ? settings.location.name : "—"}`), { color: DIM, gap: 1 });
    pdf.paragraph(R(`Entries: ${logs.length}    |    Range: ${range}`), { color: DIM, gap: 1 });
    pdf.paragraph(R(`Generated: ${fmtDate(Date.now())}`), { color: DIM, gap: 8 });
    pdf.hline(pdf.y, LINE); pdf.y += 6;

    // Summary
    const avg = logs.reduce((s, l) => s + l.severity, 0) / logs.length;
    const withP = logs.filter((l) => l.pressure != null);
    const high = withP.filter((l) => l.severity >= 5), low = withP.filter((l) => l.severity <= 2);
    const meanP = (a) => a.length ? a.reduce((s, l) => s + l.pressure, 0) / a.length : null;

    pdf.heading("Summary", 2);
    pdf.paragraph([...RB("Average severity: "), ...R(`${avg.toFixed(1)} / 10`)]);
    const sevDays = logs.filter((l) => l.severity >= 5).length;
    pdf.paragraph([...RB("Days logged at severity 5+: "), ...R(`${sevDays}`)]);

    if (high.length && low.length) {
      const diff = meanP(high) - meanP(low);
      pdf.paragraph([
        ...R("On worse days (severity 5+), pressure averaged "),
        ...RB(`${PS.fmtPressure(meanP(high), pUnit)} ${pUnit}`),
        ...R(` — about `),
        ...RB(`${PS.fmtPressure(Math.abs(diff), pUnit)} ${pUnit} ${diff < 0 ? "lower" : "higher"}`),
        ...R(` than on good days (severity 0-2)${diff < 0 ? ", consistent with low/falling pressure aggravating symptoms." : "."}`)
      ]);
    } else {
      pdf.paragraph(R("Log more good and bad days to compare pressure between them."), { color: DIM });
    }

    // Average pressure change (the basis for alerts)
    const fmtMag = (h) => pUnit === "inHg" ? `${(h * 0.0295299831).toFixed(2)} inHg` : `${h.toFixed(1)} hPa`;
    const wt = logs.filter((l) => l.trend6h != null);
    if (wt.length) {
      const mag = (a) => a.reduce((s, l) => s + Math.abs(l.trend6h), 0) / a.length;
      pdf.paragraph([...RB("Average 6-hour pressure change at logging: "), ...R(fmtMag(mag(wt)))]);
      const bad = wt.filter((l) => l.severity >= 4);
      if (bad.length) pdf.paragraph([...RB("On tougher days (severity 4+): "), ...R(`${fmtMag(mag(bad))} average change`)]);
    }

    // Symptom frequency
    const counts = {};
    logs.forEach((l) => (l.symptoms || []).forEach((s) => (counts[s] = (counts[s] || 0) + 1)));
    const symRows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([s, n]) => [
      { t: s }, { t: String(n) }, { t: `${Math.round((n / logs.length) * 100)}%` }
    ]);
    if (symRows.length) {
      pdf.heading("Symptom frequency", 2);
      const cw3 = [0.5, 0.25, 0.25].map((f) => ({ w: f * pdf.contentW }));
      pdf.table([{ t: "Symptom" }, { t: "Times logged" }, { t: "% of entries" }], symRows, cw3);
    }

    // Severity distribution
    const buckets = [["None (0)", 0, 0], ["Mild (1-3)", 1, 3], ["Moderate (4-6)", 4, 6], ["Strong (7-8)", 7, 8], ["Severe (9-10)", 9, 10]];
    const distRows = buckets.map(([label, lo, hi]) => {
      const n = logs.filter((l) => l.severity >= lo && l.severity <= hi).length;
      return [{ t: label }, { t: String(n) }, { t: `${Math.round((n / logs.length) * 100)}%` }];
    });
    pdf.heading("Severity distribution", 2);
    pdf.table([{ t: "Level" }, { t: "Entries" }, { t: "Share" }], distRows, [0.5, 0.25, 0.25].map((f) => ({ w: f * pdf.contentW })));

    // Weather averages
    const avgField = (arr, f) => { const v = arr.filter((l) => l[f] != null); return v.length ? v.reduce((s, l) => s + l[f], 0) / v.length : null; };
    pdf.heading("Average conditions when logged", 2);
    const condRows = [];
    const ap = avgField(logs, "pressure"); if (ap != null) condRows.push([{ t: "Pressure" }, { t: `${PS.fmtPressure(ap, pUnit)} ${pUnit}` }]);
    const at = avgField(logs, "temp"); if (at != null) condRows.push([{ t: "Temperature" }, { t: PS.fmtTemp(at, tUnit) }]);
    const ah = avgField(logs, "humidity"); if (ah != null) condRows.push([{ t: "Humidity" }, { t: `${Math.round(ah)}%` }]);
    const aq = avgField(logs, "aqi"); if (aq != null) condRows.push([{ t: "Air quality (US AQI)" }, { t: `${Math.round(aq)}` }]);
    if (condRows.length) pdf.table(null, condRows, [0.5, 0.5].map((f) => ({ w: f * pdf.contentW })));
    else pdf.paragraph(R("No weather conditions were attached to these entries yet."), { color: DIM });

    // Possible food triggers — avg severity on days each food was logged vs overall
    const overallAvg = avg;
    const foodSev = {};
    logs.forEach((l) => (l.foods || []).forEach((f) => (foodSev[f] = foodSev[f] || []).push(l.severity)));
    const foodRows = Object.entries(foodSev)
      .filter(([, a]) => a.length >= 2)
      .map(([f, a]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return { f, n: a.length, m, diff: m - overallAvg }; })
      .sort((a, b) => b.diff - a.diff);
    if (foodRows.length) {
      pdf.heading("Possible food triggers", 2);
      pdf.paragraph(R(`Average symptom severity on days each food was logged, versus your overall average of ${overallAvg.toFixed(1)}. A higher value may be worth discussing with a clinician — this is a correlation, not a diagnosis.`), { color: DIM, gap: 8 });
      const rows = foodRows.map((r) => [
        { t: r.f }, { t: String(r.n) }, { t: r.m.toFixed(1) },
        { t: (r.diff >= 0 ? "+" : "") + r.diff.toFixed(1), color: r.diff >= 1 ? BAD : (r.diff <= -1 ? GOOD : INK), bold: Math.abs(r.diff) >= 1 }
      ]);
      pdf.table([{ t: "Food" }, { t: "Times" }, { t: "Avg severity" }, { t: "vs overall" }],
        rows, [0.4, 0.18, 0.22, 0.2].map((f) => ({ w: f * pdf.contentW })));
    }

    // Detailed breakdown (at the end)
    pdf.newPage();
    pdf.heading("Detailed log", 2);
    pdf.paragraph(R("Every entry with the weather and air quality recorded at that time."), { color: DIM, gap: 8 });

    logs.forEach((l) => {
      pdf.ensure(54);
      pdf.paragraph([...RB(fmtDate(l.ts)), ...R(`    Severity ${l.severity} (${sevLabel(l.severity)})`)], { size: 11, leading: 15, gap: 2 });
      if (l.location && l.location.name) pdf.paragraph([...RB("Location: "), ...R(l.location.name)], { gap: 2 });
      if ((l.symptoms || []).length) pdf.paragraph([...RB("Symptoms: "), ...R(l.symptoms.join(", "))], { gap: 2 });
      if ((l.foods || []).length || l.dietNote) pdf.paragraph([...RB("Diet: "), ...R([...(l.foods || []), l.dietNote].filter(Boolean).join(", "))], { gap: 2 });
      const cond = [];
      if (l.pressure != null) cond.push(`Pressure ${PS.fmtPressure(l.pressure, pUnit)} ${pUnit}${l.trend6h != null ? ` (${PS.fmtPressureDelta(l.trend6h, pUnit)} /6h)` : ""}`);
      if (l.temp != null) cond.push(`Temp ${PS.fmtTemp(l.temp, tUnit)}`);
      if (l.humidity != null) cond.push(`Humidity ${Math.round(l.humidity)}%`);
      if (l.aqi != null) cond.push(`AQI ${Math.round(l.aqi)}`);
      if (l.code != null && PS.config.weatherCodes[l.code]) cond.push(PS.config.weatherCodes[l.code]);
      pdf.paragraph([...RB("Conditions: "), ...R(cond.length ? cond.join("  ·  ") : "not recorded")], { color: DIM, gap: 2 });
      if (l.note) pdf.paragraph([...RB("Note: "), ...R(l.note)], { gap: 2 });
      pdf.hline(pdf.y + 2, LINE); pdf.y += 10;
    });

    // Footer disclaimer
    pdf.space(8);
    pdf.paragraph(R("PressureSense is a personal wellness and self-tracking tool, not a medical device and not a substitute for professional medical advice. Share this report with your clinician to support a conversation about your symptoms."), { size: 8.5, leading: 12, color: DIM });

    // download
    const bytes = pdf.build();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pressuresense-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  return { generate };
})();
