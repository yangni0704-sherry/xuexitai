// 学习台 app 空壳的 SW（SPEC-v0.5.1-webapp §2.8）：缓存优先，只管同源、作用域内的请求。
// VERSION 由 rtv-ucilnica/scripts/webapp-stamp.mjs 写。
const VERSION = 'e294557590';
const PREFIX = 'xuexitai-shell-';
const CACHE = PREFIX + VERSION;
const ASSETS = ['./', 'index.html', 'shell.css', 'shell.js', 'shell-core.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];
const SCOPE = self.registration.scope;
const SELF = new URL('sw.js', SCOPE).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  const old = (keys) => keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE);
  e.waitUntil(caches.keys().then((keys) => Promise.all(old(keys).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const href = url.origin + url.pathname;
  if (url.origin !== self.location.origin || !href.startsWith(SCOPE) || href === SELF) return;
  const nav = req.mode === 'navigate';
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(nav ? './' : req, { ignoreSearch: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (!nav && res.ok && res.type === 'basic') c.put(req, res.clone()).catch(() => {});
            return res;
          }),
      ),
    ),
  );
});
