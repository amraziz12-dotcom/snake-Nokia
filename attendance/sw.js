/* Service Worker — يجعل التطبيق يعمل كتطبيق موبايل ويفتح بدون إنترنت */
const CACHE = 'attendance-v1';
const SHELL = [
  './', './index.html', './admin.html', './styles.css', './app.js', './admin.js',
  './common.js', './config.js', './employees.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // طلبات الخادم (POST) لا تُخزَّن
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    // الخطوط من Google: من الكاش أولاً
    if (url.hostname.includes('fonts.')) {
      e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
      }).catch(() => r)));
    }
    return;
  }
  // ملفات التطبيق: الشبكة أولاً (للتحديثات) ثم الكاش عند انقطاع الإنترنت
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
