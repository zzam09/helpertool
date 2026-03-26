const CACHE_NAME = 'rewriter-v1.0.0';

const swPath = self.location.pathname.replace(/\/sw\.js$/, '');
const BASE_PATH = swPath || '';

const OFFLINE_URL = `${BASE_PATH}/offline.html`;

const STATIC_ASSETS = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/rewriteter.html`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/icons/icon-192.png`,
  `${BASE_PATH}/icons/icon-512.png`,
  `${BASE_PATH}/offline.html`
];

const EXTERNAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Syne:wght@600;800&family=DM+Mono&display=swap'
];

const API_BASE = 'https://helpertool.chaserice.workers.dev/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets from:', BASE_PATH || '/');
        return cache.addAll([...STATIC_ASSETS, ...EXTERNAL_ASSETS]);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('rewriter-') && name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.origin === location.origin && !isStaticAsset(url.pathname)) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  if (url.href.startsWith(API_BASE)) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  if (url.origin === 'https://fonts.googleapis.com' || 
      url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  if (url.href.includes('cdn.tailwindcss.com')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(cacheFirstStrategy(request));
});

function isStaticAsset(pathname) {
  return STATIC_ASSETS.some(asset => asset.endsWith(pathname) || asset === pathname);
}

async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Cache-first fetch failed:', error);
    const fallback = await caches.match(OFFLINE_URL);
    if (fallback) return fallback;
    return caches.match(request);
  }
}

async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network-first fallback to cache:', request.url);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const offlineFallback = await caches.match(OFFLINE_URL);
    if (offlineFallback) {
      return offlineFallback;
    }
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'offline',
      message: 'You are offline. Please check your connection.' 
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  return cachedResponse || networkPromise || caches.match(OFFLINE_URL);
}

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-saved') {
    event.waitUntil(syncSavedItems());
  }
});

async function syncSavedItems() {
  console.log('[SW] Background sync triggered');
  const cache = await caches.open(CACHE_NAME);
  const pendingSync = await cache.match('pending-sync');
  
  if (pendingSync) {
    const items = await pendingSync.json();
    for (const item of items) {
      try {
        await fetch(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', ...item })
        });
      } catch (e) {
        console.error('[SW] Sync failed for item:', item);
      }
    }
    await cache.delete('pending-sync');
  }
}
