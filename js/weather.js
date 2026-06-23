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

  return { geocode, reverseName, fetchWeather };
})();
