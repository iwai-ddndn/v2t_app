// オフラインでも画面を開けるようにアプリ本体をキャッシュ(API通信はキャッシュしない)
const CACHE = 'v2t-v1';
const ASSETS = ['./', 'index.html', 'bench.html', 'css/style.css', 'js/app.js', 'js/audio.js', 'js/util.js',
  'js/summary.js', 'js/cer.js', 'js/bench.js', 'js/engines/webspeech.js', 'js/engines/openai.js', 'js/engines/soniox.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  // ネット優先・失敗時キャッシュ(更新がすぐ反映されるように)
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
