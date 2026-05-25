// SMARTGuard service worker – V26
// FONTOS: a kód-fájlokra (html/css/js) NETWORK-FIRST, hogy a frissítések
// azonnal látszódjanak és ne ragadjon be a régi app.js a cache-ből.
const cacheName = "smartguard-mvp-v4";
const assets = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  self.skipWaiting(); // az új SW azonnal lépjen életbe
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()) // azonnal vegye át az irányítást a nyitott fülök felett
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isCode = /\.(html|css|js|webmanifest)$/.test(url.pathname) ||
                 url.pathname.endsWith("/") || req.mode === "navigate";

  if (isCode) {
    // NETWORK-FIRST: mindig friss kódot próbál, csak offline esik vissza cache-re
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
  } else {
    // egyéb (képek, betűk): CACHE-FIRST a gyorsaságért
    event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
  }
});
