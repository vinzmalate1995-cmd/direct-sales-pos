/**
 * AE HOME POS SYSTEM - SERVICE WORKER (sw.js)
 * Nagbibigay ng Offline Capabilities at Mabilis na Caching para sa PWA.
 */

const CACHE_NAME = "ae-home-pos-v1";

// Listahan ng mga local files at external libraries na kailangang i-cache para gumana offline
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./app.js",
  "./style.css",
  "./manifest.json",
  "./assets/img/no-image.png",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js",
  "https://unpkg.com/html5-qrcode",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"
];

// 1. INSTALL EVENT: I-save ang mga core files sa Cache Storage
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching all core assets...");
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting()) // Agid na i-activate ang bagong SW
  );
});

// 2. ACTIVATE EVENT: Linisin ang mga lumang bersyon ng cache kung may update
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("[Service Worker] Clearing old cache:", cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. FETCH EVENT: Intercept ang network requests
// "Network First, Fallback to Cache" strategy para sa Apps Script Requests, at "Cache First" naman para sa Static UI Elements.
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  // KUNG ANG REQUEST AY PARA SA GOOGLE APPS SCRIPT (DATABASE)
  // Palaging subukang kumuha sa Internet muna para updated ang benta/imbentaryo. Kung offline, mag-fallback sa cache.
  if (requestUrl.href.includes("script.google.com")) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          console.log("[Service Worker] Device is offline. Serving database response from cache fallback if available.");
          return caches.match(event.request);
        })
    );
    return;
  }

  // KUNG ANG REQUEST AY PARA SA STATIC UI ASSETS (HTML, CSS, JS, LIBRARIES)
  // Kumuha sa cache para mabilis mag-load ang app, sabay tingnan kung may bago sa internet.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Mag-fire ng background fetch para i-update ang cache kung sakaling may binago sa server
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => { /* Tahimik lang kung offline */ });

        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
