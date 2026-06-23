/* Main controller: view routing, data loading, and rendering. */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let settings = PS.store.getSettings();
  let weatherData = null; // { current, series, tz }

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
    if (name === "log") renderLogList();
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

  /* ---------- FORECAST view ---------- */
  function renderForecast() {
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

  /* ---------- LOG view ---------- */
  function buildSymptomChips() {
    const wrap = $("#symptomChips");
    wrap.innerHTML = "";
    PS.config.symptoms.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = s;
      b.addEventListener("click", () => b.classList.toggle("on"));
      wrap.appendChild(b);
    });
  }

  const severityWords = ["none", "barely there", "mild", "mild", "moderate", "moderate",
    "noticeable", "strong", "strong", "severe", "severe"];
  $("#severity").addEventListener("input", (e) => {
    const v = +e.target.value;
    $("#severityOut").textContent = `${v} — ${severityWords[v]}`;
  });

  $("#logForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const severity = +$("#severity").value;
    const symptoms = $$("#symptomChips .chip.on").map((c) => c.textContent);
    const note = $("#note").value.trim();
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      severity,
      symptoms,
      note,
      pressure: pressureNow()
    };
    PS.store.addLog(entry);
    e.target.reset();
    $("#severityOut").textContent = "0 — none";
    $$("#symptomChips .chip.on").forEach((c) => c.classList.remove("on"));
    toast("Entry saved");
    renderLogList();
  });

  function renderLogList() {
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
      li.innerHTML = `
        <span class="sev-badge" style="background:${PS.charts.severityColor(l.severity)}">${l.severity}</span>
        <div class="log-meta">
          <div class="log-when">${when}</div>
          ${l.symptoms.length ? `<div class="log-sym">${l.symptoms.join(" · ")}</div>` : ""}
          ${l.note ? `<div class="log-note">${escapeHtml(l.note)}</div>` : ""}
          <div class="log-press">Pressure: ${press}</div>
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
    const header = "timestamp,severity,symptoms,pressure_hpa,note\n";
    const rows = logs.map((l) =>
      [l.ts, l.severity, `"${l.symptoms.join("; ")}"`,
       l.pressure != null ? l.pressure.toFixed(1) : "",
       `"${(l.note || "").replace(/"/g, '""')}"`].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pressuresense-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#logNowBtn").addEventListener("click", () => showView("log"));

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
    try {
      weatherData = await PS.weather.fetchWeather(
        settings.location.latitude,
        settings.location.longitude
      );
      renderNow();
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
    buildSymptomChips();
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
