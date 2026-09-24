// Akış service worker: makes the web app installable and opens instantly.
// Only the app shell (HTML, JS, CSS, icons) is cached. /api is never cached,
// so no content, media or session data is stored on the device.
const CACHE='akis-shell-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/manifest.webmanifest','/icons/icon-192.png'])));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
  if(req.mode==='navigate'){
    // Network first so a new release shows up immediately; fall back to the cached shell offline.
    e.respondWith(fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put('/',copy));return r}).catch(()=>caches.match('/')));
    return;
  }
  // Built assets have content hashes in their names, so cache-first is safe.
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok&&(url.pathname.startsWith('/assets/')||url.pathname.startsWith('/icons/'))){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r})));
});
