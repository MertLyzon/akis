import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {StateCache} from '../app/studio/stateCache.ts';

test('clearing state invalidates old responses even when returning to the same company',()=>{
  const cache=new StateCache(),old=cache.begin('company');
  cache.clear();old.commit('old-tag');
  assert.equal(old.current(),false);assert.deepEqual(cache.begin('company').headers,{});
});
test('only the newest completed state request can update the conditional tag',()=>{
  const cache=new StateCache(),old=cache.begin('company'),fresh=cache.begin('company');
  fresh.commit('new-tag');old.commit('old-tag');
  assert.deepEqual(cache.begin('company').headers,{'If-None-Match':'new-tag'});
  assert.deepEqual(cache.begin('other-company').headers,{});
});
test('a response without an ETag removes the previous conditional tag',()=>{
  const cache=new StateCache();cache.begin('company').commit('tag');
  cache.begin('company').commit('');assert.deepEqual(cache.begin('company').headers,{});
});

// Exercise the actual API module with a fresh browser runtime for each test.
// Transpilation only resolves its local imports; no production implementation is copied.
let moduleId=0;
async function runtime(t,native=false){
  for(const key of ['window','localStorage']){
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else delete globalThis[key]});
  }
  const stored=new Map(),calls=[];
  Object.defineProperty(globalThis,'window',{configurable:true,value:native?{__TAURI_INTERNALS__:{}}:{}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}});
  t.mock.method(globalThis,'fetch',(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject})));
  const source=await readFile(new URL('../app/studio/api.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
    .replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>'from '+JSON.stringify(new URL('../app/studio/'+path.slice(2)+'.ts',import.meta.url).href));
  const api=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64')+'#'+moduleId++);
  return {api,calls,stored};
}
function json(data,status=200,tag){return Response.json(data,{status,headers:tag?{ETag:tag}:{}})}

const uncertainWrite='İşlem sonucu doğrulanamadı. İşlem sunucuda tamamlanmış olabilir. Yeniden denemeden önce sonucu kontrol et.';
for(const method of ['POST','PUT','PATCH','delete'])for(const failure of ['network','invalid-json'])test(`${method} ${failure} reports an unconfirmed write without retrying`,async t=>{
  const {api,calls}=await runtime(t);
  const writing=api.api('posts/test',{text:'Test content'},method);
  const rejected=assert.rejects(writing,error=>error.message===uncertainWrite&&!(error instanceof api.ApiError));
  if(failure==='network')calls[0].reject(new TypeError('test-only internal detail'));
  else calls[0].resolve(new Response('test-only invalid response',{status:200}));
  await rejected;await Promise.resolve();assert.equal(calls.length,1);
});
for(const method of ['GET','head'])for(const failure of ['network','invalid-json'])test(`${method} ${failure} keeps read-only connection guidance`,async t=>{
  const {api,calls}=await runtime(t);
  const reading=api.api('session',undefined,method);
  const rejected=assert.rejects(reading,error=>error.message===(failure==='network'?'Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.':'Sunucuya ulaşılamıyor. Biraz sonra tekrar dene.'));
  if(failure==='network')calls[0].reject(new TypeError('test-only internal detail'));
  else calls[0].resolve(new Response('test-only invalid response',{status:502}));
  await rejected;assert.equal(calls.length,1);
});
test('valid server error responses preserve status, message and support code for writes',async t=>{
  const {api,calls}=await runtime(t);
  for(const status of [400,401,403,409,429,500,503]){
    const index=calls.length,writing=api.api('posts/test',{},'PATCH');
    const rejected=assert.rejects(writing,error=>error instanceof api.ApiError&&error.status===status&&error.data.support_code==='test-code'&&error.message.includes('Test rejection')&&error.message.includes('test-code'));
    calls[index].resolve(json({error:'Test rejection',support_code:'test-code'},status));await rejected;
    assert.equal(calls.length,index+1);
  }
});
test('an unconfirmed native write neither clears authentication nor installs a token from an unreadable response',async t=>{
  const {api,calls,stored}=await runtime(t,true);api.setToken('current-token');
  const writing=api.api('connections',{token:'test-only-platform-key'});
  const rejected=assert.rejects(writing,error=>error.message===uncertainWrite);
  calls[0].resolve(new Response('{"token":"late-token",invalid}',{status:200}));await rejected;
  assert.equal(api.authHeaders().Authorization,'Bearer current-token');assert.equal(stored.get('akis-token'),'current-token');
  assert.equal(calls.length,1);
});

test('a forgotten in-flight workspace cannot repopulate its ETag or return stale data',async t=>{
  const {api,calls}=await runtime(t);api.setCompany('company');
  const old=api.fetchState();api.forgetState();
  calls[0].resolve(json({posts:['old']},200,'old-tag'));assert.equal(await old,null);
  const fresh=api.fetchState();assert.equal(calls[1].options.headers['If-None-Match'],undefined);
  calls[1].resolve(json({posts:['fresh']},200,'new-tag'));assert.deepEqual(await fresh,{posts:['fresh']});
  const unchanged=api.fetchState();assert.equal(calls[2].options.headers['If-None-Match'],'new-tag');
  calls[2].resolve(new Response(null,{status:304}));assert.equal(await unchanged,null);
});
test('switching company invalidates an old success and an old network error',async t=>{
  const {api,calls}=await runtime(t);api.setCompany('first');
  const old=api.fetchState(),failed=api.fetchState();api.setCompany('second');
  calls[0].resolve(json({company:'first'},200,'first-tag'));calls[1].reject(Error('old network failure'));
  assert.equal(await old,null);assert.equal(await failed,null);
  const fresh=api.fetchState();assert.equal(calls[2].options.headers['X-Akis-Company'],'second');
  assert.equal(calls[2].options.headers['If-None-Match'],undefined);
  calls[2].resolve(json({company:'second'}));assert.deepEqual(await fresh,{company:'second'});
});
test('an old native API authentication failure cannot erase a new login token',async t=>{
  const {api,calls,stored}=await runtime(t,true);api.setToken('old-token');
  const old=api.api('session'),rejected=assert.rejects(old,error=>error.status===401);
  api.setToken('new-token');calls[0].resolve(json({error:'Expired'},401));await rejected;
  assert.equal(api.authHeaders().Authorization,'Bearer new-token');assert.equal(stored.get('akis-token'),'new-token');
});
test('a current native authentication failure still clears its token',async t=>{
  const {api,calls,stored}=await runtime(t,true);api.setToken('expired-token');
  const current=api.api('session'),rejected=assert.rejects(current,error=>error.status===401);
  calls[0].resolve(json({error:'Expired'},401));await rejected;
  assert.equal(api.authHeaders().Authorization,undefined);assert.equal(stored.has('akis-token'),false);
});
test('a current native login still installs the returned token',async t=>{
  const {api,calls,stored}=await runtime(t,true);
  const login=api.api('login',{email:'test@example.com',password:'test-only-password'});
  calls[0].resolve(json({token:'fresh-token'}));await login;
  assert.equal(api.authHeaders().Authorization,'Bearer fresh-token');assert.equal(stored.get('akis-token'),'fresh-token');
});
test('a current workspace authentication error is still reported and clears its native token',async t=>{
  const {api,calls}=await runtime(t,true);api.setToken('expired-token');
  const request=api.fetchState(),rejected=assert.rejects(request,error=>error.status===401);
  calls[0].resolve(json({error:'Expired'},401));await rejected;
  assert.equal(api.authHeaders().Authorization,undefined);
});
test('selecting the same company preserves conditional polling',async t=>{
  const {api,calls}=await runtime(t);api.setCompany('company');
  const first=api.fetchState();calls[0].resolve(json({posts:[]},200,'current-tag'));await first;
  api.setCompany('company');const poll=api.fetchState();
  assert.equal(calls[1].options.headers['If-None-Match'],'current-tag');
  calls[1].resolve(new Response(null,{status:304}));assert.equal(await poll,null);
});
test('a stale workspace 401 cannot clear the new native token',async t=>{
  const {api,calls}=await runtime(t,true);api.setToken('old-token');
  const old=api.fetchState();api.setToken('new-token');calls[0].resolve(json({error:'Expired'},401));
  assert.equal(await old,null);assert.equal(api.authHeaders().Authorization,'Bearer new-token');
});
test('a delayed token response cannot restore a signed-out native session',async t=>{
  const {api,calls}=await runtime(t,true);api.setToken('old-token');
  const old=api.api('session');api.setToken('');calls[0].resolve(json({token:'late-token'}));await old;
  assert.equal(api.authHeaders().Authorization,undefined);
});
test('server changes isolate token responses and workspace caches',async t=>{
  const {api,calls}=await runtime(t,true);api.setServer('https://old.example');
  const old=api.api('session'),state=api.fetchState();api.setServer('https://new.example');
  calls[0].resolve(json({token:'old-server-token'}));calls[1].resolve(json({posts:['old']},200,'old-tag'));
  await old;assert.equal(await state,null);assert.equal(api.authHeaders().Authorization,undefined);
  const fresh=api.fetchState();assert.equal(calls[2].url,'https://new.example/api/state');
  assert.equal(calls[2].options.headers['If-None-Match'],undefined);
  calls[2].resolve(json({posts:[]}));await fresh;
});
