import test from 'node:test';
import assert from 'node:assert/strict';
import {saveThenRefresh} from '../app/studio/settingsSave.ts';
import {KeyedActions,LatestRequest} from '../app/studio/libraryRequests.ts';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function steps(overrides={}){
  const events=[];
  return {events,callbacks:{save:async()=>{events.push('save')},saved:()=>events.push('saved'),refresh:async()=>{events.push('refresh')},refreshFailed:()=>events.push('refresh-failed'),...overrides}};
}

test('successful save is acknowledged before refreshing the list',async()=>{
  const h=steps();await saveThenRefresh(h.callbacks);
  assert.deepEqual(h.events,['save','saved','refresh']);
});

test('save failure never clears fields or refreshes the list',async()=>{
  const failure=Error('unavailable'),h=steps({save:async()=>{throw failure}});
  await assert.rejects(saveThenRefresh(h.callbacks),error=>error===failure);
  assert.deepEqual(h.events,[]);
});

test('refresh failure after a committed save is not treated as a failed save',async()=>{
  const h=steps({refresh:async()=>{throw Error('offline')}});
  await saveThenRefresh(h.callbacks);
  assert.deepEqual(h.events,['save','saved','refresh-failed']);
});

test('an explicitly unsuccessful refresh warns without repeating or undoing the save',async()=>{
  const h=steps({refresh:async()=>false});await saveThenRefresh(h.callbacks);
  assert.deepEqual(h.events,['save','saved','refresh-failed']);
});

test('a failing warning callback is not invoked twice',async()=>{
  let warnings=0;
  const h=steps({refresh:async()=>false,refreshFailed:()=>{warnings++;throw Error('warning failed')}});
  await assert.rejects(saveThenRefresh(h.callbacks),/warning failed/);
  assert.equal(warnings,1);assert.deepEqual(h.events,['save','saved']);
});

test('successful boolean and legacy void refreshes do not show a warning',async()=>{
  for(const result of [true,undefined]){
    const h=steps({refresh:async()=>result});await saveThenRefresh(h.callbacks);
    assert.deepEqual(h.events,['save','saved']);
  }
});

test('a handled overview failure still warns the completed-save flow',async()=>{
  const latest=new LatestRequest(),h=steps();
  h.callbacks.refresh=()=>latest.run(async()=>{throw Error('overview unavailable')},()=>h.events.push('loaded'),()=>h.events.push('load-error'),()=>{});
  await saveThenRefresh(h.callbacks);
  assert.deepEqual(h.events,['save','saved','load-error','refresh-failed']);
});

test('an overview refresh superseded by another read does not acknowledge stale data',async()=>{
  const latest=new LatestRequest(),held=deferred(),h=steps();
  h.callbacks.refresh=()=>latest.run(()=>held.promise,()=>h.events.push('old-data'),()=>{},()=>{});
  const saving=saveThenRefresh(h.callbacks);
  await Promise.resolve();await Promise.resolve();
  assert.equal(await latest.run(async()=>({fresh:true}),()=>{},()=>{},()=>{}),true);
  held.resolve({old:true});await saving;
  assert.deepEqual(h.events,['save','saved','refresh-failed']);
});

test('rapid submits run only one save and one acknowledgement',async()=>{
  const actions=new KeyedActions(),wait=deferred();let saves=0,acknowledgements=0;
  const h=steps({save:()=>{saves++;return wait.promise},saved:()=>{acknowledgements++}});
  const first=actions.run('save',()=>saveThenRefresh(h.callbacks));
  assert.equal(await actions.run('save',()=>saveThenRefresh(h.callbacks)),false);
  wait.resolve();assert.equal(await first,true);
  assert.equal(saves,1);assert.equal(acknowledgements,1);
});

test('save stays locked while its status refresh is pending',async()=>{
  const actions=new KeyedActions(),refresh=deferred();
  const h=steps({refresh:()=>refresh.promise});
  const first=actions.run('save',()=>saveThenRefresh(h.callbacks));
  await Promise.resolve();assert.deepEqual(h.events,['save','saved']);
  assert.equal(await actions.run('save',()=>saveThenRefresh(h.callbacks)),false);
  refresh.resolve();await first;assert.equal(actions.has('save'),false);
});

test('a failed save unlocks the same form for a deliberate retry',async()=>{
  const actions=new KeyedActions(),h=steps({save:async()=>{throw Error('offline')}});
  await assert.rejects(actions.run('save',()=>saveThenRefresh(h.callbacks)),/offline/);
  const retry=steps();assert.equal(await actions.run('save',()=>saveThenRefresh(retry.callbacks)),true);
  assert.deepEqual(retry.events,['save','saved','refresh']);
});

test('saving one platform does not block an independent platform form',async()=>{
  const firstGuard=new KeyedActions(),secondGuard=new KeyedActions(),wait=deferred();
  const first=firstGuard.run('save',()=>saveThenRefresh(steps({save:()=>wait.promise}).callbacks));
  const second=steps();assert.equal(await secondGuard.run('save',()=>saveThenRefresh(second.callbacks)),true);
  assert.equal(firstGuard.has('save'),true);
  wait.resolve();await first;
});
