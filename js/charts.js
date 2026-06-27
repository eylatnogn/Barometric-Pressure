/* Tiny dependency-free canvas charts, tuned for the pressure data we plot. */
window.PS = window.PS || {};

PS.charts = (() => {
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    // Drive the backing store from the element's CSS-laid-out size (a square,
    // via `aspect-ratio: 1/1`). Reading the rendered size — not canvas.height —
    // is what keeps redraws from compounding the dimensions on every call.
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || canvas.parentElement.clientWidth));
    const h = Math.max(1, Math.round(rect.height || w));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    // setTransform (not scale) resets the matrix each time, so DPR never stacks.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function niceBounds(values) {
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.15;
    return { min: min - pad, max: max + pad };
  }

  // Line chart of pressure with an optional "now" marker and severity dots.
  function pressureLine(canvas, points, opts = {}) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!points.length) return;

    const padL = 42, padR = 12, padT = 14, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const pressures = points.map((p) => p.pressure);
    const { min, max } = niceBounds(pressures);
    const t0 = points[0].t.getTime();
    const t1 = points[points.length - 1].t.getTime();
    const span = t1 - t0 || 1;

    const x = (t) => padL + ((t - t0) / span) * plotW;
    const y = (v) => padT + (1 - (v - min) / (max - min)) * plotH;

    const lineColor = css("--accent");
    const gridColor = css("--line");
    const dimColor = css("--text-dim");

    // horizontal grid + labels
    ctx.font = "11px -apple-system, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = dimColor;
    const ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const v = min + ((max - min) * i) / ticks;
      const yy = y(v);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      const label = opts.unit === "inHg" ? PS.toInHg(v).toFixed(2) : Math.round(v);
      ctx.textAlign = "right";
      ctx.fillText(label, padL - 6, yy);
    }

    // x labels (day/time)
    ctx.textAlign = "center";
    const labelCount = Math.min(4, points.length);
    for (let i = 0; i < labelCount; i++) {
      const p = points[Math.round((i * (points.length - 1)) / (labelCount - 1))];
      const lab = p.t.toLocaleTimeString([], { weekday: "short", hour: "numeric" });
      ctx.fillText(lab, x(p.t.getTime()), h - 8);
    }

    // "now" vertical marker
    if (opts.nowTime) {
      const nx = x(opts.nowTime.getTime());
      if (nx >= padL && nx <= w - padR) {
        ctx.strokeStyle = dimColor;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(nx, padT); ctx.lineTo(nx, h - padB); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // area fill
    const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
    grad.addColorStop(0, lineColor + "55");
    grad.addColorStop(1, lineColor + "00");
    ctx.beginPath();
    points.forEach((p, i) => {
      const xx = x(p.t.getTime()), yy = y(p.pressure);
      i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    });
    ctx.lineTo(x(t1), h - padB);
    ctx.lineTo(x(t0), h - padB);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const xx = x(p.t.getTime()), yy = y(p.pressure);
      i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // severity dots overlaid (opts.markers: [{t, severity}])
    if (opts.markers) {
      opts.markers.forEach((m) => {
        const mt = m.t.getTime();
        if (mt < t0 || mt > t1) return;
        // place dot on the line at that time
        const xx = x(mt);
        const yy = y(interpAt(points, mt));
        const r = 4 + m.severity * 0.8;
        ctx.beginPath();
        ctx.arc(xx, yy, r, 0, Math.PI * 2);
        ctx.fillStyle = severityColor(m.severity);
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    }
  }

  function interpAt(points, t) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const ta = a.t.getTime(), tb = b.t.getTime();
      if (t >= ta && t <= tb) {
        const f = (t - ta) / (tb - ta || 1);
        return a.pressure + (b.pressure - a.pressure) * f;
      }
    }
    return points[points.length - 1].pressure;
  }

  function severityColor(sev) {
    if (sev >= 7) return css("--bad");
    if (sev >= 4) return css("--warn");
    if (sev >= 1) return css("--good");
    return css("--text-dim");
  }

  // Timeline of the user's ACTUAL logged entries across their whole date range:
  // each entry's severity as a lollipop (left axis, 0-10, colored by severity)
  // with the pressure recorded at each entry drawn as a line (right axis).
  // entries: [{ t: Date, severity: number, pressure: number|null }] (sorted asc)
  function logTimeline(canvas, entries, opts = {}) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const dim = css("--text-dim"), grid = css("--line"), accent = css("--accent");

    ctx.textBaseline = "middle";
    if (!entries.length) {
      ctx.fillStyle = dim; ctx.font = "13px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Log entries to see them charted here.", w / 2, h / 2);
      return;
    }

    const padL = 30, padR = 46, padT = 24, padB = 26;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    let t0 = entries[0].t.getTime(), t1 = entries[entries.length - 1].t.getTime();
    if (t0 === t1) { t0 -= 6 * 3600e3; t1 += 6 * 3600e3; }
    const span = t1 - t0;
    const X = (t) => padL + ((t - t0) / span) * plotW;
    const Ys = (v) => padT + (1 - v / 10) * plotH;       // severity axis (left)

    const press = entries.filter((e) => e.pressure != null);
    let pmin, pmax, Yp = null;
    if (press.length) {
      const b = niceBounds(press.map((e) => e.pressure));
      pmin = b.min; pmax = b.max;
      Yp = (v) => padT + (1 - (v - pmin) / (pmax - pmin)) * plotH;
    }

    // grid + left severity labels
    ctx.font = "11px system-ui, sans-serif";
    [0, 5, 10].forEach((v) => {
      const yy = Ys(v);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillStyle = dim; ctx.textAlign = "right"; ctx.fillText(String(v), padL - 5, yy);
    });
    // right pressure labels
    if (Yp) {
      ctx.textAlign = "left"; ctx.fillStyle = accent;
      [pmax, (pmin + pmax) / 2, pmin].forEach((v) => {
        const lab = opts.unit === "inHg" ? PS.toInHg(v).toFixed(2) : String(Math.round(v));
        ctx.fillText(lab, w - padR + 5, Yp(v));
      });
    }

    // pressure line (right axis)
    if (Yp) {
      ctx.beginPath();
      press.forEach((e, i) => { const xx = X(e.t.getTime()), yy = Yp(e.pressure); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
      press.forEach((e) => { ctx.beginPath(); ctx.arc(X(e.t.getTime()), Yp(e.pressure), 2, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill(); });
    }

    // severity lollipops (left axis)
    const baseY = Ys(0);
    entries.forEach((e) => {
      const xx = X(e.t.getTime()), yy = Ys(e.severity);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xx, baseY); ctx.lineTo(xx, yy); ctx.stroke();
      ctx.beginPath(); ctx.arc(xx, yy, 3 + e.severity * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = severityColor(e.severity); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = css("--card"); ctx.stroke();
    });

    // x date labels
    ctx.fillStyle = dim; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    const n = Math.min(4, Math.max(2, entries.length));
    for (let i = 0; i < n; i++) {
      const tt = t0 + (span * i) / (n - 1);
      ctx.fillText(new Date(tt).toLocaleDateString([], { month: "short", day: "numeric" }), X(tt), h - 8);
    }

    // legend
    ctx.textBaseline = "middle"; ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = severityColor(6); ctx.beginPath(); ctx.arc(padL + 4, 11, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dim; ctx.textAlign = "left"; ctx.fillText("Severity", padL + 12, 11);
    if (Yp) {
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(padL + 66, 11); ctx.lineTo(padL + 82, 11); ctx.stroke();
      ctx.fillStyle = dim; ctx.fillText("Pressure", padL + 88, 11);
    }
  }

  return { pressureLine, severityColor, logTimeline };
})();
