/* Resgro Operating App — service worker.
   Network-first for same-origin requests so every deploy shows up immediately;
   the cache is only a fallback for offline opens. Cross-origin requests
   (Supabase, esm.sh, Google Fonts, the Anthropic API) are never intercepted. */
const V = 'resgro-v1';
const CORE = [
  './',
  './index.html',
  './p1-model.html',
  './iroko-calculator.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(V).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never touch API/CDN traffic
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then(
          (r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())
        )
      )
  );
});
