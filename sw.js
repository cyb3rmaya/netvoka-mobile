const C = 'netvoka-shell-v2', A = 'netvoka-audio-v1';
const FILES = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './PretendardVariable.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C && k !== A).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const isAudio = u => u.hostname === 'api.dictionaryapi.dev' && u.pathname.startsWith('/media/');
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 발음 mp3: 한 번 받으면 캐시에서 재생 (오프라인에서도 원어민 발음)
  if (isAudio(u)) {
    e.respondWith(caches.open(A).then(c => c.match(u.href).then(hit => hit || fetch(e.request).then(r => { c.put(u.href, r.clone()); return r; }))));
    return;
  }
  if (u.origin !== location.origin) return; // API(Supabase)는 절대 캐시하지 않음
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
// 앱이 보낸 발음 주소들을 미리 받아 두기
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'warmAudio') return;
  e.waitUntil(caches.open(A).then(async c => {
    for (const url of (e.data.urls || []).slice(0, 400)) {
      try { const u = new URL(url); if (!isAudio(u) || await c.match(u.href)) continue; const r = await fetch(u.href, { mode: 'no-cors' }); await c.put(u.href, r); } catch (_) {}
    }
  }));
});
