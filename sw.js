const CACHE_NAME = 'fergus-buffet-flow-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './app_icon.png',
  './app_icon_512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install Event - Caching Assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching de recursos estáticos completado.');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Cleaning old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('Service Worker: Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch Event - Serve from Cache or Network fallback
self.addEventListener('fetch', event => {
  // Only handle GET requests and local/font resources
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Fetch from network in the background to update the cache (stale-while-revalidate)
          fetch(event.request).then(networkResponse => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
            }
          }).catch(() => {/* Ignore network errors when offline */});
          
          return cachedResponse;
        }

        return fetch(event.request).then(response => {
          // Cache fonts or icons dynamically if needed
          if (response.status === 200 && (event.request.url.includes('fonts.googleapis') || event.request.url.includes('fonts.gstatic'))) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return response;
        });
      })
  );
});
