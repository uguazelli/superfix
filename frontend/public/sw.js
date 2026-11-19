const CACHE = 'superfix-shell-v1'

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    const response = await fetch('/')
    await cache.put('/', response.clone())
    const html = await response.text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => match[1])
      .filter(path => path.startsWith('/assets/'))
    await Promise.all(assets.map(path => cache.add(path).catch(() => undefined)))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('superfix-shell-') && key !== CACHE)
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        void caches.open(CACHE).then(cache => cache.put('/', copy))
      }
      return response
    }).catch(async () => (await caches.match('/')) ?? Response.error()))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then(cached => cached ?? fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        void caches.open(CACHE).then(cache => cache.put(request, copy))
      }
      return response
    })))
  }
})
