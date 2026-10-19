import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyedActions,LatestRequest} from '../app/studio/libraryRequests.ts';
import {libraryDraft,libraryDraftChanged,applyLibraryMutation} from '../app/studio/libraryDraft.ts';
import {WorkspaceRefresh} from '../app/studio/workspaceRefresh.ts';

test('library editor captures its own label values without retaining the asset object',()=>{
  const asset={folder:'Original',tags:['one','two']},draft=libraryDraft(asset);
  asset.folder='Refreshed';asset.tags.push('three');
  assert.deepEqual(draft,{folder:'Original',tags:'one, two'});
  assert.equal(libraryDraftChanged(draft,{...draft}),false);
});

const media=[{id:'a',archived:false,folder:'Original',tags:['one']},{id:'b',archived:false,folder:'Other',tags:[]}];
const mediaFilters={archived:false,folder:'',tag:''};
test('confirmed media deletion immediately removes only that item without mutating the previous list',()=>{
  assert.deepEqual(applyLibraryMutation(media,'a','DELETE',{ok:true},mediaFilters),[media[1]]);
  assert.equal(media.length,2);
});
test('confirmed media edits use the normalized server result',()=>{
  const updated=applyLibraryMutation(media,'a','PATCH',{id:'a',folder:'Normalized',tags:['two']},mediaFilters);
  assert.deepEqual(updated[0],{...media[0],folder:'Normalized',tags:['two']});
  assert.equal(media[0].folder,'Original');assert.equal(updated[1],media[1]);
});
test('confirmed changes remove media that no longer matches archive, folder or tag filters',()=>{
  for(const [result,filters] of [[{id:'a',archived:true},mediaFilters],[{id:'a',folder:'Moved'},{...mediaFilters,folder:'Original'}],[{id:'a',tags:['new']},{...mediaFilters,tag:'one'}]]){
    assert.deepEqual(applyLibraryMutation([media[0]],'a','PATCH',result,filters),[]);
  }
});
test('missing or unrelated edit results cannot replace a different media item',()=>{
  for(const result of [null,undefined,{}, {id:'other',folder:'Wrong'}])assert.equal(applyLibraryMutation(media,'a','PATCH',result,mediaFilters),media);
});
test('a confirmed edit does not invent an item outside the currently loaded result',()=>{
  assert.deepEqual(applyLibraryMutation([media[1]],'a','PATCH',media[0],mediaFilters),[media[1]]);
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

test('workspace refresh merges pending reads but every caller waits for the fresh pass',async()=>{
  const queue=new WorkspaceRefresh(),old=deferred(),fresh=deferred();let calls=0,completed=0;
  const first=queue.run(()=>{calls++;return old.promise});
  const second=queue.run(async()=>{throw Error('superseded callback must not run')}).then(result=>{completed++;return result});
  const third=queue.run(()=>{calls++;return fresh.promise}).then(result=>{completed++;return result});
  assert.equal(calls,1);assert.equal(queue.busy,true);
  old.resolve(true);assert.equal(await first,true);
  assert.equal(calls,2);assert.equal(completed,0);assert.equal(queue.busy,true);
  fresh.resolve(false);assert.equal(await second,false);assert.equal(await third,false);
  assert.equal(completed,2);assert.equal(calls,2);assert.equal(queue.busy,false);
});
test('a failed background read still runs an explicitly requested follow-up',async()=>{
  const queue=new WorkspaceRefresh(),old=deferred();let calls=0;
  const first=queue.run(()=>old.promise),second=queue.run(async()=>{calls++;return true});
  old.reject(Error('offline'));assert.equal(await first,false);assert.equal(await second,true);
  assert.equal(calls,1);assert.equal(queue.busy,false);
});
test('failed workspace reads never schedule an automatic retry',async()=>{
  const queue=new WorkspaceRefresh();let calls=0;
  assert.equal(await queue.run(()=>{calls++;throw Error('offline')}),false);
  await Promise.resolve();assert.equal(calls,1);assert.equal(queue.busy,false);
  assert.equal(await queue.run(async()=>{calls++;return true}),true);assert.equal(calls,2);
});
test('a read requested during the follow-up waits for the next fresh pass',async()=>{
  const queue=new WorkspaceRefresh(),a=deferred(),b=deferred(),c=deferred();let calls=0;
  const first=queue.run(()=>{calls++;return a.promise}),second=queue.run(()=>{calls++;return b.promise});
  a.resolve(true);await first;
  const third=queue.run(()=>{calls++;return c.promise});assert.equal(calls,2);
  b.resolve(true);assert.equal(await second,true);assert.equal(calls,3);assert.equal(queue.busy,true);
  c.resolve(true);assert.equal(await third,true);assert.equal(queue.busy,false);
});
test('completion callbacks can request a new read without losing its busy state',async()=>{
  const queue=new WorkspaceRefresh(),next=deferred();let replacement;
  await queue.run(async()=>true).then(()=>{replacement=queue.run(()=>next.promise)});
  assert.equal(queue.busy,true);next.resolve(true);assert.equal(await replacement,true);assert.equal(queue.busy,false);
});
test('a newer workspace context replaces an obsolete queued callback',async()=>{
  const queue=new WorkspaceRefresh(),old=deferred(),seen=[];let context='old';
  const read=()=>{const captured=context;return queue.run(async()=>{if(captured!==context)return false;seen.push(captured);return true}).then(result=>result&&captured===context)};
  const running=queue.run(()=>old.promise),obsolete=read();context='new';const current=read();
  old.resolve(false);await running;
  assert.equal(await obsolete,false);assert.equal(await current,true);assert.deepEqual(seen,['new']);
});

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
