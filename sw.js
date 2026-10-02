// Bump this version whenever the app shell changes. Each release is cached together.
const CACHE = 'stillnote-shell-v13';
const SHELL = ['/', '/encrypted-notes.html', '/editor-features.js', '/editor-features.css',
  '/workspace.js', '/workspace.css', '/device-lock.js', '/device-lock.css', '/pwa.js', '/pwa.css', '/manifest.webmanifest',
  '/public/logo.png', '/public/icon-192.png', '/public/icon-512.png',
  '/public/icon-180.png', '/public/icon-maskable-512.png', '/public/vendor/supabase.min.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, {cache: 'reload'})))));
  // Wait for open windows to close before activating a new release: never reload unsaved edits.
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
