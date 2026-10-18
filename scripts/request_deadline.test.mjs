import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchJson,apiTimeout,STATE_TIMEOUT_MS,SERVER_CHECK_TIMEOUT_MS,RequestTimeoutError,InvalidJsonError} from '../app/studio/requestDeadline.ts';

function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}}
test('the deadline aborts a stalled request without retrying it',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let signal,calls=0;
  const request=fetchJson('/api/posts',{method:'POST',body:'test'},20,(_,options)=>{calls++;signal=options.signal;return new Promise(()=>{})});
  const rejected=assert.rejects(request,RequestTimeoutError);
  t.mock.timers.tick(20);await rejected;
  assert.equal(signal.aborted,true);t.mock.timers.tick(1000);assert.equal(calls,1);
});
test('the same deadline also covers a response body that never finishes',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  const request=fetchJson('/api/state',{},20,async(_,options)=>{signal=options.signal;return {status:200,json:()=>new Promise(()=>{})}});
  await Promise.resolve();
  const rejected=assert.rejects(request,RequestTimeoutError);t.mock.timers.tick(20);await rejected;
  assert.equal(signal.aborted,true);
});
test('a late response cannot turn a timed-out request into success',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const response=deferred();let successes=0;
  const request=fetchJson('/api/posts',{method:'POST'},20,()=>response.promise).then(value=>{successes++;return value});
  const rejected=assert.rejects(request,RequestTimeoutError);t.mock.timers.tick(20);await rejected;
  response.resolve({status:200,json:async()=>({ok:true})});await Promise.resolve();await Promise.resolve();
  assert.equal(successes,0);
});
test('successful JSON preserves request options and clears its timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  const response={status:200,json:async()=>({ok:true})};
  const result=await fetchJson('/api/posts',{method:'PUT',body:'payload',headers:{'X-Test':'value'}},20,async(url,options)=>{
    assert.equal(url,'/api/posts');assert.equal(options.method,'PUT');assert.equal(options.body,'payload');assert.deepEqual(options.headers,{'X-Test':'value'});signal=options.signal;return response;
  });
  assert.equal(result.response,response);assert.deepEqual(result.data,{ok:true});
  t.mock.timers.tick(100);assert.equal(signal.aborted,false);
});
test('304 responses never read a nonexistent JSON body',async()=>{
  const response={status:304,json:async()=>{throw Error('must not read')}};
  assert.deepEqual(await fetchJson('/api/state',{},20,async()=>response),{response,data:null});
});
test('HTTP authentication errors and challenge data are returned intact for the caller',async()=>{
  const response={status:401,ok:false,json:async()=>({error:'Code required',needs_code:true})};
  const result=await fetchJson('/api/login',{method:'POST'},20,async()=>response);
  assert.equal(result.response.status,401);assert.equal(result.data.needs_code,true);
});
test('invalid JSON has a distinct error and does not leave a timer running',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  await assert.rejects(fetchJson('/api/state',{},20,async(_,options)=>{signal=options.signal;return {status:200,json:async()=>{throw Error('bad json')}}}),InvalidJsonError);
  t.mock.timers.tick(100);assert.equal(signal.aborted,false);
});
test('network failures and synchronous fetch failures are preserved',async()=>{
  const failure=Error('offline');
  await assert.rejects(fetchJson('/api/state',{},20,async()=>{throw failure}),error=>error===failure);
  await assert.rejects(fetchJson('/api/state',{},20,()=>{throw failure}),error=>error===failure);
});
test('only existing long-running manual backup endpoints receive a longer deadline',()=>{
  assert.equal(apiTimeout('posts'),60_000);assert.equal(apiTimeout('system/overview'),60_000);
  assert.equal(apiTimeout('system/backup'),300_000);assert.equal(apiTimeout('system/backup/test%20file/verify'),300_000);
  assert.equal(apiTimeout('system/backup-other'),60_000);assert.equal(apiTimeout('system/backup/file/verify/extra'),60_000);
  assert.equal(STATE_TIMEOUT_MS,20_000);assert.equal(SERVER_CHECK_TIMEOUT_MS,15_000);
});
test('invalid deadline values fail before starting a request',async()=>{
  for(const timeout of [0,-1,Infinity,NaN])await assert.rejects(fetchJson('/api/state',{},timeout,()=>{throw Error('must not start')}),RangeError);
});
