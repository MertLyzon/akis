import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyedActions} from '../app/studio/libraryRequests.ts';
import {copyToClipboard} from '../app/studio/clipboard.ts';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

test('copy only succeeds after the clipboard write resolves',async()=>{
  const write=deferred(),values=[];let completed=false;
  const copy=copyToClipboard('one-time-value',{writeText:value=>{values.push(value);return write.promise}}).then(()=>{completed=true});
  await Promise.resolve();assert.equal(completed,false);assert.deepEqual(values,['one-time-value']);
  write.resolve();await copy;assert.equal(completed,true);
});

test('a denied clipboard write remains a failure',async()=>{
  const denied=Error('permission denied');
  await assert.rejects(copyToClipboard('one-time-value',{writeText:async()=>{throw denied}}),error=>error===denied);
});

test('an unavailable clipboard does not report success',async()=>{
  await assert.rejects(copyToClipboard('one-time-value',{}),/Clipboard unavailable/);
});

test('a synchronous clipboard failure is also reported',async()=>{
  await assert.rejects(copyToClipboard('one-time-value',{writeText:()=>{throw Error('blocked')}}),/blocked/);
});

test('team guard stays locked while refreshed company data is pending',async()=>{
  const actions=new KeyedActions(),refresh=deferred();let invitations=0,resets=0;
  const invitation=actions.run('team',async()=>{invitations++;await refresh.promise});
  assert.equal(await actions.run('team',async()=>{resets++}),false);
  assert.equal(invitations,1);assert.equal(resets,0);
  refresh.resolve();assert.equal(await invitation,true);
  assert.equal(await actions.run('team',async()=>{resets++}),true);assert.equal(resets,1);
});

test('a failed invitation releases the shared guard for a deliberate retry',async()=>{
  const actions=new KeyedActions();let attempts=0;
  await assert.rejects(actions.run('team',async()=>{attempts++;throw Error('offline')}),/offline/);
  assert.equal(await actions.run('team',async()=>{attempts++}),true);assert.equal(attempts,2);
});
