/* App-wide constants and small shared helpers. */
window.PS = window.PS || {};

PS.config = {
  // Open-Meteo: free, no API key needed for non-commercial use.
  weatherBase: "https://api.open-meteo.com/v1/forecast",
  geocodeBase: "https://geocoding-api.open-meteo.com/v1/search",

  // A pressure change at/above this rate (hPa over the window) is worth a heads-up.
  // Vestibular/migraine sensitivity is commonly linked to swings of ~5-6 hPa.
  alertDrop6h: -4,   // falling pressure tends to trigger symptoms most
  alertRise6h: 5,
  watchChange24h: 8,

  symptoms: [
    "Dizziness", "Vertigo", "Headache", "Migraine", "Nausea",
    "Ear pressure", "Brain fog", "Fatigue", "Imbalance", "Neck tension"
  ],

  weatherCodes: {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Rain showers", 81: "Rain showers", 82: "Violent showers",
    85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Severe thunderstorm"
  }
};

// hPa <-> inHg conversion (1 hPa = 0.0295299831 inHg)
PS.toInHg = (hpa) => hpa * 0.0295299831;
PS.fmtPressure = (hpa, unit) =>
  unit === "inHg" ? PS.toInHg(hpa).toFixed(2) : Math.round(hpa).toString();
PS.fmtPressureDelta = (hpaDelta, unit) => {
  const v = unit === "inHg" ? PS.toInHg(hpaDelta) : hpaDelta;
  const sign = v > 0 ? "+" : "";
  return `${sign}${unit === "inHg" ? v.toFixed(2) : v.toFixed(1)}`;
};
PS.toF = (c) => (c * 9) / 5 + 32;
PS.fmtTemp = (c, unit) => (unit === "F" ? `${Math.round(PS.toF(c))}°F` : `${Math.round(c)}°C`);
