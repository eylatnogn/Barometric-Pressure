/* Weather + geocoding via Open-Meteo (runs in the user's browser). */
window.PS = window.PS || {};

PS.weather = (() => {
  async function geocode(query) {
    const url = `${PS.config.geocodeBase}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Geocoding failed");
    const data = await res.json();
    return (data.results || []).map((r) => ({
      name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "),
      latitude: r.latitude,
      longitude: r.longitude
    }));
  }

  // Reverse geocode a coordinate to a friendly place name (best effort).
  async function reverseName(lat, lon) {
    try {
      const url = `${PS.config.geocodeBase}?latitude=${lat}&longitude=${lon}&count=1&language=en&format=json`;
      const res = await fetch(url);
      const data = await res.json();
      const r = (data.results || [])[0];
      if (r) return [r.name, r.admin1, r.country_code].filter(Boolean).join(", ");
    } catch {}
    return `My location (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
  }

  // Fetch past 24h + next 48h of hourly data plus current conditions.
  async function fetchWeather(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: "surface_pressure,pressure_msl,temperature_2m,relative_humidity_2m,weather_code",
      hourly: "pressure_msl,surface_pressure,temperature_2m,weather_code",
      past_days: "1",
      forecast_days: "3",
      timezone: "auto"
    });
    const res = await fetch(`${PS.config.weatherBase}?${params}`);
    if (!res.ok) throw new Error("Weather request failed");
    const data = await res.json();

    // Use sea-level pressure (pressure_msl) as the primary series — it removes
    // altitude bias and is what weather reports / "barometer" trackers use.
    const times = data.hourly.time.map((t) => new Date(t));
    const series = times.map((t, i) => ({
      t,
      pressure: data.hourly.pressure_msl[i],
      temp: data.hourly.temperature_2m[i],
      code: data.hourly.weather_code[i]
    })).filter((p) => p.pressure != null);

    return {
      current: {
        pressure: data.current.pressure_msl ?? data.current.surface_pressure,
        temp: data.current.temperature_2m,
        humidity: data.current.relative_humidity_2m,
        code: data.current.weather_code,
        time: new Date(data.current.time)
      },
      series,
      tz: data.timezone
    };
  }

  // Air quality (US AQI + key pollutants), current plus a short hourly outlook.
  async function fetchAirQuality(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: "us_aqi,pm2_5,pm10,ozone",
      hourly: "us_aqi",
      forecast_days: "2",
      timezone: "auto"
    });
    const res = await fetch(`${PS.config.airQualityBase}?${params}`);
    if (!res.ok) throw new Error("Air quality request failed");
    const data = await res.json();
    const hours = (data.hourly?.time || []).map((t, i) => ({
      t: new Date(t),
      aqi: data.hourly.us_aqi[i]
    })).filter((h) => h.aqi != null);
    return {
      current: {
        aqi: data.current?.us_aqi,
        pm25: data.current?.pm2_5,
        pm10: data.current?.pm10,
        ozone: data.current?.ozone
      },
      hours
    };
  }

  // Conditions for a chosen past moment, so a back-dated log carries the real
  // weather from that time (not today's). Open-Meteo's forecast endpoint serves
  // recent history (up to ~92 days) via start_date/end_date.
  function ymd(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function nearestIndex(times, targetMs) {
    let idx = 0, best = Infinity;
    times.forEach((t, i) => { const d = Math.abs(t.getTime() - targetMs); if (d < best) { best = d; idx = i; } });
    return idx;
  }

  async function fetchHistoricalSnapshot(lat, lon, when) {
    const dayBefore = new Date(when); dayBefore.setDate(dayBefore.getDate() - 1);
    const target = when.getTime();

    const wp = new URLSearchParams({
      latitude: lat, longitude: lon,
      hourly: "pressure_msl,temperature_2m,relative_humidity_2m,weather_code",
      start_date: ymd(dayBefore), end_date: ymd(when), timezone: "auto"
    });
    const wres = await fetch(`${PS.config.weatherBase}?${wp}`);
    if (!wres.ok) throw new Error("Historical weather request failed");
    const wd = await wres.json();
    const times = wd.hourly.time.map((t) => new Date(t));
    if (!times.length) return null;
    const i = nearestIndex(times, target);
    const snap = {
      pressure: wd.hourly.pressure_msl[i],
      temp: wd.hourly.temperature_2m[i],
      humidity: wd.hourly.relative_humidity_2m[i],
      code: wd.hourly.weather_code[i]
    };
    const j = nearestIndex(times, target - 6 * 3600 * 1000);
    if (snap.pressure != null && wd.hourly.pressure_msl[j] != null) {
      snap.trend6h = snap.pressure - wd.hourly.pressure_msl[j];
    }

    // Air quality for that hour — best effort; never block the weather snapshot.
    try {
      const ap = new URLSearchParams({
        latitude: lat, longitude: lon, hourly: "us_aqi",
        start_date: ymd(when), end_date: ymd(when), timezone: "auto"
      });
      const ares = await fetch(`${PS.config.airQualityBase}?${ap}`);
      if (ares.ok) {
        const ad = await ares.json();
        const at = (ad.hourly?.time || []).map((t) => new Date(t));
        if (at.length) {
          const k = nearestIndex(at, target);
          if (ad.hourly.us_aqi[k] != null) snap.aqi = ad.hourly.us_aqi[k];
        }
      }
    } catch {}
    return snap;
  }

  return { geocode, reverseName, fetchWeather, fetchAirQuality, fetchHistoricalSnapshot };
})();
