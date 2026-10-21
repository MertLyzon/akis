import test from 'node:test';
import assert from 'node:assert/strict';
import {pollWhileActive} from '../app/studio/foregroundPolling.ts';

function harness({hidden=false,online=true}={}){
  const document=new EventTarget(),window=new EventTarget(),timers=new Map();let next=0;
  document.hidden=hidden;
  const env={document,window,navigator:{onLine:online},setTimeout:callback=>{timers.set(++next,callback);return next},clearTimeout:id=>timers.delete(id)};
  return {env,timers,async fire(){const [id,callback]=timers.entries().next().value;timers.delete(id);callback();await Promise.resolve();await Promise.resolve()},hide(value){document.hidden=value;document.dispatchEvent(new Event('visibilitychange'))},online(value){env.navigator.onLine=value;window.dispatchEvent(new Event(value?'online':'offline'))}};
}
test('polling waits for its interval and reschedules even after a transient failure',async()=>{
  const h=harness();let calls=0;const stop=pollWhileActive(async()=>{calls++;throw Error('test read failure')},3000,h.env);
  assert.equal(calls,0);assert.equal(h.timers.size,1);
  await h.fire();assert.equal(calls,1);assert.equal(h.timers.size,1);
  await h.fire();assert.equal(calls,2);stop();assert.equal(h.timers.size,0);
});
test('hidden and offline screens do not poll and resume with exactly one immediate check',async()=>{
  const h=harness({hidden:true});let calls=0;const stop=pollWhileActive(async()=>{calls++},3000,h.env);
  assert.equal(h.timers.size,0);h.online(false);h.hide(false);assert.equal(calls,0);
  h.online(true);assert.equal(calls,1);h.online(true);assert.equal(calls,1);
  await Promise.resolve();assert.equal(h.timers.size,1);
  h.hide(true);assert.equal(h.timers.size,0);stop();h.hide(false);h.online(false);h.online(true);assert.equal(calls,1);
});
test('slow requests never overlap when visibility changes and cleanup prevents late scheduling',async()=>{
  const h=harness();let resolve,calls=0;const pending=new Promise(done=>{resolve=done});
  const stop=pollWhileActive(async()=>{calls++;await pending},3000,h.env);
  await h.fire();assert.equal(calls,1);assert.equal(h.timers.size,0);
  h.hide(true);h.hide(false);h.online(false);h.online(true);assert.equal(calls,1);
  stop();resolve();await Promise.resolve();await Promise.resolve();assert.equal(h.timers.size,0);
});
test('a request finishing in the background stays suspended until the screen is active',async()=>{
  const h=harness();let resolve,calls=0;const pending=new Promise(done=>{resolve=done});
  const stop=pollWhileActive(async()=>{calls++;await pending},3000,h.env);
  await h.fire();h.hide(true);resolve();await Promise.resolve();await Promise.resolve();assert.equal(h.timers.size,0);
  h.hide(false);assert.equal(calls,2);stop();
});
