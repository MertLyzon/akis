import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyedActions,LatestRequest} from '../app/studio/libraryRequests.ts';
import {libraryDraft,libraryDraftChanged} from '../app/studio/libraryDraft.ts';

test('library editor captures its own label values without retaining the asset object',()=>{
  const asset={folder:'Original',tags:['one','two']},draft=libraryDraft(asset);
  asset.folder='Refreshed';asset.tags.push('three');
  assert.deepEqual(draft,{folder:'Original',tags:'one, two'});
  assert.equal(libraryDraftChanged(draft,{...draft}),false);
});
test('empty library metadata starts clean',()=>{
  const draft=libraryDraft({});assert.deepEqual(draft,{folder:'',tags:''});
  assert.equal(libraryDraftChanged(draft,libraryDraft({})),false);
});
for(const field of ['folder','tags'])test(`a library ${field} edit warns until restored or saved`,()=>{
  const baseline=libraryDraft({folder:'Folder',tags:['tag']});
  const draft={...baseline,[field]:'Edited'};
  assert.equal(libraryDraftChanged(draft,baseline),true);
  assert.equal(libraryDraftChanged(draft,draft),false);
  assert.equal(libraryDraftChanged(baseline,baseline),false);
});
test('deliberately clearing library labels is an unsaved edit',()=>{
  const baseline=libraryDraft({folder:'Folder',tags:['tag']});
  assert.equal(libraryDraftChanged({folder:'',tags:''},baseline),true);
});
test('the navigation action count stays positive until all independent mutations settle',async()=>{
  const actions=new KeyedActions(),a=deferred(),b=deferred();
  assert.equal(actions.size,0);
  const first=actions.run('a',()=>a.promise),second=actions.run('b',()=>b.promise);
  assert.equal(actions.size,2);a.resolve();await first;assert.equal(actions.size,1);
  b.reject(Error('offline'));await assert.rejects(second,/offline/);assert.equal(actions.size,0);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

test('same media cannot be mutated twice before a render',async()=>{
  const actions=new KeyedActions(),wait=deferred();let calls=0;
  const first=actions.run('media-a',()=>{calls++;return wait.promise});
  assert.equal(actions.has('media-a'),true);
  assert.equal(await actions.run('media-a',async()=>{calls++}),false);
  assert.equal(calls,1);wait.resolve();assert.equal(await first,true);
  assert.equal(actions.has('media-a'),false);
});

test('independent media can be changed concurrently',async()=>{
  const actions=new KeyedActions(),a=deferred(),b=deferred();
  const first=actions.run('a',()=>a.promise),second=actions.run('b',()=>b.promise);
  a.resolve();await first;assert.equal(actions.has('b'),true);
  b.resolve();assert.equal(await second,true);
});

test('failed action unlocks the media so the user can retry',async()=>{
  const actions=new KeyedActions();
  await assert.rejects(actions.run('a',async()=>{throw Error('offline')}),/offline/);
  assert.equal(actions.has('a'),false);
  assert.equal(await actions.run('a',async()=>{}),true);
});

test('synchronous failure also releases the action lock',async()=>{
  const actions=new KeyedActions();
  await assert.rejects(actions.run('a',()=>{throw Error('invalid')}),/invalid/);
  assert.equal(actions.has('a'),false);
});

function observer(){const values=[],errors=[],settled=[];return {values,errors,settled,callbacks:[value=>values.push(value),error=>errors.push(error),()=>settled.push(true)]}}

test('a slow previous filter cannot replace the latest results',async()=>{
  const requests=new LatestRequest(),old=deferred(),fresh=deferred(),o=observer();
  const first=requests.run(()=>old.promise,...o.callbacks),second=requests.run(()=>fresh.promise,...o.callbacks);
  fresh.resolve(['new']);assert.equal(await second,true);old.resolve(['old']);assert.equal(await first,false);
  assert.deepEqual(o.values,[['new']]);assert.deepEqual(o.settled,[true]);
});

test('obsolete failure cannot show an error or clear loading for a newer filter',async()=>{
  const requests=new LatestRequest(),old=deferred(),fresh=deferred(),o=observer();
  const first=requests.run(()=>old.promise,...o.callbacks),second=requests.run(()=>fresh.promise,...o.callbacks);
  old.reject(Error('old error'));await first;
  assert.deepEqual(o.errors,[]);assert.deepEqual(o.settled,[]);
  fresh.resolve([]);await second;assert.deepEqual(o.values,[[]]);
});

test('latest failure is reported once and ends loading',async()=>{
  const requests=new LatestRequest(),o=observer(),error=Error('offline');
  assert.equal(await requests.run(()=>Promise.reject(error),...o.callbacks),false);
  assert.deepEqual(o.errors,[error]);assert.deepEqual(o.values,[]);assert.deepEqual(o.settled,[true]);
});

test('unmount invalidates both success and failure callbacks',async()=>{
  for(const fail of [false,true]){
    const requests=new LatestRequest(),wait=deferred(),o=observer();
    const result=requests.run(()=>wait.promise,...o.callbacks);requests.invalidate();
    if(fail)wait.reject(Error('offline'));else wait.resolve(['old']);assert.equal(await result,false);
    assert.deepEqual(o.values,[]);assert.deepEqual(o.errors,[]);assert.deepEqual(o.settled,[]);
  }
});

test('requests work again after invalidation (including StrictMode remount)',async()=>{
  const requests=new LatestRequest(),o=observer();requests.invalidate();
  await requests.run(()=>Promise.resolve(['fresh']),...o.callbacks);
  assert.deepEqual(o.values,[['fresh']]);assert.deepEqual(o.settled,[true]);
});
