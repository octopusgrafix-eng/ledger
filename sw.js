/* The Daybook — service worker.
 *
 * Purpose: make the ledger open instantly and keep working with no signal.
 * Without this, every visit waits ~1.6s of round-trip latency before the first
 * byte of the page arrives. With it, the shell is served from local disk.
 *
 * What is cached: the app shell (index.html) and the three Firebase SDK scripts.
 * The shell contains no ledger data — every figure is rendered client-side from
 * Firestore — so nothing private is ever written to the cache.
 *
 * What is NEVER touched: calls to firestore.googleapis.com and
 * identitytoolkit.googleapis.com. Those carry live data and auth tokens, and
 * Firestore's listen channel must not be intercepted or it will break realtime
 * sync. Anything not explicitly matched below falls straight through to the network.
 *
 * Bump CACHE_VERSION whenever the cached asset list changes.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'daybook-' + CACHE_VERSION;

const SHELL_URL = './index.html';

// Version-pinned and immutable, so cache-first is always safe here.
const CDN_ASSETS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
];

self.addEventListener('install', (event)=>{
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE_NAME);
    // The shell must cache for the worker to be worth installing at all.
    await cache.addAll(['./', SHELL_URL]);
    // The CDN scripts are best-effort: if gstatic is unreachable while installing,
    // still activate rather than leaving the user with no worker.
    await Promise.all(CDN_ASSETS.map(url=>
      cache.add(new Request(url, {mode:'cors', credentials:'omit'})).catch(()=>{})
    ));
  })());
});

self.addEventListener('activate', (event)=>{
  event.waitUntil((async ()=>{
    const names = await caches.keys();
    await Promise.all(names
      .filter(n => n.startsWith('daybook-') && n !== CACHE_NAME)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// The page asks for the update to be applied once the user accepts the prompt.
self.addEventListener('message', (event)=>{
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Serve from cache immediately, then refresh the copy in the background so the
// next open already has the newer file. Keeps startup instant without pinning
// the app to a stale version forever.
async function staleWhileRevalidate(request, cacheKey){
  const cache = await caches.open(CACHE_NAME);
  const key = cacheKey || request;
  const cached = await cache.match(key);

  const network = fetch(request).then(response=>{
    if(response && response.ok && response.type !== 'opaque'){
      cache.put(key, response.clone()).catch(()=>{});
    }
    return response;
  }).catch(()=> null);

  return cached || network.then(r => r || Response.error());
}

async function cacheFirst(request){
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if(cached) return cached;
  const response = await fetch(request);
  if(response && response.ok) cache.put(request, response.clone()).catch(()=>{});
  return response;
}

self.addEventListener('fetch', (event)=>{
  const request = event.request;
  if(request.method !== 'GET') return;

  let url;
  try{ url = new URL(request.url); }catch(e){ return; }

  // Never intercept live data or auth traffic — let it go straight to the network.
  if(url.hostname.endsWith('googleapis.com')) return;

  // Any navigation resolves to the single-page shell, so deep links and reloads
  // work offline too.
  if(request.mode === 'navigate'){
    event.respondWith(
      staleWhileRevalidate(request, SHELL_URL)
        .catch(async ()=> (await caches.open(CACHE_NAME)).match(SHELL_URL))
    );
    return;
  }

  if(CDN_ASSETS.indexOf(url.href) !== -1){
    event.respondWith(cacheFirst(request));
    return;
  }

  if(url.origin === self.location.origin){
    event.respondWith(staleWhileRevalidate(request));
  }
  // Everything else: untouched.
});
