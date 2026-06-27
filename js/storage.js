/* All persistence lives in localStorage so the app works offline and keeps
   the user's health data on their own device (nothing is sent to a server). */
window.PS = window.PS || {};

PS.store = (() => {
  const KEYS = { settings: "ps.settings", logs: "ps.logs", trash: "ps.trash" };
  const TRASH_TTL = 30 * 864e5; // deleted entries are recoverable for 30 days

  const defaults = {
    settings: {
      location: null,        // { name, latitude, longitude }
      pressureUnit: "hPa",   // or "inHg"
      tempUnit: "C",         // or "F"
      notifications: false   // pressure-change alerts opt-in
    },
    logs: [],                // [{ id, ts, severity, symptoms[], note, pressure, ... }]
    trash: []                // soft-deleted entries: [{ ...entry, deletedAt }]
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
    // Soft delete: move the entry to trash (recoverable for 30 days).
    deleteLog: (id) => {
      const logs = read("logs");
      const entry = logs.find((l) => l.id === id);
      const remaining = logs.filter((l) => l.id !== id);
      write("logs", remaining);
      if (entry) {
        const trash = pruneTrash(read("trash"));
        trash.push({ ...entry, deletedAt: new Date().toISOString() });
        write("trash", trash);
      }
      return remaining;
    },

    // Trash, with anything past its 30-day window pruned on read.
    getTrash: () => {
      const trash = read("trash");
      const kept = pruneTrash(trash);
      if (kept.length !== trash.length) write("trash", kept);
      return kept.slice().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    },
    trashTtlDays: () => 30,
    restoreLog: (id) => {
      const trash = read("trash");
      const entry = trash.find((l) => l.id === id);
      write("trash", trash.filter((l) => l.id !== id));
      if (entry) {
        const { deletedAt, ...clean } = entry;
        const logs = read("logs");
        logs.push(clean);
        logs.sort(byNewest);
        write("logs", logs);
      }
      return entry || null;
    },
    purgeLog: (id) => {
      write("trash", read("trash").filter((l) => l.id !== id));
    }
  };

  // Drop trash entries older than the retention window.
  function pruneTrash(trash) {
    const cutoff = Date.now() - TRASH_TTL;
    return trash.filter((l) => {
      const d = new Date(l.deletedAt).getTime();
      return isNaN(d) || d >= cutoff;
    });
  }
})();
