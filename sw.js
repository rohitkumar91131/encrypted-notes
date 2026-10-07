// Bump this version whenever the app shell changes. Each release is cached together.
const CACHE = 'stillnote-shell-v77';
const SHELL = ['/', '/encrypted-notes.html', '/editor-features.js', '/editor-features.css', '/smart-search.js', '/smart-search.css',
  '/gallery.js', '/gallery.css', '/gallery-storage.js', '/gallery-downloads.js', '/workspace.js', '/workspace.css', '/scrollbars.css', '/sync-experience.js', '/sync-experience.css', '/workspace-backup.js', '/settings-layout.js', '/settings-layout.css', '/device-lock.js', '/device-lock.css', '/eye-mode.js', '/eye-mode.css', '/pwa.js', '/pwa.css', '/manifest.webmanifest',
  '/public/logo.png', '/public/icon-192.png', '/public/icon-512.png',
  '/public/icon-180.png', '/public/icon-maskable-512.png', '/public/vendor/supabase.min.js', '/public/vendor/gsap.min.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, {cache: 'reload'})))).then(() => self.skipWaiting()));
  // Activate the complete shell without reloading open editors. Next navigation uses this release.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith('stillnote-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  // Only public app files. Auth, database, external media and user data stay out of this cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/encrypted-notes.html');
  if (!navigation && !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(navigation ? '/' : url.pathname);
    return cached || fetch(request);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'GET_RELEASE') event.ports[0]?.postMessage({release: CACHE});
});
