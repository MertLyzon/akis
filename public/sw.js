// Akış service worker: makes the web app installable and opens instantly.
// Only the app shell (HTML, JS, CSS, icons) is cached. /api is never cached,
// so no content, media or session data is stored on the device.
const CACHE='akis-shell-v4',PREFIX='akis-shell-',MAX_ENTRIES=80;
const PINNED=['/','/manifest.webmanifest','/icons/icon-192.png'];

async function cached(request){try{return await caches.match(request,{cacheName:CACHE})}catch{return undefined}}
async function store(request,response){
  try{
    const cache=await caches.open(CACHE);await cache.put(request,response);
    const keys=await cache.keys();let remaining=keys.length;
    for(const key of keys){
      if(remaining<=MAX_ENTRIES)break;
      const url=new URL(key.url);
      if(!url.search&&PINNED.includes(url.pathname))continue;
      if(await cache.delete(key))remaining--;
    }
  }catch{/* Storage denial or quota must never break a successful network response. */}
}

self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PINNED)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  let path;try{path=decodeURIComponent(url.pathname)}catch{return}
  if(req.method!=='GET'||url.origin!==location.origin||path==='/api'||path.startsWith('/api/'))return;
  if(req.mode==='navigate'){
    // Do not replace the working shell with a deployment error or a non-HTML response.
    const network=fetch(req);
    e.waitUntil(network.then(r=>r.ok&&!r.redirected&&(r.headers.get('content-type')||'').toLowerCase().includes('text/html')?store('/',r.clone()):undefined).catch(()=>{}));
    e.respondWith(network.then(async r=>r.ok?r:(await cached('/')||r)).catch(async()=>await cached('/')||Response.error()));
    return;
  }
  if(!url.pathname.startsWith('/assets/')&&!url.pathname.startsWith('/icons/')&&url.pathname!=='/manifest.webmanifest')return;
  // Built assets have content hashes in their names, so cache-first is safe.
  const resource=cached(req).then(hit=>hit?{response:hit,network:false}:fetch(req).then(response=>({response,network:true})));
  e.waitUntil(resource.then(({response,network})=>network&&response.ok&&!response.redirected&&!(response.headers.get('content-type')||'').toLowerCase().includes('text/html')?store(req,response.clone()):undefined).catch(()=>{}));
  e.respondWith(resource.then(result=>result.response));
});
