/* Main controller: view routing, data loading, and rendering. */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let settings = PS.store.getSettings();
  let weatherData = null; // { current, series, tz }
  let airData = null;     // { current:{aqi,pm25,pm10,ozone}, hours }

  /* ---------- helpers ---------- */
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 2600);
  }

  // Promise-based confirm dialog. Resolves true only if the user confirms.
  function askConfirm({ title, body = "", confirmText = "Confirm" }) {
    return new Promise((resolve) => {
      const dlg = $("#confirmDialog");
      $("#confirmTitle").textContent = title;
      $("#confirmBody").textContent = body;
      $("#confirmOk").textContent = confirmText;
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        $("#confirmOk").removeEventListener("click", onOk);
        $("#confirmCancel").removeEventListener("click", onCancel);
        dlg.removeEventListener("close", onClose);
        if (dlg.open) dlg.close();
        resolve(val);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onClose = () => finish(false); // backdrop / Esc
      $("#confirmOk").addEventListener("click", onOk);
      $("#confirmCancel").addEventListener("click", onCancel);
      dlg.addEventListener("close", onClose);
      dlg.showModal();
    });
  }

  // pressure (hPa) at or nearest to a given offset of hours from "now"
  function pressureAtOffset(hours) {
    if (!weatherData) return null;
    const target = Date.now() + hours * 3600 * 1000;
    let best = null, bestDiff = Infinity;
    for (const p of weatherData.series) {
      const d = Math.abs(p.t.getTime() - target);
      if (d < bestDiff) { bestDiff = d; best = p; }
    }
    return best ? best.pressure : null;
  }

  function pressureNow() {
    return weatherData ? weatherData.current.pressure : null;
  }

  /* ---------- view routing ---------- */
  function showView(name) {
    $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    $("#main").focus({ preventScroll: true });
    // Re-render the view being shown so its (now-visible) square canvas sizes correctly.
    if (name === "now") renderNow();
    if (name === "forecast") renderForecast();
    if (name === "trends") renderTrends();
    if (name === "log") { renderSnapshot(); renderLogList(); }
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

  /* ---------- NOW view ---------- */
  function describePressure(hpa) {
    if (hpa >= 1023) return "High pressure — typically calm, settled weather.";
    if (hpa >= 1013) return "Around average sea-level pressure.";
    if (hpa >= 1000) return "Slightly low — unsettled or changing weather.";
    return "Low pressure — often stormy; a common symptom trigger.";
  }

  function classifyTrend(delta6h) {
    if (delta6h <= -1.5) return { cls: "trend-down falling", arrow: "↓", text: "Falling" };
    if (delta6h >= 1.5) return { cls: "trend-up rising", arrow: "↑", text: "Rising" };
    return { cls: "trend-steady steady", arrow: "→", text: "Steady" };
  }

  function renderNow() {
    if (!weatherData) return;
    const cur = pressureNow();
    $("#pressureNow").textContent = PS.fmtPressure(cur, settings.pressureUnit);
    $("#pressureUnit").textContent = settings.pressureUnit;
    $("#pressureMeaning").textContent = describePressure(cur);

    const p3 = pressureAtOffset(-3), p6 = pressureAtOffset(-6), p24 = pressureAtOffset(-24);
    setDelta("#change3h", cur - p3);
    setDelta("#change6h", cur - p6);
    setDelta("#change24h", cur - p24);

    const trend = classifyTrend(cur - p6);
    const tEl = $("#pressureTrend");
    tEl.className = "pressure-trend " + trend.cls;
    $("#trendArrow").textContent = trend.arrow;
    $("#trendText").textContent = `${trend.text} · ${PS.fmtPressureDelta(cur - p6, settings.pressureUnit)} ${settings.pressureUnit} / 6h`;

    $("#temp").textContent = PS.fmtTemp(weatherData.current.temp, settings.tempUnit);
    $("#humidity").textContent = `${Math.round(weatherData.current.humidity)}%`;
    $("#conditions").textContent = PS.config.weatherCodes[weatherData.current.code] || "—";

    renderAlert();
    buildSymptomWatch();

    const past = weatherData.series.filter((p) => p.t.getTime() <= Date.now());
    const recent = past.slice(-24);
    PS.charts.pressureLine($("#chartNow"), recent, {
      unit: settings.pressureUnit,
      nowTime: weatherData.current.time
    });
  }

  function setDelta(sel, delta) {
    if (delta == null || isNaN(delta)) { $(sel).textContent = "--"; return; }
    const el = $(sel);
    el.textContent = `${PS.fmtPressureDelta(delta, settings.pressureUnit)}`;
    el.classList.remove("rising", "falling", "steady");
    el.classList.add(delta >= 1 ? "rising" : delta <= -1 ? "falling" : "steady");
  }

  function renderAlert() {
    const banner = $("#alertBanner");
    const cur = pressureNow();
    const next6 = pressureAtOffset(6);
    const next12 = pressureAtOffset(12);
    const drop = Math.min(next6 - cur, next12 - cur);
    const rise = Math.max(next6 - cur, next12 - cur);

    let cls = "calm", msg = "🌤️ Pressure looks stable for the next 12 hours. A good window if you're sensitive to changes.";

    if (drop <= PS.config.alertDrop6h) {
      cls = "bad";
      msg = `⚠️ Pressure is forecast to drop ${PS.fmtPressureDelta(drop, settings.pressureUnit)} ${settings.pressureUnit} soon. Falling pressure is a common vestibular/migraine trigger — consider preparing ahead.`;
    } else if (rise >= PS.config.alertRise6h) {
      cls = "warn";
      msg = `⚠️ Pressure is forecast to rise ${PS.fmtPressureDelta(rise, settings.pressureUnit)} ${settings.pressureUnit} soon. Rapid changes can trigger symptoms — take it easy.`;
    }

    banner.className = "alert-banner " + cls;
    banner.textContent = msg;
    banner.hidden = false;
  }

  /* ---------- AIR QUALITY ---------- */
  // Map a US AQI value to a position on the colored meter (matches the gradient
  // breakpoints, which aren't linear in AQI).
  function aqiToPercent(aqi) {
    const stops = [[0, 0], [50, 25], [100, 50], [150, 70], [200, 85], [300, 100]];
    if (aqi <= 0) return 0;
    if (aqi >= 300) return 100;
    for (let i = 1; i < stops.length; i++) {
      const [a0, p0] = stops[i - 1], [a1, p1] = stops[i];
      if (aqi <= a1) return p0 + ((aqi - a0) / (a1 - a0)) * (p1 - p0);
    }
    return 100;
  }

  function renderAirQuality() {
    const cur = airData && airData.current;
    const aqi = cur ? cur.aqi : null;
    const cat = PS.aqiCategory(aqi);
    $("#aqiValue").textContent = aqi != null ? Math.round(aqi) : "--";
    $("#aqiValue").style.color = cat.color;
    $("#aqiLabel").textContent = cat.label;
    $("#aqiLabel").style.color = cat.color;
    $("#aqiNote").textContent = cat.note;
    $("#aqiBar").style.marginLeft = `${aqiToPercent(aqi || 0)}%`;

    const pol = $("#aqiPollutants");
    if (cur && (cur.pm25 != null || cur.pm10 != null || cur.ozone != null)) {
      pol.innerHTML =
        (cur.pm25 != null ? `<span>PM2.5 <b>${Math.round(cur.pm25)}</b></span>` : "") +
        (cur.pm10 != null ? `<span>PM10 <b>${Math.round(cur.pm10)}</b></span>` : "") +
        (cur.ozone != null ? `<span>Ozone <b>${Math.round(cur.ozone)}</b></span>` : "");
    } else {
      pol.innerHTML = "";
    }
  }

  /* ---------- FORECAST view: detailed symptom analysis ---------- */

  // Top symptoms the user has actually logged under a given past condition.
  function symptomsUnder(predicate, minN = 2) {
    const logs = PS.store.getLogs().filter(predicate);
    if (logs.length < minN) return null;
    const counts = {};
    logs.forEach((l) => (l.symptoms || []).forEach((s) => (counts[s] = (counts[s] || 0) + 1)));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    return top.length ? { symptoms: top, n: logs.length } : null;
  }

  // Time of the steepest ~3h fall in the next 48h (for "when" context).
  function steepestDrop() {
    if (!weatherData) return null;
    const now = Date.now();
    const fut = weatherData.series.filter((p) => p.t.getTime() >= now - 3600e3 && p.t.getTime() <= now + 48 * 3600e3);
    let best = null;
    for (let i = 0; i < fut.length; i++) {
      const later = fut.find((p) => p.t.getTime() >= fut[i].t.getTime() + 3 * 3600e3);
      if (!later) break;
      const d = later.pressure - fut[i].pressure;
      if (best === null || d < best.d) best = { d, t: fut[i].t };
    }
    return best;
  }
  function whenLabel(date) {
    return (date.getTime() - Date.now()) / 3600e3 < 1
      ? "now" : date.toLocaleString([], { weekday: "short", hour: "numeric" });
  }

  // Analyze current + forecast conditions into weighted trigger factors and an
  // overall outlook, then render both. Each factor carries the symptoms it
  // commonly causes plus what the user has personally logged under similar days.
  function buildSymptomWatch() {
    const boxes = $$(".js-symptom-watch");
    const outlooks = $$(".js-outlook");
    if (!boxes.length && !outlooks.length) return;
    if (!weatherData) {
      outlooks.forEach((o) => (o.innerHTML = ""));
      boxes.forEach((b) => (b.innerHTML = '<p class="empty">Set your location to see guidance.</p>'));
      return;
    }

    const cur = pressureNow();
    const F = [];

    // Upcoming pressure swing (next 24h) — the main vestibular trigger.
    let maxDrop = 0, maxRise = 0;
    for (const h of [3, 6, 9, 12, 18, 24]) {
      const p = pressureAtOffset(h);
      if (p == null) continue;
      maxDrop = Math.min(maxDrop, p - cur); maxRise = Math.max(maxRise, p - cur);
    }
    const drop = steepestDrop();
    const dropWhen = drop && drop.d < -1 ? ` The steepest fall lands around ${whenLabel(drop.t)}.` : "";

    if (maxDrop <= -6) {
      F.push({ w: 3, level: "bad", icon: "📉", title: "Marked pressure drop ahead",
        detail: `Pressure is set to fall up to ${fmtChangeMag(-maxDrop)} over the next day.${dropWhen} Fast drops are the single most common vestibular and migraine trigger.`,
        symptoms: ["Vertigo", "Dizziness", "Migraine", "Ear fullness", "Nausea"],
        tip: "If your clinician has given you a plan for bad days, this is a window to start it early rather than waiting.",
        personal: symptomsUnder((l) => l.trend6h != null && l.trend6h <= -3) });
    } else if (maxDrop <= -3) {
      F.push({ w: 2, level: "warn", icon: "📉", title: "Pressure dropping",
        detail: `A fall of up to ${fmtChangeMag(-maxDrop)} is expected in the next day.${dropWhen}`,
        symptoms: ["Dizziness", "Headache", "Ear pressure", "Brain fog"],
        tip: "Hydrate, rest when you can, and pace yourself through the change.",
        personal: symptomsUnder((l) => l.trend6h != null && l.trend6h <= -2) });
    } else if (maxDrop <= -1.5) {
      F.push({ w: 1, level: "warn", icon: "📉", title: "Gentle pressure fall",
        detail: `A mild drop of about ${fmtChangeMag(-maxDrop)} is coming — usually manageable.`,
        symptoms: ["Mild dizziness", "Fatigue"], tip: "",
        personal: symptomsUnder((l) => l.trend6h != null && l.trend6h <= -1.5) });
    }
    if (maxRise >= 5) {
      F.push({ w: 2, level: "warn", icon: "📈", title: "Sharp pressure rise ahead",
        detail: `Pressure climbs up to ${fmtChangeMag(maxRise)} over the next day. Rapid rises are felt too, especially in the ears and sinuses.`,
        symptoms: ["Ear pressure", "Sinus pressure", "Headache"],
        tip: "Yawning, swallowing, or chewing gum can help your ears equalize.",
        personal: symptomsUnder((l) => l.trend6h != null && l.trend6h >= 3) });
    }

    // Absolute low pressure over the next day.
    const minFuture = Math.min(cur, pressureAtOffset(6) ?? cur, pressureAtOffset(12) ?? cur, pressureAtOffset(24) ?? cur);
    if (minFuture < 1000) {
      F.push({ w: 2, level: "bad", icon: "🌀", title: "Deep low-pressure system",
        detail: `Pressure dips to about ${PS.fmtPressure(minFuture, settings.pressureUnit)} ${settings.pressureUnit} — a stormy, low-pressure pattern that can linger.`,
        symptoms: ["Vertigo", "Joint aches", "Headache", "Low energy"],
        tip: "Low, stormy spells can drag on — plan lighter days if you're able.",
        personal: symptomsUnder((l) => l.pressure != null && l.pressure < 1005) });
    } else if (minFuture < 1008) {
      F.push({ w: 1, level: "warn", icon: "🌧️", title: "Below-average pressure",
        detail: `Pressure sits around ${PS.fmtPressure(minFuture, settings.pressureUnit)} ${settings.pressureUnit} — on the low, unsettled side.`,
        symptoms: ["Headache", "Fatigue", "Sinus pressure"], tip: "",
        personal: symptomsUnder((l) => l.pressure != null && l.pressure < 1008) });
    }

    // Humidity.
    const hum = weatherData.current.humidity;
    if (hum >= 90) {
      F.push({ w: 2, level: "warn", icon: "💧", title: "Very high humidity",
        detail: `Humidity around ${Math.round(hum)}%. Heavy, muggy air often worsens that off-balance, heavy-headed feeling.`,
        symptoms: ["Dizziness", "Fatigue", "Breathlessness", "Nausea"],
        tip: "Seek cool, well-ventilated spaces and sip water.",
        personal: symptomsUnder((l) => l.humidity != null && l.humidity >= 80) });
    } else if (hum >= 80) {
      F.push({ w: 1, level: "warn", icon: "💧", title: "High humidity",
        detail: `Humidity around ${Math.round(hum)}% — muggy enough that some people notice it.`,
        symptoms: ["Dizziness", "Fatigue"], tip: "",
        personal: symptomsUnder((l) => l.humidity != null && l.humidity >= 75) });
    } else if (hum <= 25) {
      F.push({ w: 1, level: "warn", icon: "🏜️", title: "Very dry air",
        detail: `Humidity around ${Math.round(hum)}%. Dry air can irritate sinuses and dehydrate you faster.`,
        symptoms: ["Dry sinuses", "Headache"], tip: "Drink extra water; a humidifier can help." });
    }

    // Temperature swing over the next 24h.
    const temps = weatherData.series
      .filter((p) => p.t.getTime() >= Date.now() && p.t.getTime() <= Date.now() + 24 * 3600e3)
      .map((p) => p.temp).filter((t) => t != null);
    if (temps.length) {
      const swing = Math.max(...temps) - Math.min(...temps);
      if (swing >= 16) {
        F.push({ w: 2, level: "warn", icon: "🌡️", title: "Large temperature swing",
          detail: `About ${Math.round(swing)}°C between today's high and low. Big temperature shifts can set off head and sinus symptoms.`,
          symptoms: ["Headache", "Sinus pressure", "Fatigue"], tip: "Layer up or down to smooth the transition." });
      } else if (swing >= 12) {
        F.push({ w: 1, level: "warn", icon: "🌡️", title: "Notable temperature swing",
          detail: `About ${Math.round(swing)}°C from high to low today.`, symptoms: ["Headache", "Fatigue"], tip: "" });
      }
    }

    // Air quality.
    const aqi = airData && airData.current ? airData.current.aqi : null;
    if (aqi != null && aqi > 150) {
      F.push({ w: 3, level: "bad", icon: "🌫️", title: `Unhealthy air (AQI ${Math.round(aqi)})`,
        detail: PS.aqiCategory(aqi).note, symptoms: ["Headache", "Fatigue", "Throat/eye irritation", "Chest tightness"],
        tip: "Keep windows shut and limit time outdoors; use filtered air if you can.",
        personal: symptomsUnder((l) => l.aqi != null && l.aqi > 100) });
    } else if (aqi != null && aqi > 100) {
      F.push({ w: 2, level: "warn", icon: "🌫️", title: `Poor air quality (AQI ${Math.round(aqi)})`,
        detail: PS.aqiCategory(aqi).note, symptoms: ["Headache", "Fatigue", "Irritated eyes/throat"],
        tip: "Sensitive people may want to limit outdoor exertion.",
        personal: symptomsUnder((l) => l.aqi != null && l.aqi > 80) });
    }

    // Overall outlook from the combined weight of factors.
    const score = F.reduce((s, f) => s + f.w, 0);
    let lvl, color, summary;
    if (score === 0) {
      lvl = "Low"; color = "var(--good)";
      summary = "Conditions look calm — no major pressure, humidity, temperature, or air-quality triggers in the next day. A good window if you're sensitive.";
    } else {
      if (score <= 2) { lvl = "Moderate"; color = "var(--warn)"; }
      else if (score <= 4) { lvl = "Elevated"; color = "#e8731a"; }
      else { lvl = "High"; color = "var(--bad)"; }
      const names = F.slice().sort((a, b) => b.w - a.w).map((f) => f.title.replace(/\s*\(AQI[^)]*\)/, "").toLowerCase());
      summary = `${F.length} factor${F.length > 1 ? "s" : ""} to watch — ${names.join(", ")}. Each is broken down below with the symptoms it can bring and what has affected you before.`;
    }
    const outlookHTML =
      `<span class="outlook-level" style="background:${color}">${lvl} trigger risk</span>` +
      `<div class="outlook-summary">${summary}</div>`;
    outlooks.forEach((o) => (o.innerHTML = outlookHTML));

    const factorsHTML = !F.length ? "" : F.sort((a, b) => b.w - a.w).map((f) => `
      <div class="watch-item ${f.level}">
        <span class="watch-icon" aria-hidden="true">${f.icon}</span>
        <div class="watch-body">
          <div class="watch-title">${f.title}</div>
          <div class="watch-text">${f.detail}</div>
          <div class="watch-sym">Commonly linked to: <b>${f.symptoms.join(", ")}</b></div>
          ${f.personal ? `<div class="watch-personal">Your history: you've logged <b>${f.personal.symptoms.join(", ")}</b> on ${f.personal.n} day${f.personal.n > 1 ? "s" : ""} with similar conditions.</div>` : ""}
          ${f.tip ? `<div class="watch-tip">💡 ${f.tip}</div>` : ""}
        </div>
      </div>`).join("");
    boxes.forEach((b) => (b.innerHTML = factorsHTML));
  }

  function renderForecast() {
    buildSymptomWatch();
    if (!weatherData) return;
    const future = weatherData.series.filter(
      (p) => p.t.getTime() >= Date.now() - 3600000
    ).slice(0, 48);
    PS.charts.pressureLine($("#chartForecast"), future, {
      unit: settings.pressureUnit,
      nowTime: weatherData.current.time
    });

    // Summarize in ~6h blocks
    const list = $("#forecastList");
    list.innerHTML = "";
    const blocks = [];
    for (let i = 0; i < future.length; i += 6) {
      const chunk = future.slice(i, i + 6);
      if (chunk.length < 2) continue;
      const start = chunk[0], end = chunk[chunk.length - 1];
      blocks.push({ start, end, delta: end.pressure - start.pressure });
    }
    if (!blocks.length) { list.innerHTML = '<p class="empty">No forecast available.</p>'; return; }

    blocks.forEach((b) => {
      const row = document.createElement("div");
      row.className = "forecast-row";
      const when = b.start.t.toLocaleString([], { weekday: "short", hour: "numeric" });
      let desc, color;
      if (b.delta <= -3) { desc = "Notable drop — possible trigger"; color = "var(--bad)"; }
      else if (b.delta <= -1.5) { desc = "Gentle fall"; color = "var(--warn)"; }
      else if (b.delta >= 3) { desc = "Sharp rise"; color = "var(--warn)"; }
      else if (b.delta >= 1.5) { desc = "Gentle rise"; color = "var(--warn)"; }
      else { desc = "Steady — calm window"; color = "var(--good)"; }
      row.innerHTML = `
        <span class="when">${when}</span>
        <span class="desc">${desc}</span>
        <span class="delta" style="color:${color}">${PS.fmtPressureDelta(b.delta, settings.pressureUnit)} ${settings.pressureUnit}</span>`;
      list.appendChild(row);
    });
  }

  /* ---------- LOG: data + check-in wizard ---------- */

  // A snapshot of the weather attached to each log entry, so the data is rich
  // enough to find patterns later.
  function currentSnapshot() {
    const snap = { pressure: pressureNow() };
    if (weatherData) {
      snap.temp = weatherData.current.temp;
      snap.humidity = weatherData.current.humidity;
      snap.code = weatherData.current.code;
      const p6 = pressureAtOffset(-6);
      if (p6 != null && snap.pressure != null) snap.trend6h = snap.pressure - p6;
    }
    if (airData && airData.current) snap.aqi = airData.current.aqi;
    return snap;
  }

  function saveEntry(severity, symptoms, note, when, snapshot, location) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: (when || new Date()).toISOString(),
      severity, symptoms, note,
      ...(snapshot || currentSnapshot())
    };
    if (location) entry.location = { name: location.name, latitude: location.latitude, longitude: location.longitude };
    PS.store.addLog(entry);
    renderLogList();
  }

  // <input type="datetime-local"> value formatting (local time, no timezone).
  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Five plain-language severity levels (single-select checklist in step 1).
  const SEV_LEVELS = [
    { v: 0, name: "Feeling good", range: "0" },
    { v: 2, name: "Mild", range: "1–3" },
    { v: 4, name: "Moderate", range: "4–6" },
    { v: 7, name: "Strong", range: "7–8" },
    { v: 9, name: "Severe", range: "9–10" }
  ];

  const wiz = { step: 0, severity: null, symptoms: new Set(), foods: new Set(),
    env: new Set(), stress: new Set(), steps: 5,
    when: new Date(), location: null, snapshot: null, loading: false, editId: null };

  // Generic multi-select checklist builder. Reads/writes wiz[field] at click
  // time, so it keeps working after openWizard swaps in a fresh Set.
  function buildChecklist(containerSel, items, field) {
    const wrap = $(containerSel);
    wrap.innerHTML = "";
    items.forEach((it) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "check-item";
      b.dataset.val = it;
      b.innerHTML = `<span class="box" aria-hidden="true">✓</span><span>${it}</span>`;
      b.addEventListener("click", () => {
        const set = wiz[field];
        if (set.has(it)) set.delete(it); else set.add(it);
        b.classList.toggle("on", set.has(it));
      });
      wrap.appendChild(b);
    });
  }

  // Normalize the weather fields of an entry/snapshot into a consistent shape,
  // so editing always overwrites cleanly (no stale keys left behind).
  function entryConditions(s) {
    s = s || {};
    return {
      pressure: s.pressure ?? null, trend6h: s.trend6h ?? null,
      temp: s.temp ?? null, humidity: s.humidity ?? null,
      aqi: s.aqi ?? null, code: s.code ?? null
    };
  }

  function buildSevOptions() {
    const wrap = $("#wizSeverity");
    wrap.innerHTML = "";
    SEV_LEVELS.forEach((lvl) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sev-opt";
      b.dataset.v = lvl.v;
      b.setAttribute("role", "radio");
      b.innerHTML =
        `<span class="dot" style="background:${PS.charts.severityColor(lvl.v)}"></span>` +
        `<span class="sev-name">${lvl.name}</span>` +
        `<span class="sev-range">${lvl.range}</span>`;
      b.addEventListener("click", () => {
        wiz.severity = lvl.v;
        $$("#wizSeverity .sev-opt").forEach((o) => o.classList.toggle("on", o === b));
        b.setAttribute("aria-checked", "true");
      });
      wrap.appendChild(b);
    });
  }

  function buildWizSymptoms() {
    const wrap = $("#wizSymptoms");
    wrap.innerHTML = "";
    PS.config.symptoms.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "check-item";
      b.dataset.sym = s;
      b.innerHTML = `<span class="box" aria-hidden="true">✓</span><span>${s}</span>`;
      b.addEventListener("click", () => {
        if (wiz.symptoms.has(s)) wiz.symptoms.delete(s); else wiz.symptoms.add(s);
        b.classList.toggle("on", wiz.symptoms.has(s));
      });
      wrap.appendChild(b);
    });
  }

  function buildFoodChips() {
    const wrap = $("#wizFoods");
    wrap.innerHTML = "";
    PS.config.foodTriggers.forEach((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "check-item";
      b.dataset.food = f;
      b.innerHTML = `<span class="box" aria-hidden="true">✓</span><span>${f}</span>`;
      b.addEventListener("click", () => {
        if (wiz.foods.has(f)) wiz.foods.delete(f); else wiz.foods.add(f);
        b.classList.toggle("on", wiz.foods.has(f));
      });
      wrap.appendChild(b);
    });
  }

  // Open the wizard. Pass an existing entry to edit it; omit to start a new one.
  function openWizard(entry) {
    wiz.step = 0;
    wiz.editId = entry ? entry.id : null;
    wiz.loading = false;
    if (entry) {
      wiz.severity = entry.severity;
      wiz.symptoms = new Set(entry.symptoms || []);
      wiz.foods = new Set(entry.foods || []);
      wiz.env = new Set(entry.environment || []);
      wiz.stress = new Set(entry.stress || []);
      wiz.when = new Date(entry.ts);
      wiz.location = entry.location ? { ...entry.location } : (settings.location ? { ...settings.location } : null);
      wiz.snapshot = entryConditions(entry);
    } else {
      wiz.severity = null;
      wiz.symptoms = new Set();
      wiz.foods = new Set();
      wiz.env = new Set();
      wiz.stress = new Set();
      wiz.when = new Date();
      wiz.location = settings.location ? { ...settings.location } : null;
      wiz.snapshot = currentSnapshot();
    }
    $("#wizNote").value = entry ? (entry.note || "") : "";
    $("#wizDietNote").value = entry ? (entry.dietNote || "") : "";
    $$("#wizSeverity .sev-opt").forEach((o) => {
      const on = wiz.severity != null && +o.dataset.v === wiz.severity;
      o.classList.toggle("on", on); o.setAttribute("aria-checked", on ? "true" : "false");
    });
    $$("#wizSymptoms .check-item").forEach((o) => o.classList.toggle("on", wiz.symptoms.has(o.dataset.sym)));
    $$("#wizFoods .check-item").forEach((o) => o.classList.toggle("on", wiz.foods.has(o.dataset.food)));
    $$("#wizEnv .check-item").forEach((o) => o.classList.toggle("on", wiz.env.has(o.dataset.val)));
    $$("#wizStress .check-item").forEach((o) => o.classList.toggle("on", wiz.stress.has(o.dataset.val)));
    $("#wizLocName").textContent = wiz.location ? wiz.location.name : "No location set";
    $("#wizLocSearch").hidden = true;
    $("#wizCitySearch").value = ""; $("#wizCityResults").innerHTML = "";
    const now = new Date();
    const win = $("#wizWhen");
    win.max = toLocalInput(now);
    win.min = toLocalInput(new Date(now.getTime() - 91 * 864e5)); // Open-Meteo history limit
    win.value = toLocalInput(wiz.when);
    $("#wizTitle").textContent = entry ? "Edit entry" : "New check-in";
    renderWizSnapshot();
    $("#logWizard").hidden = false;
    document.body.style.overflow = "hidden";
    wizGoto(0);
  }

  // Save the wizard — updates the existing entry when editing, else adds new.
  function commitWizard() {
    const fields = {
      ts: wiz.when.toISOString(),
      severity: wiz.severity,
      symptoms: [...wiz.symptoms],
      foods: [...wiz.foods],
      environment: [...wiz.env],
      stress: [...wiz.stress],
      dietNote: $("#wizDietNote").value.trim(),
      note: $("#wizNote").value.trim(),
      ...entryConditions(wiz.snapshot),
      location: wiz.location
        ? { name: wiz.location.name, latitude: wiz.location.latitude, longitude: wiz.location.longitude }
        : null
    };
    if (wiz.editId) {
      PS.store.updateLog(wiz.editId, fields);
    } else {
      PS.store.addLog({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...fields });
    }
    renderLogList();
  }

  // Load the conditions for the chosen time AND place.
  async function updateWizConditions() {
    const loc = wiz.location, when = wiz.when, now = Date.now();
    const isNow = now - when.getTime() < 3600 * 1000;
    const sameLoc = settings.location && loc &&
      loc.latitude === settings.location.latitude && loc.longitude === settings.location.longitude;
    // "Now" at the saved location → reuse the already-loaded live data.
    if (isNow && sameLoc && weatherData) { wiz.snapshot = currentSnapshot(); renderWizSnapshot(); return; }
    if (!loc) { wiz.snapshot = {}; renderWizSnapshot(); return; }
    wiz.loading = true; renderWizSnapshot();
    try {
      wiz.snapshot = await PS.weather.fetchHistoricalSnapshot(loc.latitude, loc.longitude, when) || {};
    } catch {
      wiz.snapshot = {};
      toast("Couldn't load conditions for that time/place");
    }
    wiz.loading = false;
    renderWizSnapshot();
  }

  function onWizWhenChange() {
    const val = $("#wizWhen").value;
    if (!val) return;
    let when = new Date(val);
    const now = new Date();
    if (when > now) { when = now; $("#wizWhen").value = toLocalInput(now); }
    wiz.when = when;
    updateWizConditions();
  }

  function setWizLocation(loc) {
    wiz.location = loc ? { name: loc.name, latitude: loc.latitude, longitude: loc.longitude } : null;
    $("#wizLocName").textContent = wiz.location ? wiz.location.name : "No location set";
    $("#wizLocSearch").hidden = true;
    $("#wizCitySearch").value = ""; $("#wizCityResults").innerHTML = "";
    updateWizConditions();
  }

  function closeWizard() {
    $("#logWizard").hidden = true;
    document.body.style.overflow = "";
  }

  function wizGoto(n) {
    wiz.step = Math.max(0, Math.min(wiz.steps - 1, n));
    $$(".wiz-step").forEach((s) => (s.hidden = +s.dataset.step !== wiz.step));
    $("#wizBar").style.width = `${((wiz.step + 1) / wiz.steps) * 100}%`;
    $("#wizStepLabel").textContent = `${wiz.step + 1} / ${wiz.steps}`;
    $("#wizBack").style.visibility = wiz.step === 0 ? "hidden" : "visible";
    $("#wizNext").textContent = wiz.step === wiz.steps - 1 ? (wiz.editId ? "Save changes" : "Save entry") : "Next";
    $(".wizard-body").scrollTop = 0;
  }

  function wizNext() {
    if (wiz.step === 0 && wiz.severity == null) { toast("Pick how you're feeling"); return; }
    if (wiz.step === wiz.steps - 1) {
      const editing = !!wiz.editId;
      commitWizard();
      closeWizard();
      renderSnapshot();
      toast(editing ? "Entry updated" : (Date.now() - wiz.when.getTime() > 3600 * 1000 ? "Back-dated entry saved" : "Entry saved"));
      return;
    }
    wizGoto(wiz.step + 1);
  }

  $("#startLogBtn").addEventListener("click", openWizard);
  $("#wizClose").addEventListener("click", closeWizard);
  $("#wizBack").addEventListener("click", () => wizGoto(wiz.step - 1));
  $("#wizNext").addEventListener("click", wizNext);
  $("#wizWhen").addEventListener("change", onWizWhenChange);

  // Location override inside the wizard (for back-dated incidents elsewhere).
  $("#wizLocBtn").addEventListener("click", () => {
    const s = $("#wizLocSearch");
    s.hidden = !s.hidden;
    if (!s.hidden) $("#wizCitySearch").focus();
  });
  $("#wizUseSaved").addEventListener("click", () => setWizLocation(settings.location));
  let wizSearchTimer;
  $("#wizCitySearch").addEventListener("input", (e) => {
    clearTimeout(wizSearchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { $("#wizCityResults").innerHTML = ""; return; }
    wizSearchTimer = setTimeout(async () => {
      try {
        const results = await PS.weather.geocode(q);
        const ul = $("#wizCityResults"); ul.innerHTML = "";
        results.forEach((r) => {
          const li = document.createElement("li");
          li.textContent = r.name;
          li.addEventListener("click", () => setWizLocation(r));
          ul.appendChild(li);
        });
      } catch { toast("Search failed — check connection"); }
    }, 350);
  });

  // Quick "feeling good" — one-tap zero-severity entry (for right now, saved location).
  $("#quickGoodBtn").addEventListener("click", () => {
    saveEntry(0, [], "Feeling good", new Date(), currentSnapshot(), settings.location);
    toast("Logged a good moment ✓");
  });

  // Build the conditions "chips" from any snapshot object (works for live or
  // historical data — both share the same shape).
  function snapshotHTML(snap) {
    if (!snap || snap.pressure == null) {
      return '<span class="snap">No recorded conditions for this time.</span>';
    }
    const parts = [`<span class="snap">Pressure <b>${PS.fmtPressure(snap.pressure, settings.pressureUnit)} ${settings.pressureUnit}</b></span>`];
    if (snap.trend6h != null) parts.push(`<span class="snap">Trend <b>${classifyTrend(snap.trend6h).text}</b></span>`);
    if (snap.temp != null) parts.push(`<span class="snap">Temp <b>${PS.fmtTemp(snap.temp, settings.tempUnit)}</b></span>`);
    if (snap.humidity != null) parts.push(`<span class="snap">Humidity <b>${Math.round(snap.humidity)}%</b></span>`);
    if (snap.aqi != null) parts.push(`<span class="snap">AQI <b>${Math.round(snap.aqi)}</b></span>`);
    return parts.join("");
  }

  // Landing-page snapshot = live "right now" conditions.
  function renderSnapshot() {
    const el = $("#logSnapshot");
    if (!el) return;
    el.innerHTML = weatherData
      ? snapshotHTML(currentSnapshot())
      : '<span class="snap">Set your location to attach conditions.</span>';
  }

  // Wizard snapshot = conditions for the chosen date/time (may be historical).
  function renderWizSnapshot() {
    const el = $("#wizSnapshot");
    if (!el) return;
    if (wiz.loading) { el.innerHTML = '<span class="snap">Loading conditions for that time…</span>'; return; }
    if (!settings.location) { el.innerHTML = '<span class="snap">Set your location to attach conditions.</span>'; return; }
    el.innerHTML = snapshotHTML(wiz.snapshot);
  }

  function renderLogStats() {
    const logs = PS.store.getLogs();
    const el = $("#logStats");
    if (!el) return;
    if (!logs.length) { el.innerHTML = ""; return; }
    const avg = logs.reduce((s, l) => s + l.severity, 0) / logs.length;
    const last7 = logs.filter((l) => Date.now() - new Date(l.ts).getTime() < 7 * 864e5).length;
    const topSym = countSymptoms(logs);
    el.innerHTML =
      `<span class="stat-pill"><b>${logs.length}</b> entries</span>` +
      `<span class="stat-pill"><b>${avg.toFixed(1)}</b> avg severity</span>` +
      `<span class="stat-pill"><b>${last7}</b> in last 7 days</span>` +
      (topSym ? `<span class="stat-pill"><b>${topSym}</b> top symptom</span>` : "");
  }

  function renderLogList() {
    renderLogStats();
    const logs = PS.store.getLogs();
    const list = $("#logList");
    list.innerHTML = "";
    if (!logs.length) {
      list.innerHTML = '<li class="empty">No entries yet. Log how you feel to start spotting patterns.</li>';
      return;
    }
    logs.slice(0, 50).forEach((l) => {
      const li = document.createElement("li");
      li.className = "log-item";
      const when = new Date(l.ts).toLocaleString([], {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      });
      const press = l.pressure != null
        ? `${PS.fmtPressure(l.pressure, settings.pressureUnit)} ${settings.pressureUnit}` : "—";
      // Build a compact conditions line from whatever the snapshot captured.
      const cond = [];
      if (l.temp != null) cond.push(PS.fmtTemp(l.temp, settings.tempUnit));
      if (l.humidity != null) cond.push(`${Math.round(l.humidity)}% hum`);
      if (l.aqi != null) cond.push(`AQI ${Math.round(l.aqi)}`);
      li.innerHTML = `
        <span class="sev-badge" style="background:${PS.charts.severityColor(l.severity)}">${l.severity}</span>
        <div class="log-meta">
          <div class="log-when">${when}</div>
          ${l.symptoms.length ? `<div class="log-sym">${l.symptoms.join(" · ")}</div>` : ""}
          ${l.note ? `<div class="log-note">${escapeHtml(l.note)}</div>` : ""}
          <div class="log-press">Pressure: ${press}</div>
          ${cond.length ? `<div class="log-cond">${cond.join(" · ")}</div>` : ""}
          ${(l.foods && l.foods.length) || l.dietNote ? `<div class="log-cond">🍽 ${escapeHtml([...(l.foods || []), l.dietNote].filter(Boolean).join(" · "))}</div>` : ""}
          ${l.environment && l.environment.length ? `<div class="log-cond">🌿 ${escapeHtml(l.environment.join(" · "))}</div>` : ""}
          ${l.stress && l.stress.length ? `<div class="log-cond">🧠 ${escapeHtml(l.stress.join(" · "))}</div>` : ""}
          ${l.location && l.location.name ? `<div class="log-cond">📍 ${escapeHtml(l.location.name)}</div>` : ""}
        </div>
        <div class="log-btns">
          <button class="edit-btn" aria-label="Edit entry" data-id="${l.id}">✎</button>
          <button class="del-btn" aria-label="Delete entry" data-id="${l.id}">✕</button>
        </div>`;
      list.appendChild(li);
    });
    $$("#logList .edit-btn").forEach((b) =>
      b.addEventListener("click", () => {
        const entry = PS.store.getLogs().find((l) => l.id === b.dataset.id);
        if (entry) openWizard(entry);
      })
    );
    $$("#logList .del-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        const ok = await askConfirm({
          title: "Delete this entry?",
          body: "It moves to Recently deleted and can be restored for 30 days.",
          confirmText: "Delete"
        });
        if (!ok) return;
        PS.store.deleteLog(b.dataset.id);
        renderLogList();
        toast("Entry deleted — recover within 30 days");
      })
    );
    renderTrash();
  }

  function renderTrash() {
    const card = $("#trashCard"), list = $("#trashList");
    if (!card || !list) return;
    const trash = PS.store.getTrash();
    if (!trash.length) { card.hidden = true; list.innerHTML = ""; return; }
    card.hidden = false;
    list.innerHTML = "";
    const ttl = PS.store.trashTtlDays();
    trash.forEach((l) => {
      const li = document.createElement("li");
      li.className = "log-item";
      const when = new Date(l.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const daysLeft = Math.max(0, ttl - Math.floor((Date.now() - new Date(l.deletedAt).getTime()) / 864e5));
      li.innerHTML = `
        <span class="sev-badge" style="background:${PS.charts.severityColor(l.severity)}">${l.severity}</span>
        <div class="log-meta">
          <div class="log-when">${when}</div>
          ${(l.symptoms && l.symptoms.length) ? `<div class="log-sym">${l.symptoms.join(" · ")}</div>` : ""}
          <div class="log-cond">🗑 ${daysLeft} day${daysLeft === 1 ? "" : "s"} left to restore</div>
        </div>
        <div class="log-btns">
          <button class="restore-btn" data-id="${l.id}" aria-label="Restore entry" title="Restore">↩</button>
          <button class="purge-btn" data-id="${l.id}" aria-label="Delete forever" title="Delete forever">✕</button>
        </div>`;
      list.appendChild(li);
    });
    $$("#trashList .restore-btn").forEach((b) =>
      b.addEventListener("click", () => {
        PS.store.restoreLog(b.dataset.id);
        renderLogList();
        toast("Entry restored");
      })
    );
    $$("#trashList .purge-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        const ok = await askConfirm({
          title: "Delete forever?",
          body: "This permanently removes the entry. It can't be undone.",
          confirmText: "Delete forever"
        });
        if (!ok) return;
        PS.store.purgeLog(b.dataset.id);
        renderTrash();
        toast("Permanently deleted");
      })
    );
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  $("#exportBtn").addEventListener("click", () => {
    const logs = PS.store.getLogs();
    if (!logs.length) { toast("Nothing to export yet"); return; }
    const csv = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const header = "timestamp,severity,symptoms,foods,diet_note,environment,stress,pressure_hpa,pressure_change_6h,temp_c,humidity_pct,us_aqi,note\n";
    const rows = logs.map((l) =>
      [l.ts, l.severity, csv((l.symptoms || []).join("; ")),
       csv((l.foods || []).join("; ")), csv(l.dietNote || ""),
       csv((l.environment || []).join("; ")), csv((l.stress || []).join("; ")),
       l.pressure != null ? l.pressure.toFixed(1) : "",
       l.trend6h != null ? l.trend6h.toFixed(1) : "",
       l.temp != null ? l.temp.toFixed(1) : "",
       l.humidity != null ? Math.round(l.humidity) : "",
       l.aqi != null ? Math.round(l.aqi) : "",
       csv(l.note || "")].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pressuresense-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#logNowBtn").addEventListener("click", () => { showView("log"); openWizard(); });

  // Download the full Trends report as a PDF (built client-side in report.js).
  $("#downloadReportBtn").addEventListener("click", () => {
    if (!PS.store.getLogs().length) { toast("No entries yet to report"); return; }
    try {
      PS.report.generate();
      toast("Report downloaded");
    } catch {
      toast("Couldn't build the report");
    }
  });

  /* ---------- TRENDS view ---------- */
  function renderTrends() {
    const logs = PS.store.getLogs();
    // Plot the actual logged entries across their whole history (oldest → newest).
    const entries = logs
      .map((l) => ({ t: new Date(l.ts), severity: l.severity, pressure: l.pressure ?? null }))
      .sort((a, b) => a.t - b.t);
    PS.charts.logTimeline($("#chartTrends"), entries, { unit: settings.pressureUnit });
    $("#insightCard").innerHTML = computeInsight(logs);
  }

  // Lightweight correlation: compare 6h pressure change preceding each logged
  // entry against its severity. Purely descriptive, not medical advice.
  function computeInsight(logs) {
    if (logs.length < 4) {
      return `Log a handful of entries across different weather and your personal
        patterns will appear here. <span class="muted">Aim for a few weeks of data —
        a logged dizzy day during a pressure drop is the kind of signal we look for.</span>`;
    }
    const withPressure = logs.filter((l) => l.pressure != null);
    const high = withPressure.filter((l) => l.severity >= 5);
    const low = withPressure.filter((l) => l.severity <= 2);
    const avg = (a) => a.reduce((s, l) => s + l.pressure, 0) / a.length;

    let lines = [`You've logged <strong>${logs.length}</strong> entries.`];
    if (high.length && low.length) {
      const hp = avg(high), lp = avg(low);
      const diff = hp - lp;
      if (Math.abs(diff) >= 2) {
        lines.push(
          `On your worse days (severity 5+), pressure averaged
           <strong>${Math.round(hp)} hPa</strong> — about
           <strong>${Math.abs(Math.round(diff))} hPa ${diff < 0 ? "lower" : "higher"}</strong>
           than on your good days. ${diff < 0 ? "That fits the common pattern of low pressure aggravating symptoms." : ""}`
        );
      } else {
        lines.push("So far there's no strong pressure difference between your good and bad days — keep logging.");
      }
    }
    const pc = pressureChangeStats(logs);
    if (pc) {
      lines.push(`Your entries average a 6-hour pressure change of <strong>${fmtChangeMag(pc.avgMag)}</strong>.`);
      if (pc.avgBadMag != null) {
        lines.push(`On tougher days (severity 4+) that change averages <strong>${fmtChangeMag(pc.avgBadMag)}</strong> — the level pressure-change alerts watch for.`);
      }
    }
    const topSym = countSymptoms(logs);
    if (topSym) lines.push(`Most logged symptom: <strong>${topSym}</strong>.`);
    const ta = topAssociation(logs);
    if (ta) lines.push(`Your <strong>${ta.label}</strong> (${ta.cat}) entries average <strong>${ta.lift.toFixed(1)} higher</strong> severity than usual — a possible trigger worth watching.`);
    lines.push(`<span class="muted">This is a personal trend summary, not medical advice.
      Share your exported log with your clinician.</span>`);
    return lines.map((l) => `<p>${l}</p>`).join("");
  }

  function countSymptoms(logs) {
    const counts = {};
    logs.forEach((l) => (l.symptoms || []).forEach((s) => (counts[s] = (counts[s] || 0) + 1)));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  }

  // The trigger (food / environmental / stress) most associated with worse
  // days: highest average-severity lift above the overall average, seen 2+ times.
  function topAssociation(logs) {
    if (logs.length < 4) return null;
    const overall = logs.reduce((s, l) => s + l.severity, 0) / logs.length;
    const acc = {};
    [["food", "foods"], ["environmental", "environment"], ["stress", "stress"]].forEach(([cat, field]) =>
      logs.forEach((l) => (l[field] || []).forEach((x) => {
        const k = field + "|" + x;
        (acc[k] = acc[k] || { label: x, cat, sev: [] }).sev.push(l.severity);
      }))
    );
    let best = null;
    Object.values(acc).forEach((o) => {
      if (o.sev.length < 2) return;
      const lift = o.sev.reduce((s, v) => s + v, 0) / o.sev.length - overall;
      if (!best || lift > best.lift) best = { label: o.label, cat: o.cat, lift, n: o.sev.length };
    });
    return best && best.lift >= 1 ? best : null;
  }

  /* ---------- pressure-change tracking + alerts ---------- */
  const fmtChangeMag = (hpa) =>
    settings.pressureUnit === "inHg" ? `${PS.toInHg(hpa).toFixed(2)} inHg` : `${hpa.toFixed(1)} hPa`;

  // Average magnitude of the 6h pressure change recorded across logs, overall
  // and on tougher days — this is the personal pattern alerts are built on.
  function pressureChangeStats(logs) {
    const wt = logs.filter((l) => l.trend6h != null);
    if (!wt.length) return null;
    const mag = (a) => a.reduce((s, l) => s + Math.abs(l.trend6h), 0) / a.length;
    const bad = wt.filter((l) => l.severity >= 4);
    return { count: wt.length, avgMag: mag(wt), avgBadMag: bad.length ? mag(bad) : null, badCount: bad.length };
  }

  // Threshold (hPa) above which an upcoming swing is worth alerting about.
  function alertThreshold() {
    const pc = pressureChangeStats(PS.store.getLogs());
    if (pc && pc.avgBadMag != null && pc.badCount >= 2) return Math.max(2, pc.avgBadMag * 0.85);
    if (pc && pc.count >= 3) return Math.max(3, pc.avgMag);
    return 5; // sensible default until we know the user's pattern
  }

  const NOTIFY_KEY = "ps.lastNotify";
  function showNotification(title, body) {
    const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "ps-pressure" };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts))
        .catch(() => { try { new Notification(title, opts); } catch {} });
    } else {
      try { new Notification(title, opts); } catch {}
    }
  }

  // Alert when an upcoming forecast swing reaches the user's personal threshold.
  function maybeNotifyPressure() {
    if (!settings.notifications || !weatherData) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const cur = pressureNow();
    let maxMag = 0, signed = 0;
    for (const h of [3, 6, 9, 12]) {
      const p = pressureAtOffset(h);
      if (p == null) continue;
      const d = p - cur;
      if (Math.abs(d) > maxMag) { maxMag = Math.abs(d); signed = d; }
    }
    if (maxMag < alertThreshold()) return;
    const last = +(localStorage.getItem(NOTIFY_KEY) || 0);
    if (Date.now() - last < 6 * 3600 * 1000) return; // at most once per 6h
    try { localStorage.setItem(NOTIFY_KEY, String(Date.now())); } catch {}
    showNotification("PressureSense — pressure change ahead",
      `Pressure is forecast to ${signed < 0 ? "drop" : "rise"} ~${fmtChangeMag(maxMag)} soon — around the level linked to your tougher days. Take it easy.`);
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { toast("Notifications aren't supported here"); return false; }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notification permission was declined"); return false; }
    return true;
  }

  /* ---------- location & settings ---------- */
  const dialog = $("#locationDialog");
  $("#locationBtn").addEventListener("click", () => { syncSegButtons(); dialog.showModal(); });

  $("#useGpsBtn").addEventListener("click", () => {
    if (!navigator.geolocation) { toast("Geolocation not supported"); return; }
    toast("Locating…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const name = await PS.weather.reverseName(latitude, longitude);
        setLocation({ name, latitude, longitude });
        dialog.close();
      },
      () => toast("Couldn't get location — try searching instead"),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });

  let searchTimer;
  $("#citySearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { $("#cityResults").innerHTML = ""; return; }
    searchTimer = setTimeout(async () => {
      try {
        const results = await PS.weather.geocode(q);
        const ul = $("#cityResults");
        ul.innerHTML = "";
        results.forEach((r) => {
          const li = document.createElement("li");
          li.textContent = r.name;
          li.addEventListener("click", () => {
            setLocation(r);
            $("#citySearch").value = "";
            ul.innerHTML = "";
            dialog.close();
          });
          ul.appendChild(li);
        });
      } catch { toast("Search failed — check connection"); }
    }, 350);
  });

  // unit toggles
  $$(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.notify) return; // notifications handled separately (async)
      if (b.dataset.unit) settings.pressureUnit = b.dataset.unit;
      if (b.dataset.tunit) settings.tempUnit = b.dataset.tunit;
      PS.store.saveSettings(settings);
      syncSegButtons();
      renderNow();
      renderSnapshot();
      renderWizSnapshot();
      renderLogList();
    })
  );

  // notification toggle (asks the browser for permission when turned on)
  $$("[data-notify]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.dataset.notify === "on") {
        const ok = await enableNotifications();
        settings.notifications = ok;
        if (ok) { toast("Alerts on — I'll flag big pressure swings"); maybeNotifyPressure(); }
      } else {
        settings.notifications = false;
        toast("Alerts off");
      }
      PS.store.saveSettings(settings);
      syncSegButtons();
    })
  );

  function syncSegButtons() {
    $$("[data-unit]").forEach((b) => b.classList.toggle("on", b.dataset.unit === settings.pressureUnit));
    $$("[data-tunit]").forEach((b) => b.classList.toggle("on", b.dataset.tunit === settings.tempUnit));
    $$("[data-notify]").forEach((b) => b.classList.toggle("on", (b.dataset.notify === "on") === !!settings.notifications));
  }

  function setLocation(loc) {
    settings.location = loc;
    PS.store.saveSettings(settings);
    $("#locationLabel").textContent = loc.name;
    loadWeather();
  }

  /* ---------- data load ---------- */
  async function loadWeather() {
    if (!settings.location) return;
    $("#trendText").textContent = "Loading…";
    const { latitude, longitude } = settings.location;

    // Air quality is a separate endpoint; fetch it alongside the weather and
    // don't let an air-quality hiccup block the main forecast.
    PS.weather.fetchAirQuality(latitude, longitude)
      .then((aq) => {
        airData = aq;
        renderAirQuality();
        renderSnapshot();
        const open = $$(".view").find((v) => !v.hidden);
        if (open && open.id === "view-forecast") buildSymptomWatch();
      })
      .catch(() => { airData = null; renderAirQuality(); });

    try {
      weatherData = await PS.weather.fetchWeather(latitude, longitude);
      renderNow();
      renderSnapshot();
      maybeNotifyPressure();
      // refresh whichever secondary view is open
      const open = $$(".view").find((v) => !v.hidden);
      if (open && open.id === "view-forecast") renderForecast();
      if (open && open.id === "view-trends") renderTrends();
    } catch (err) {
      $("#trendText").textContent = "Couldn't load weather";
      toast("Couldn't load weather — check connection");
    }
  }

  /* ---------- init ---------- */
  function init() {
    buildSevOptions();
    buildWizSymptoms();
    buildFoodChips();
    buildChecklist("#wizEnv", PS.config.envTriggers, "env");
    buildChecklist("#wizStress", PS.config.stressTriggers, "stress");
    renderLogList();
    syncSegButtons();

    if (settings.location) {
      $("#locationLabel").textContent = settings.location.name;
      loadWeather();
    } else {
      $("#locationLabel").textContent = "Set location";
      dialog.showModal();
      $("#alertBanner").hidden = false;
      $("#alertBanner").className = "alert-banner calm";
      $("#alertBanner").textContent = "👋 Welcome! Set your location to start tracking barometric pressure.";
    }

    // refresh weather every 15 min while open; redraw charts on resize/orientation
    setInterval(loadWeather, 15 * 60 * 1000);
    let rt;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        // Only redraw the visible view — a hidden canvas measures 0 and would
        // otherwise render at the wrong size.
        const open = $$(".view").find((v) => !v.hidden);
        if (!open) return;
        if (open.id === "view-now") renderNow();
        if (open.id === "view-forecast") renderForecast();
        if (open.id === "view-trends") renderTrends();
      }, 200);
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
      // When a new service worker takes over (after an update), reload once so
      // the user immediately gets the latest CSS/JS instead of stale cache.
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    }
  }

  init();
})();
