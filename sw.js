// Offline support for Pawmodoro. Pages load from the network first so updates show up right away,
// and fall back to the cached copy when you're offline.
const CACHE = 'pawmodoro-v2';
const ASSETS = ['./', './index.html', './palettes.css', './app/', './app/index.html', './app/app.js', './manifest.webmanifest', './icons/favicon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const keep = (res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then((r) => r || caches.match('./app/'))));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then(keep)));
  }
});
