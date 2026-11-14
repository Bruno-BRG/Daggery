// Daggery service worker. Makes the app installable and keeps the shell, built assets, fonts and card
// art on the device, so the app opens fast on a phone and still opens without a connection.
// The API, the websocket and private game assets always go to the network and are never stored.
const VERSION = 'v1';
const SHELL = `daggery-shell-${VERSION}`;
const ASSETS = `daggery-assets-${VERSION}`;
const MEDIA = `daggery-media-${VERSION}`;
const KEEP = [SHELL, ASSETS, MEDIA];

const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
const NETWORK_ONLY = /^\/(api|ws|health)(\/|$)/;
const MEDIA_PATH = /^\/(cards|icons|fonts|maps|tokens)\//;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!KEEP.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (FONT_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(request, MEDIA));
    return;
  }
  if (NETWORK_ONLY.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS));
  } else if (MEDIA_PATH.test(url.pathname) || url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(request, MEDIA));
  }
});

/** Pages come from the network so a deploy shows up at once; the stored shell answers when offline. */
async function networkFirstPage(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

/** Built assets carry a content hash in their name, so a stored copy never goes stale. */
async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  }).catch(() => hit ?? Response.error());
  return hit ?? refresh;
}
