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

  return { pressureLine, severityColor };
})();
