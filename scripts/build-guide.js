/* Builds the beginner's guide PDF (primary) and a companion HTML page from one
   content model, so the two never drift. No external dependencies.
   Run: node scripts/build-guide.js  ->  docs/PressureSense-Guide.pdf + .html */
const fs = require("fs");
const path = require("path");
const { PDF, colors: K } = require("./pdf.js");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "docs");
fs.mkdirSync(outDir, { recursive: true });

/* ---- tiny markup: **bold** -> runs; ASCII-sanitized for WinAnsi safety ---- */
function sanitize(s) {
  return s
    .replace(/[—–·]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/°/g, " deg")
    .replace(/≥/g, ">=").replace(/≤/g, "<=")
    .replace(/…/g, "...");
}
function runs(str) {
  const s = sanitize(str);
  const out = [];
  let bold = false;
  for (const part of s.split("**")) {
    if (part) out.push({ t: part, b: bold });
    bold = !bold;
  }
  return out.length ? out : [{ t: "", b: false }];
}
const cell = (str, color, bold) => ({ runs: runs(str), color, bold });

/* ---------------------------- content model ------------------------------ */
const C = K;
const doc = [
  { t: "cover" },

  { t: "callout", kind: "accent", title: "In one sentence",
    body: "PressureSense watches the **barometric (air) pressure** where you are and helps you see how it lines up with how you feel - so dizziness, vertigo, and migraine days become a little more predictable." },

  { t: "callout", kind: "warn", title: "Please read this first",
    body: "This app is a **personal wellness tracker, not a medical device**. It does not diagnose anything or replace your doctor. Use it to spot your own patterns and to share an export with a clinician - not to make medical decisions on its own." },

  { t: "h2", s: "Why air pressure?" },
  { t: "p", r: "The air around us has weight, and that weight - **barometric pressure** - constantly rises and falls as weather systems move through. Many people with **vestibular disorders, vertigo, Meniere's, or migraine** find that their symptoms flare when the pressure changes, especially when it **drops quickly** before a storm." },
  { t: "p", r: "You can't feel the pressure directly, but your inner ear and sinuses can react to it. PressureSense turns that invisible change into a number and a picture you can actually watch - and warns you when a big swing is on the way, so you can rest or take medication **ahead** of it." },
  { t: "callout", kind: "good", title: "The single most important idea",
    body: "It is usually **not** the pressure being high or low that bothers people - it's **how fast it changes**. A steady day, high or low, is usually calm. A **rapid drop** is the classic trigger. That's why this app shows you the **change**, not just the number." },

  { t: "h2", s: "Getting started (first 30 seconds)" },
  { t: "bullets", items: [
    "**1. Set your location.** The first time you open the app, tap \"Use my current location\" (easiest) or type a city name and pick it from the list. The weather is fetched for that spot.",
    "**2. Choose your units** (optional). You can switch pressure between **hPa** and **inHg**, and temperature between C and F. Pick whatever looks familiar - it changes nothing except the labels.",
    "**3. That's it.** The **Now** screen fills in. Come back anytime; it remembers your location and your symptom log on your device."
  ] },

  { t: "h2", s: "The four tabs at the bottom" },
  { t: "table", headers: null, cols: [0.26, 0.74], rows: [
    [cell("Now", C.ACCENT, true), cell("Today's pressure, the trend, and how much it has changed recently. Your home base.")],
    [cell("Forecast", C.ACCENT, true), cell("The next 48 hours of pressure, so you can see swings coming before they arrive.")],
    [cell("Log", C.ACCENT, true), cell("A quick place to record how you feel. Each entry is stamped with the pressure at that moment.")],
    [cell("Trends", C.ACCENT, true), cell("Your past symptoms drawn against the pressure line, plus a plain-language summary of your patterns.")]
  ] },

  { t: "h2", s: "Reading the \"Now\" screen", page: true },
  { t: "p", r: "This is where most of the numbers live. Here's each one, top to bottom.", dim: true },

  { t: "h3", s: "The big number - current pressure" },
  { t: "p", r: "The large figure is the air pressure right now, in your chosen unit." },
  { t: "bullets", items: [
    "**hPa (hectopascals)** is the worldwide standard. **~1013 hPa** is the global average at sea level. Roughly: **above 1023** = high/settled, **around 1013** = average, **below 1000** = low/unsettled.",
    "**inHg (inches of mercury)** is common in the US. **~29.92 inHg** is the average. Higher is calmer, lower is stormier."
  ] },

  { t: "h3", s: "The trend pill - which way it's heading" },
  { t: "p", r: "Just under the big number is a colored pill with an arrow. It compares now to **6 hours ago**:" },
  { t: "table", headers: null, cols: [0.24, 0.76], rows: [
    [cell("Rising", C.WARN, true), cell("Pressure climbing. Weather often improving. Rapid rises can still be a trigger for some.")],
    [cell("Steady", C.GOOD, true), cell("Little change - usually the calmest, most comfortable window.")],
    [cell("Falling", C.BAD, true), cell("Pressure dropping. The most common symptom trigger - worth paying attention to.")]
  ] },
  { t: "p", r: "The pill also shows the exact change, e.g. \"Falling - -3.4 hPa / 6h\".", dim: true },

  { t: "h3", s: "Change - 3 hr / 6 hr / 24 hr" },
  { t: "p", r: "These three boxes are the heart of the app. Each shows **how much the pressure has moved** over that time window. A **red, negative** number means it fell; an **amber, positive** number means it rose." },
  { t: "callout", kind: "panel", title: "Rule of thumb",
    body: "A change of about **5-6 hPa or more over a few hours** is the kind of swing that sensitive people often notice. Small wobbles of a point or two are normal and usually nothing." },

  { t: "h3", s: "The alert banner (top of the screen)" },
  { t: "p", r: "A colored bar gives a plain-language heads-up about the **next 12 hours**:" },
  { t: "table", headers: null, cols: [0.28, 0.72], rows: [
    [cell("Green / calm", C.GOOD, true), cell("Pressure looks stable. A good window if you're sensitive to change.")],
    [cell("Amber / caution", C.WARN, true), cell("A notable rise is forecast. Rapid changes can trigger symptoms - take it easy.")],
    [cell("Red / heads-up", C.BAD, true), cell("A notable drop is forecast. Consider preparing ahead - rest, hydration, or medication as your clinician advises.")]
  ] },

  { t: "h3", s: "Temperature, Humidity, Conditions" },
  { t: "p", r: "Supporting weather context: the current temperature, the relative humidity as a percentage, and a short description of the sky (Clear, Overcast, Light rain, and so on). These don't drive the alerts - they just help you picture the day." },

  { t: "h3", s: "The square pressure graph" },
  { t: "p", r: "The chart shows the **last 24 hours** of pressure as a line. A dotted vertical line marks **now**. A line sloping **downhill** toward \"now\" means falling pressure; **uphill** means rising. The numbers up the left side are pressure values; the labels along the bottom are times." },

  { t: "h2", s: "The \"Forecast\" tab", page: true },
  { t: "p", r: "Same square graph, but looking **48 hours ahead**. Below it is a list that breaks the time into roughly 6-hour blocks. Each row tells you the trend and the size of the change:" },
  { t: "table", headers: null, cols: [0.34, 0.66], rows: [
    [cell("Steady - calm window", C.GOOD, true), cell("Little movement expected. The easy stretches to plan demanding activities.")],
    [cell("Gentle rise / fall", C.WARN, true), cell("A modest change is coming. Usually mild, but worth noticing if you're sensitive.")],
    [cell("Notable drop / Sharp rise", C.BAD, true), cell("A bigger swing. The number on the right (e.g. -4.2) is how many units it moves in that block.")]
  ] },
  { t: "p", r: "Use this to **plan ahead**: if a notable drop is coming tomorrow afternoon, you can take it easy beforehand instead of being caught off guard.", dim: true },

  { t: "h2", s: "The \"Log\" tab" },
  { t: "p", r: "This is how the app learns **your** patterns. Whenever you feel something (or feel fine), make a quick entry:" },
  { t: "bullets", items: [
    "**Severity slider (0-10):** 0 is \"none,\" 10 is \"severe.\" Just estimate - consistency matters more than precision.",
    "**Symptom chips:** tap any that apply (Dizziness, Vertigo, Headache, Nausea, Ear pressure, and so on). Tap again to unselect.",
    "**Notes:** optional free text - \"woke up dizzy,\" \"took medication,\" anything useful to future-you.",
    "**Save entry:** the app automatically attaches the **current pressure**, so you never have to write it down."
  ] },
  { t: "callout", kind: "good", title: "Tip",
    body: "Log the good days too, not just the bad ones. The app finds patterns by **comparing** your better and worse days - it needs both to learn anything." },
  { t: "p", r: "**Export:** the \"Export\" button saves your whole log as a **CSV spreadsheet** - handy to bring to a doctor's appointment. Your entries live **only on your own device**; nothing is uploaded anywhere." },

  { t: "h2", s: "The \"Trends\" tab" },
  { t: "p", r: "This is the payoff. The square chart draws the recent **pressure line**, and overlays your logged entries as **colored dots**:" },
  { t: "bullets", items: [
    "Each dot sits at the time you logged it. **Bigger, redder dots** = higher severity; small green dots = mild.",
    "Over a few weeks you may *see* the dots cluster on the downhill slopes - that's your personal pattern emerging."
  ] },
  { t: "p", r: "Below the chart, a short written summary appears once you have a handful of entries, for example: \"On your worse days, pressure averaged 8 hPa lower than on your good days.\" It also notes your most-logged symptom. This is a description of your data, not a diagnosis." },

  { t: "h2", s: "Quick reference card", page: true },
  { t: "p", r: "The whole app at a glance.", dim: true },
  { t: "table", headers: [cell("You see"), cell("It means"), cell("Roughly")], cols: [0.30, 0.40, 0.30], rows: [
    [cell("Steady", C.GOOD, true), cell("Pressure barely moving"), cell("Calmest window")],
    [cell("Rising", C.WARN, true), cell("Pressure climbing vs. 6h ago"), cell("Often improving")],
    [cell("Falling", C.BAD, true), cell("Pressure dropping vs. 6h ago"), cell("Most common trigger")],
    [cell("Red change number", C.BAD, true), cell("Pressure fell over that window"), cell("Bigger = bigger deal")],
    [cell("Amber change number", C.WARN, true), cell("Pressure rose over that window"), cell("Bigger = bigger deal")],
    [cell("Green banner", C.GOOD, true), cell("Stable next 12h"), cell("Good window")],
    [cell("Red banner", C.BAD, true), cell("Notable drop forecast"), cell("Prepare ahead")],
    [cell("~1013 hPa / 29.92 inHg"), cell("Average sea-level pressure"), cell("Your baseline")],
    [cell("Change >= ~5-6 hPa"), cell("A swing sensitive people notice"), cell("Worth attention")]
  ] },

  { t: "h2", s: "Getting the most out of it" },
  { t: "bullets", items: [
    "**Check it in the morning** and glance at the alert banner to see what kind of day to expect.",
    "**Log little and often.** A 10-second entry whenever you feel a change builds the picture fastest.",
    "**Give it a few weeks.** One or two entries can't show a pattern; a month of them often can.",
    "**Add it to your home screen.** In your phone browser, choose \"Add to Home Screen\" and it opens like a normal app, full-screen, even offline.",
    "**Bring the export to appointments.** A clinician can do more with a month of logged data than with \"I think the weather affects me.\""
  ] },

  { t: "footer", s: "PressureSense - weather & wellness tracker. Weather data from Open-Meteo. Your location and symptom log stay on your device. This guide and the app are for general wellness and self-tracking only and are not medical advice. If symptoms are severe, sudden, or new, contact a healthcare professional." }
];

/* ------------------------------- PDF render ------------------------------ */
function kindColors(kind) {
  return {
    accent: { bg: C.PANEL, bar: C.ACCENT },
    good: { bg: C.GOOD_BG, bar: C.GOOD },
    warn: { bg: C.WARN_BG, bar: C.WARN },
    panel: { bg: C.PANEL, bar: C.ACCENT }
  }[kind] || { bg: C.PANEL, bar: C.ACCENT };
}

// Build PDF
const pdf = new PDF();
// --- cover (vector barometer + centered title) ---
(() => {
  const cx = pdf.W / 2, cy = 150, r = 54;
  pdf.circle(cx, cy, r + 16, { fill: C.NAVY });
  pdf.circle(cx, cy, r, { stroke: C.ACCENT, lw: 6 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pdf.line(cx + Math.cos(a) * (r - 11), cy + Math.sin(a) * (r - 11),
             cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4), C.ACCENT, 2);
  }
  pdf.line(cx, cy, cx + Math.cos(-Math.PI / 4) * (r - 8), cy + Math.sin(-Math.PI / 4) * (r - 8), C.GOOD, 4);
  pdf.circle(cx, cy, 7, { fill: [0.93, 0.95, 0.98] });

  const center = (text, size, color, bold) => {
    const tw = textWidth(text, bold, size);
    pdf.textLine(pdf.W / 2 - tw / 2, pdf.y, [{ t: text, b: bold }], size, color);
  };
  pdf.y = cy + r + 40;
  center("PressureSense", 30, C.NAVY, true); pdf.y += 36;
  center("Weather & Wellness Tracker", 13, C.DIM, false); pdf.y += 22;
  center("A Complete Beginner's Guide", 13, C.NAVY, true); pdf.y += 40;
  center("How to read the app and what every number means -", 10.5, C.DIM, false); pdf.y += 15;
  center("written for someone who has never opened it before.", 10.5, C.DIM, false); pdf.y += 30;
})();

// width helper mirroring pdf.js metrics (for centering only)
function textWidth(text, bold, size) {
  const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    const tbl = bold ? HELVB : HELV;
    w += (c >= 32 && c <= 126) ? tbl[c - 32] : tbl[33];
  }
  return (w / 1000) * size;
}

for (const b of doc) {
  if (b.t === "cover") continue; // handled
  if (b.page) pdf.newPage();
  switch (b.t) {
    case "h2": pdf.heading(sanitize(b.s), 2); break;
    case "h3": pdf.heading(sanitize(b.s), 3); break;
    case "p": pdf.paragraph(runs(b.r), { color: b.dim ? C.DIM : C.INK }); break;
    case "bullets": pdf.bullets(b.items.map(runs)); break;
    case "callout": {
      const kc = kindColors(b.kind);
      pdf.callout(b.title ? runs(b.title) : null, runs(b.body), { bg: kc.bg, bar: kc.bar });
      break;
    }
    case "table": {
      const cw = b.cols.map((f) => f * pdf.contentW).map((w) => ({ w }));
      pdf.table(b.headers, b.rows, cw);
      break;
    }
    case "footer": {
      pdf.space(10);
      pdf.line(pdf.x, pdf.y, pdf.W - pdf.mR, pdf.y, C.LINE, 1); pdf.y += 8;
      pdf.paragraph(runs(b.s), { size: 8.5, leading: 12, color: C.DIM });
      break;
    }
  }
}

fs.writeFileSync(path.join(outDir, "PressureSense-Guide.pdf"), pdf.build());
console.log("wrote docs/PressureSense-Guide.pdf");

/* ------------------------------ HTML render ------------------------------ */
const icon = fs.readFileSync(path.join(root, "icons", "icon-192.png")).toString("base64");
function hesc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function hruns(str) { return hesc(sanitize(str)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); }
function rgbCss(c) { return `rgb(${c.map((n) => Math.round(n * 255)).join(",")})`; }

let html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>PressureSense - Beginner's Guide</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${rgbCss(C.INK)};max-width:760px;margin:0 auto;padding:24px 18px 60px;line-height:1.55;}
h2{color:${rgbCss(C.NAVY)};border-bottom:2px solid ${rgbCss(C.LINE)};padding-bottom:5px;margin-top:30px;}
h3{color:${rgbCss(C.ACCENT)};margin-top:22px;}
.cover{text-align:center;padding:40px 0 10px;}.cover img{width:88px;height:88px;}
.cover h1{color:${rgbCss(C.NAVY)};margin:8px 0 0;font-size:32px;}
.dim{color:${rgbCss(C.DIM)};}
.box{border-radius:8px;padding:14px 16px;margin:14px 0;border-left:5px solid;}
.box b{color:inherit;}
table{width:100%;border-collapse:collapse;margin:14px 0;}
td,th{border-bottom:1px solid ${rgbCss(C.LINE)};padding:9px;text-align:left;vertical-align:top;}
th{background:${rgbCss(C.NAVY)};color:#fff;}
.footer{margin-top:30px;border-top:1px solid ${rgbCss(C.LINE)};padding-top:10px;color:${rgbCss(C.DIM)};font-size:13px;}
</style></head><body>`;

for (const b of doc) {
  switch (b.t) {
    case "cover":
      html += `<div class="cover"><img src="data:image/png;base64,${icon}" alt="icon"/>
        <h1>PressureSense</h1><p class="dim">Weather &amp; Wellness Tracker</p>
        <p><b>A Complete Beginner's Guide</b></p>
        <p class="dim">How to read the app and what every number means - written for someone who has never opened it before.</p></div>`;
      break;
    case "h2": html += `<h2>${hesc(sanitize(b.s))}</h2>`; break;
    case "h3": html += `<h3>${hesc(sanitize(b.s))}</h3>`; break;
    case "p": html += `<p class="${b.dim ? "dim" : ""}">${hruns(b.r)}</p>`; break;
    case "bullets": html += "<ul>" + b.items.map((i) => `<li>${hruns(i)}</li>`).join("") + "</ul>"; break;
    case "callout": {
      const kc = kindColors(b.kind);
      html += `<div class="box" style="background:${rgbCss(kc.bg)};border-left-color:${rgbCss(kc.bar)};">
        ${b.title ? `<p style="margin:0 0 4px;"><b>${hruns(b.title)}</b></p>` : ""}<p style="margin:0;">${hruns(b.body)}</p></div>`;
      break;
    }
    case "table": {
      html += "<table>";
      if (b.headers) html += "<tr>" + b.headers.map((h) => `<th>${hruns(textOf(h))}</th>`).join("") + "</tr>";
      for (const row of b.rows)
        html += "<tr>" + row.map((c) => `<td style="${c.color ? `color:${rgbCss(c.color)};` : ""}${c.bold ? "font-weight:bold;" : ""}">${hruns(textOf(c))}</td>`).join("") + "</tr>";
      html += "</table>";
      break;
    }
    case "footer": html += `<div class="footer">${hruns(b.s)}</div>`; break;
  }
}
html += "</body></html>";
function textOf(c) { return c.runs.map((r) => (r.b ? `**${r.t}**` : r.t)).join(""); }

fs.writeFileSync(path.join(outDir, "PressureSense-Guide.html"), html);
console.log("wrote docs/PressureSense-Guide.html");
