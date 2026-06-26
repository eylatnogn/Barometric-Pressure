/* All persistence lives in localStorage so the app works offline and keeps
   the user's health data on their own device (nothing is sent to a server). */
window.PS = window.PS || {};

PS.store = (() => {
  const KEYS = { settings: "ps.settings", logs: "ps.logs" };

  const defaults = {
    settings: {
      location: null,        // { name, latitude, longitude }
      pressureUnit: "hPa",   // or "inHg"
      tempUnit: "C",         // or "F"
      notifications: false   // pressure-change alerts opt-in
    },
    logs: []                 // [{ id, ts, severity, symptoms[], note, pressure, ... }]
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
  const byNewest = (a, b) => new Date(b.ts) - new Date(a.ts);

  return {
    getSettings: () => ({ ...defaults.settings, ...read("settings") }),
    saveSettings: (s) => write("settings", s),

    getLogs: () => read("logs"),
    addLog: (entry) => {
      const logs = read("logs");
      logs.push(entry);
      logs.sort(byNewest);     // keep chronological even for back-dated entries
      write("logs", logs);
      return logs;
    },
    updateLog: (id, patch) => {
      const logs = read("logs").map((l) => (l.id === id ? { ...l, ...patch, id } : l));
      logs.sort(byNewest);
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
