/* All persistence lives in localStorage so the app works offline and keeps
   the user's health data on their own device (nothing is sent to a server). */
window.PS = window.PS || {};

PS.store = (() => {
  const KEYS = { settings: "ps.settings", logs: "ps.logs" };

  const defaults = {
    settings: {
      location: null,        // { name, latitude, longitude }
      pressureUnit: "hPa",   // or "inHg"
      tempUnit: "C"          // or "F"
    },
    logs: []                 // [{ id, ts, severity, symptoms[], note, pressure }]
  };

  function read(key) {
    try {
      const raw = localStorage.getItem(KEYS[key]);
      return raw ? JSON.parse(raw) : structuredClone(defaults[key]);
    } catch {
      return structuredClone(defaults[key]);
    }
  }
  function write(key, val) {
    try { localStorage.setItem(KEYS[key], JSON.stringify(val)); } catch {}
  }

  return {
    getSettings: () => ({ ...defaults.settings, ...read("settings") }),
    saveSettings: (s) => write("settings", s),

    getLogs: () => read("logs"),
    addLog: (entry) => {
      const logs = read("logs");
      logs.unshift(entry);
      write("logs", logs);
      return logs;
    },
    deleteLog: (id) => {
      const logs = read("logs").filter((l) => l.id !== id);
      write("logs", logs);
      return logs;
    }
  };
})();
