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

  /* ---------- FORECAST view ---------- */
  // Build a plain-language "what this could mean for you" list from current and
  // forecasted conditions. Each item: { level, icon, title, text, symptoms[] }.
  function buildSymptomWatch() {
    const box = $("#symptomWatch");
    if (!weatherData) { box.innerHTML = '<p class="empty">Set your location to see guidance.</p>'; return; }

    const cur = pressureNow();
    const items = [];

    // Pressure swings over the next 24h (the main vestibular trigger).
    let maxDrop = 0, maxRise = 0;
    for (const h of [3, 6, 9, 12, 18, 24]) {
      const p = pressureAtOffset(h);
      if (p == null) continue;
      maxDrop = Math.min(maxDrop, p - cur);
      maxRise = Math.max(maxRise, p - cur);
    }
    if (maxDrop <= -3) {
      items.push({ level: "bad", icon: "📉", title: "Pressure dropping ahead",
        text: `Up to ${PS.fmtPressureDelta(maxDrop, settings.pressureUnit)} ${settings.pressureUnit} over the next day. Falling pressure is the most common trigger.`,
        symptoms: ["Dizziness", "Vertigo", "Migraine", "Ear pressure"] });
    } else if (maxRise >= 4) {
      items.push({ level: "warn", icon: "📈", title: "Pressure rising ahead",
        text: `Up to +${PS.fmtPressureDelta(maxRise, settings.pressureUnit).replace("+","")} ${settings.pressureUnit} over the next day. Rapid changes either direction can be felt.`,
        symptoms: ["Headache", "Sinus pressure", "Fatigue"] });
    }

    // Absolute low pressure.
    if (cur < 1005) {
      items.push({ level: "warn", icon: "🌧️", title: "Low pressure system",
        text: "Pressure is on the low side, often with unsettled or stormy weather.",
        symptoms: ["Joint aches", "Headache", "Low energy"] });
    }

    // Humidity (from current conditions).
    const hum = weatherData.current.humidity;
    if (hum >= 80) {
      items.push({ level: "warn", icon: "💧", title: "High humidity",
        text: `Humidity around ${Math.round(hum)}%. Muggy air can add to that heavy, off-balance feeling.`,
        symptoms: ["Dizziness", "Fatigue", "Breathlessness"] });
    } else if (hum <= 30) {
      items.push({ level: "warn", icon: "🏜️", title: "Very dry air",
        text: `Humidity around ${Math.round(hum)}%. Dry air can irritate sinuses and airways.`,
        symptoms: ["Dry sinuses", "Headache"] });
    }

    // Temperature swing over the next 24h.
    const temps = weatherData.series
      .filter((p) => p.t.getTime() >= Date.now() && p.t.getTime() <= Date.now() + 24 * 3600000)
      .map((p) => p.temp).filter((t) => t != null);
    if (temps.length) {
      const swing = Math.max(...temps) - Math.min(...temps);
      if (swing >= 12) {
        items.push({ level: "warn", icon: "🌡️", title: "Big temperature swing",
          text: `About ${Math.round(swing)}°C between the day's high and low. Sharp temperature changes can set off symptoms.`,
          symptoms: ["Headache", "Fatigue"] });
      }
    }

    // Air quality.
    const aqi = airData && airData.current ? airData.current.aqi : null;
    if (aqi != null && aqi > 100) {
      const cat = PS.aqiCategory(aqi);
      items.push({ level: aqi > 150 ? "bad" : "warn", icon: "🌫️", title: `Air quality: ${cat.label} (AQI ${Math.round(aqi)})`,
        text: cat.note, symptoms: ["Headache", "Fatigue", "Throat/eye irritation"] });
    }

    if (!items.length) {
      box.innerHTML =
        '<div class="watch-item good"><span class="watch-icon">🌤️</span><div class="watch-body">' +
        '<div class="watch-title">Conditions look calm</div>' +
        '<div class="watch-text">No major pressure swings, humidity, temperature, or air-quality triggers in the next day. A good window if you\'re sensitive.</div>' +
        '</div></div>';
      return;
    }

    box.innerHTML = items.map((it) => `
      <div class="watch-item ${it.level}">
        <span class="watch-icon" aria-hidden="true">${it.icon}</span>
        <div class="watch-body">
          <div class="watch-title">${it.title}</div>
          <div class="watch-text">${it.text}</div>
          <div class="watch-sym">Possible: <b>${it.symptoms.join(", ")}</b></div>
        </div>
      </div>`).join("");
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
      const when = b.start.toLocaleString([], { weekday: "short", hour: "numeric" });
      let desc, color;
      if (b.delta <= -3) { desc = "Notable drop — possible trigger"; color = "var(--bad)"; }
      else if (b.delta <= -1.5) { desc = "Gentle fall"; color = "var(--warn)"; }
      else if (b.delta >= 3) { desc = "Sharp rise"; color = "var(--warn)"; }
      else if (b.delta >= 1.5) { desc = "Gentle rise"; color = "var(--warn)"; }
      else { desc = "Steady — calm window"; color = "var(--good)"; }
      row.innerHTML = `
        <span class="when">${when}</span>
        <span class="desc">${desc}</span>
        <span class="delta" style="color:${color}">${PS.fmtPressureDelta(b.delta, settings.pressureUnit)}</span>`;
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

  function saveEntry(severity, symptoms, note, when, snapshot) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: (when || new Date()).toISOString(),
      severity, symptoms, note,
      ...(snapshot || currentSnapshot())
    };
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

  const wiz = { step: 0, severity: null, symptoms: new Set(), steps: 3,
    when: new Date(), snapshot: null, loading: false };

  function buildSevOptions() {
    const wrap = $("#wizSeverity");
    wrap.innerHTML = "";
    SEV_LEVELS.forEach((lvl) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sev-opt";
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
      b.innerHTML = `<span class="box" aria-hidden="true">✓</span><span>${s}</span>`;
      b.addEventListener("click", () => {
        if (wiz.symptoms.has(s)) wiz.symptoms.delete(s); else wiz.symptoms.add(s);
        b.classList.toggle("on", wiz.symptoms.has(s));
      });
      wrap.appendChild(b);
    });
  }

  function openWizard() {
    wiz.step = 0; wiz.severity = null; wiz.symptoms.clear();
    wiz.when = new Date(); wiz.snapshot = currentSnapshot(); wiz.loading = false;
    $("#wizNote").value = "";
    $$("#wizSeverity .sev-opt").forEach((o) => { o.classList.remove("on"); o.setAttribute("aria-checked", "false"); });
    $$("#wizSymptoms .check-item").forEach((o) => o.classList.remove("on"));
    const now = new Date();
    const win = $("#wizWhen");
    win.max = toLocalInput(now);
    win.min = toLocalInput(new Date(now.getTime() - 91 * 864e5)); // Open-Meteo history limit
    win.value = toLocalInput(now);
    renderWizSnapshot();
    $("#logWizard").hidden = false;
    document.body.style.overflow = "hidden";
    wizGoto(0);
  }

  // When the user changes the date/time, load the conditions for that moment.
  async function onWizWhenChange() {
    const val = $("#wizWhen").value;
    if (!val) return;
    let when = new Date(val);
    const now = new Date();
    if (when > now) { when = now; $("#wizWhen").value = toLocalInput(now); }
    wiz.when = when;

    // Within the last hour → "now": use the already-loaded live conditions.
    if (now.getTime() - when.getTime() < 3600 * 1000) {
      wiz.snapshot = currentSnapshot();
      renderWizSnapshot();
      return;
    }
    if (!settings.location) { wiz.snapshot = {}; renderWizSnapshot(); return; }
    wiz.loading = true; renderWizSnapshot();
    try {
      wiz.snapshot = await PS.weather.fetchHistoricalSnapshot(
        settings.location.latitude, settings.location.longitude, when) || {};
    } catch {
      wiz.snapshot = {};
      toast("Couldn't load conditions for that time");
    }
    wiz.loading = false;
    renderWizSnapshot();
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
    $("#wizNext").textContent = wiz.step === wiz.steps - 1 ? "Save entry" : "Next";
    $(".wizard-body").scrollTop = 0;
  }

  function wizNext() {
    if (wiz.step === 0 && wiz.severity == null) { toast("Pick how you're feeling"); return; }
    if (wiz.step === wiz.steps - 1) {
      const sev = wiz.severity, syms = [...wiz.symptoms];
      saveEntry(sev, syms, $("#wizNote").value.trim(), wiz.when, wiz.snapshot);
      closeWizard();
      renderSnapshot();
      const backdated = Date.now() - wiz.when.getTime() > 3600 * 1000;
      toast(backdated ? "Back-dated entry saved" : (sev === 0 && syms.length === 0 ? "Logged a good moment ✓" : "Entry saved"));
      return;
    }
    wizGoto(wiz.step + 1);
  }

  $("#startLogBtn").addEventListener("click", openWizard);
  $("#wizClose").addEventListener("click", closeWizard);
  $("#wizBack").addEventListener("click", () => wizGoto(wiz.step - 1));
  $("#wizNext").addEventListener("click", wizNext);
  $("#wizWhen").addEventListener("change", onWizWhenChange);

  // Quick "feeling good" — one-tap zero-severity entry (for right now).
  $("#quickGoodBtn").addEventListener("click", () => {
    saveEntry(0, [], "Feeling good", new Date(), currentSnapshot());
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
        </div>
        <button class="del-btn" aria-label="Delete entry" data-id="${l.id}">✕</button>`;
      list.appendChild(li);
    });
    $$("#logList .del-btn").forEach((b) =>
      b.addEventListener("click", () => {
        PS.store.deleteLog(b.dataset.id);
        renderLogList();
        toast("Entry deleted");
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
    const header = "timestamp,severity,symptoms,pressure_hpa,pressure_change_6h,temp_c,humidity_pct,us_aqi,note\n";
    const rows = logs.map((l) =>
      [l.ts, l.severity, `"${l.symptoms.join("; ")}"`,
       l.pressure != null ? l.pressure.toFixed(1) : "",
       l.trend6h != null ? l.trend6h.toFixed(1) : "",
       l.temp != null ? l.temp.toFixed(1) : "",
       l.humidity != null ? Math.round(l.humidity) : "",
       l.aqi != null ? Math.round(l.aqi) : "",
       `"${(l.note || "").replace(/"/g, '""')}"`].join(",")
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
    const insight = $("#insightCard");

    if (weatherData) {
      const past = weatherData.series.filter((p) => p.t.getTime() <= Date.now()).slice(-48);
      const markers = logs
        .map((l) => ({ t: new Date(l.ts), severity: l.severity }))
        .filter((m) => past.length && m.t.getTime() >= past[0].t.getTime());
      PS.charts.pressureLine($("#chartTrends"), past, {
        unit: settings.pressureUnit,
        nowTime: weatherData.current.time,
        markers
      });
    }

    insight.innerHTML = computeInsight(logs);
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
    const topSym = countSymptoms(logs);
    if (topSym) lines.push(`Most logged symptom: <strong>${topSym}</strong>.`);
    lines.push(`<span class="muted">This is a personal trend summary, not medical advice.
      Share your exported log with your clinician.</span>`);
    return lines.map((l) => `<p>${l}</p>`).join("");
  }

  function countSymptoms(logs) {
    const counts = {};
    logs.forEach((l) => l.symptoms.forEach((s) => (counts[s] = (counts[s] || 0) + 1)));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
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
  function syncSegButtons() {
    $$("[data-unit]").forEach((b) => b.classList.toggle("on", b.dataset.unit === settings.pressureUnit));
    $$("[data-tunit]").forEach((b) => b.classList.toggle("on", b.dataset.tunit === settings.tempUnit));
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
