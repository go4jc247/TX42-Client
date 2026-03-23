// TX42-Client Service Worker — Cache-first for offline support
const CACHE_NAME = 'tx42-client-v4';
const ASSETS = [
  './',
  './index.html',
  './assets/css/styles.css',
  './assets/js/game.js',
  './assets/js/multiplayer.js',
  './assets/js/sfx.js',
  './assets/js/claude-chat.js',
  './assets/audio/sfx-click.mp3',
  './assets/audio/sfx-play1.mp3',
  './assets/audio/sfx-play3.mp3',
  './assets/audio/sfx-shuffle.mp3',
  './assets/audio/sfx-invalid.mp3',
  './assets/audio/sfx-collect.mp3',
  './assets/audio/bgm1.mp3',
  './assets/audio/bgm2.mp3',
  './assets/audio/bgm3.mp3',
  './assets/audio/win-song.mp3',
  './assets/audio/lose-song.mp3',
  './assets/images/icon-180.png',
  './assets/images/icon-512.png',
  './assets/images/manifest-icon-192.png',
  './assets/images/manifest-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Skip WebSocket requests
  if (event.request.url.startsWith('wss://') || event.request.url.startsWith('ws://')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
