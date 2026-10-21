import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
const origin='https://app.example.test',name='akis-shell-v4';
const html=(text='Healthy shell',status=200)=>new Response(text,{status,headers:{'Content-Type':'text/html'}});
const script=()=>new Response('test script',{headers:{'Content-Type':'application/javascript'}});
const urlOf=value=>new URL(typeof value==='string'?value:value.url,origin).href;
function harness(options={}){
  const databases=new Map(),events={},network=[],writes=[],removed=[];let claimed=0;
  const entries=cacheName=>{if(!databases.has(cacheName))databases.set(cacheName,new Map());return databases.get(cacheName)};
  const caches={
    async open(cacheName){
      if(options.storageDenied)throw Error('Storage unavailable');
      const data=entries(cacheName);
      return {
        async put(request,response){if(options.putDenied)throw Error('Quota exceeded');if(options.beforePut)await options.beforePut();writes.push(urlOf(request));data.set(urlOf(request),response.clone())},
        async keys(){return [...data.keys()].map(url=>new Request(url))},
        async delete(request){return data.delete(urlOf(request))},
        async addAll(paths){for(const path of paths)data.set(urlOf(path),html())},
      };
    },
    async match(request,opts){if(options.storageDenied)throw Error('Storage unavailable');return databases.get(opts.cacheName)?.get(urlOf(request))?.clone()},
    async keys(){return [...databases.keys()]},
    async delete(cacheName){removed.push(cacheName);return databases.delete(cacheName)},
  };
  const context=vm.createContext({URL,Response,caches,location:new URL(origin),fetch:async request=>{network.push(urlOf(request));return options.fetch?options.fetch(request):html()},self:{addEventListener:(event,callback)=>{events[event]=callback},skipWaiting:()=>{},clients:{claim:async()=>{claimed++}}}});
  vm.runInContext(source,context);
  function begin(path='/',mode='navigate',method='GET'){
    let response;const work=[];
    events.fetch({request:{url:urlOf(path),mode,method},respondWith:value=>{response=value},waitUntil:value=>work.push(value)});
    return {response,work:Promise.allSettled(work)};
  }
  async function load(...args){const transaction=begin(...args);if(!transaction.response)return undefined;const response=await transaction.response;await transaction.work;return response}
  async function lifecycle(event){const work=[];events[event]({waitUntil:promise=>work.push(promise)});await Promise.all(work)}
  return {entries,databases,network,writes,removed,begin,load,lifecycle,get claimed(){return claimed}};
}

test('API, mutations, cross-origin resources and media are never intercepted or cached',async()=>{
  const h=harness();
  for(const [path,mode,method] of [['/api','navigate','GET'],['/api/session','cors','GET'],['/%61pi/session','navigate','GET'],['/api%2Fsession','navigate','GET'],['/api/posts','navigate','POST'],['https://external.example/asset.js','cors','GET'],['/media/private.png','cors','GET']])assert.equal(await h.load(path,mode,method),undefined);
  assert.deepEqual(h.network,[]);assert.deepEqual(h.writes,[]);
});
test('successful HTML navigation updates the offline shell and remains network-first',async()=>{
  const h=harness({fetch:()=>html('New shell')});h.entries(name).set(urlOf('/'),html('Old shell'));
  assert.equal(await (await h.load()).text(),'New shell');assert.equal(await h.entries(name).get(urlOf('/')).text(),'New shell');
  await h.load();assert.equal(h.network.length,2);
});
test('deployment errors fall back to the good shell without overwriting it',async()=>{
  const h=harness({fetch:()=>html('Deployment error',503)});h.entries(name).set(urlOf('/'),html('Good shell'));
  assert.equal(await (await h.load()).text(),'Good shell');assert.deepEqual(h.writes,[]);
  assert.equal(await h.entries(name).get(urlOf('/')).text(),'Good shell');
});
test('offline navigation reads only the current Akış shell, not another app cache',async()=>{
  const h=harness({fetch:()=>{throw Error('Offline')}});
  h.entries('other-app').set(urlOf('/'),html('Unrelated app'));h.entries(name).set(urlOf('/'),html('Akış shell'));
  assert.equal(await (await h.load()).text(),'Akış shell');
});
test('missing offline fallback gives a network error, while genuine server errors keep their status',async()=>{
  const offline=harness({fetch:()=>{throw Error('Offline')}});assert.equal((await offline.load()).type,'error');
  const server=harness({fetch:()=>html('Unavailable',503)});assert.equal((await server.load()).status,503);
});
test('non-HTML and redirected navigation responses do not poison the offline shell',async()=>{
  for(const response of [new Response('{}',{headers:{'Content-Type':'application/json'}}),Object.defineProperty(html(),'redirected',{value:true})]){
    const h=harness({fetch:()=>response});await h.load();assert.deepEqual(h.writes,[]);
  }
});
test('storage denial does not break healthy navigation or static network resources',async()=>{
  const h=harness({storageDenied:true,fetch:request=>request.mode==='navigate'?html():script()});
  assert.equal((await h.load()).status,200);assert.equal((await h.load('/assets/test.js','cors')).status,200);
  assert.equal(h.network.length,2);
});
test('quota failure never replaces a valid network response with a cache error',async()=>{
  const h=harness({putDenied:true});assert.equal(await (await h.load()).text(),'Healthy shell');
});
test('hashed static cache hits neither fetch nor rewrite the file',async()=>{
  const h=harness();h.entries(name).set(urlOf('/assets/test.js'),script());
  assert.equal(await (await h.load('/assets/test.js','cors')).text(),'test script');assert.deepEqual(h.network,[]);assert.deepEqual(h.writes,[]);
});
test('successful new static files are cached but HTML fallbacks and errors are not',async()=>{
  for(const [response,expected] of [[script(),1],[html(),0],[html('Missing',404),0]]){
    const h=harness({fetch:()=>response});await h.load('/assets/new.js','cors');assert.equal(h.writes.length,expected);
  }
});
test('activation deletes only older Akış shell caches and preserves unrelated apps',async()=>{
  const h=harness();for(const key of [name,'akis-shell-v3','other-app','akis-reports'])h.entries(key);
  await h.lifecycle('activate');assert.deepEqual(h.removed,['akis-shell-v3']);assert.equal(h.claimed,1);
});
test('cache entries are bounded while the root, manifest and install icon remain pinned',async()=>{
  const h=harness({fetch:()=>script()}),data=h.entries(name);
  for(const path of ['/','/manifest.webmanifest','/icons/icon-192.png'])data.set(urlOf(path),html());
  for(let i=0;i<100;i++)data.set(urlOf(`/assets/old-${i}.js`),script());
  await h.load('/assets/latest.js','cors');assert.ok(data.size<=80);
  for(const path of ['/','/manifest.webmanifest','/icons/icon-192.png','/assets/latest.js'])assert.equal(data.has(urlOf(path)),true);
});
test('background cache writes are attached to the event without delaying the network response',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve});const h=harness({beforePut:()=>held});
  const transaction=h.begin();assert.equal((await transaction.response).status,200);assert.equal(h.writes.length,0);
  release();await transaction.work;assert.equal(h.writes.length,1);
});
test('install warms only the public shell resources',async()=>{
  const h=harness();await h.lifecycle('install');
  assert.deepEqual([...h.entries(name).keys()],['/','/manifest.webmanifest','/icons/icon-192.png'].map(path=>urlOf(path)));
});
