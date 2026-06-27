/* App-wide constants and small shared helpers. */
window.PS = window.PS || {};

PS.config = {
  // Open-Meteo: free, no API key needed for non-commercial use.
  weatherBase: "https://api.open-meteo.com/v1/forecast",
  geocodeBase: "https://geocoding-api.open-meteo.com/v1/search",
  airQualityBase: "https://air-quality-api.open-meteo.com/v1/air-quality",

  // A pressure change at/above this rate (hPa over the window) is worth a heads-up.
  // Vestibular/migraine sensitivity is commonly linked to swings of ~5-6 hPa.
  alertDrop6h: -4,   // falling pressure tends to trigger symptoms most
  alertRise6h: 5,
  watchChange24h: 8,

  symptoms: [
    "Dizziness", "Vertigo", "Headache", "Migraine", "Nausea",
    "Ear pressure", "Brain fog", "Fatigue", "Imbalance", "Neck tension"
  ],

  // Common trigger-food categories — high-histamine foods, histamine liberators,
  // and the major food allergens. Tracking these helps surface food patterns
  // alongside the weather ones.
  foodTriggers: [
    "Aged cheese", "Fermented foods", "Alcohol / wine", "Cured / smoked meat",
    "Fish / shellfish", "Tomatoes", "Citrus", "Chocolate", "Vinegar / pickled",
    "Leftovers", "Dairy", "Gluten / wheat", "Eggs", "Caffeine",
    "Peanuts", "Tree nuts", "Soy", "Sesame", "Nightshades", "Processed / MSG"
  ],

  // Airborne / nasal allergens and environmental exposures.
  envTriggers: [
    "High pollen", "Dust", "Pet dander", "Mold", "Smoke",
    "Strong fragrance / perfume", "Cleaning chemicals", "Pollution / smog",
    "Fresh-cut grass / hay", "New paint / fumes"
  ],

  // Stress and strain factors that commonly aggravate symptoms.
  stressTriggers: [
    "Work stress", "Emotional stress", "Physical exertion", "Overstimulation",
    "Eye / screen strain", "Poor sleep", "Bright light / glare", "Loud noise",
    "Dehydration", "Skipped meal"
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

// US Air Quality Index categories. Returns label, a CSS color var, and a short
// note geared toward people sensitive to environmental triggers.
PS.aqiCategory = (aqi) => {
  if (aqi == null || isNaN(aqi)) return { label: "—", color: "var(--text-dim)", note: "" };
  if (aqi <= 50)  return { label: "Good", color: "var(--good)", note: "Air quality is clean — unlikely to add to symptoms." };
  if (aqi <= 100) return { label: "Moderate", color: "var(--warn)", note: "Usually fine, but very sensitive people may notice mild effects." };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", color: "#e8731a", note: "May worsen headaches, fatigue, or sinus/respiratory symptoms." };
  if (aqi <= 200) return { label: "Unhealthy", color: "var(--bad)", note: "Can trigger headaches, dizziness, and fatigue — limit time outdoors." };
  if (aqi <= 300) return { label: "Very unhealthy", color: "#8e44ad", note: "Strong trigger potential — stay indoors with filtered air if you can." };
  return { label: "Hazardous", color: "#7e2222", note: "Avoid outdoor exposure; symptoms are likely for sensitive people." };
};
