// Service worker for the Star Map PWA — registered with scope "./", so it only
// ever controls /starmap/ and never touches the main Deep Time site.
//
// Strategy: cache-first. The app shell is pre-cached on install; the unpkg CDN
// runtime (React/ReactDOM/Babel that support.js loads) is cached on first fetch.
// After one online visit the map works fully offline at a dark site.
//
// NOTE while developing: cached files win over edited ones — bump CACHE_VERSION
// (or DevTools → Application → Service Workers → Update/Unregister) to pick up changes.
const CACHE_VERSION = "starmap-v3";
const SHELL = [
  "./",
  "./index.html",
  "./support.js",
  "./astro.js",
  "./skydata.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isCdn = url.hostname === "unpkg.com";
  if (e.request.method !== "GET" || (!isCdn && url.origin !== location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});
