/* Offline support with a NETWORK-FIRST strategy: always try the live file so a
   stale or broken cache can never brick the app; fall back to cache only when
   offline. Weather API requests bypass the cache entirely. */
const CACHE = "pressuresense-v17";
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/storage.js",
  "./js/weather.js",
  "./js/charts.js",
  "./js/report.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./docs/PressureSense-Guide.html"
];

self.addEventListener("install", (e) => {
  // Cache files individually so one failure can't abort the whole install.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;
  // Weather/air API: always straight to network.
  if (url.hostname.endsWith("open-meteo.com")) return;
  // Only manage our own origin.
  if (url.origin !== self.location.origin) return;

  // Network-first: fetch fresh, update the cache, fall back to cache offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});

// Tapping a pressure-change alert focuses (or opens) the app.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((cs) => {
      for (const c of cs) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
