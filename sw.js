/* ============================================================================
   WILSON INTERIORS - SERVICE WORKER
   Provides offline support and intelligent caching
   ============================================================================ */

const CACHE_NAME = 'wi-dashboard-v2.2.0';
const STATIC_ASSETS = [
  './index.html',
  './deliveries.html',
  './app.js',
  './styles.css'
];

/* ============================================================================
   INSTALL - Cache static assets
   ============================================================================ */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v2.2.0');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        // Cache files individually to handle missing files gracefully
        return Promise.allSettled(
          STATIC_ASSETS.map(url => 
            cache.add(new Request(url, {cache: 'reload'}))
              .catch(err => console.warn('[SW] Failed to cache:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[SW] Install failed:', err))
  );
});

/* ============================================================================
   ACTIVATE - Clean up old caches
   ============================================================================ */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker v2.2.0');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

/* ============================================================================
   FETCH - Intelligent caching strategy
   ============================================================================ */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Network-first for CSV data
  if (url.hostname === 'docs.google.com' && url.pathname.includes('spreadsheets')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                console.log('[SW] Serving stale CSV from cache');
                return cachedResponse;
              }
              return new Response('Offline', { status: 503 });
            });
        })
    );
    return;
  }

  // Cache-first for static assets
  if (
    url.hostname === location.hostname ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'unpkg.com'
  ) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            fetch(event.request)
              .then((response) => {
                if (response && response.status === 200) {
                  caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, response);
                  });
                }
              })
              .catch(() => {});
            return cachedResponse;
          }
          
          return fetch(event.request)
            .then((response) => {
              if (response && response.status === 200) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseClone);
                });
              }
              return response;
            });
        })
    );
    return;
  }

  event.respondWith(fetch(event.request));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Service worker loaded');