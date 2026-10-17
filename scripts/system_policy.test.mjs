import test from 'node:test';
import assert from 'node:assert/strict';
import {systemBackupPolicy} from '../app/studio/systemPolicy.ts';
import {KeyedActions} from '../app/studio/libraryRequests.ts';

test('missing backup policy is unknown, never assumed automatic',()=>{
  for(const value of [null,undefined,{}]){
    const policy=systemBackupPolicy(value,false);
    assert.equal(policy.known,false);assert.equal(policy.automatic,false);
  }
});
test('explicitly disabled automatic backups remain disabled',()=>{
  assert.deepEqual(systemBackupPolicy({automatic:false,interval_days:0,keep:3,remote:false},true),{known:true,automatic:false,interval_days:0,keep:3,remote:false});
});
test('valid server-managed automatic backup settings are shown unchanged',()=>{
  assert.deepEqual(systemBackupPolicy({automatic:true,interval_days:7,keep:3,remote:true},false),{known:true,automatic:true,interval_days:7,keep:3,remote:true});
});
test('a leftover positive interval cannot enable explicitly disabled backups',()=>{
  const policy=systemBackupPolicy({automatic:false,interval_days:7,keep:3},false);
  assert.equal(policy.known,true);assert.equal(policy.automatic,false);
});
test('inconsistent or malformed policy never implies active automatic backups',()=>{
  for(const value of [{automatic:true,interval_days:0},{automatic:true,interval_days:-1},{automatic:true,interval_days:Infinity},{automatic:true,interval_days:'7'},{automatic:'true',interval_days:7},{automatic:true,interval_days:7},{automatic:true,interval_days:7.5,keep:3},{automatic:true,interval_days:7,keep:-1}]){
    const policy=systemBackupPolicy(value,false);
    assert.equal(policy.known,false);assert.equal(policy.automatic,false);
  }
});
test('displaying policy is read-only and does not mutate the server snapshot',()=>{
  const snapshot=Object.freeze({automatic:false,interval_days:0,keep:-5,remote:false});
  assert.equal(systemBackupPolicy(snapshot,true).keep,1);assert.equal(snapshot.keep,-5);
});
test('one pending maintenance action blocks repeated backups and company writes',async()=>{
  const actions=new KeyedActions();let finish,backups=0,companies=0;
  const held=new Promise(resolve=>{finish=resolve});
  const first=actions.run('system',async()=>{backups++;await held});
  assert.equal(await actions.run('system',async()=>{backups++}),false);
  assert.equal(await actions.run('system',async()=>{companies++}),false);
  finish();await first;assert.equal(backups,1);assert.equal(companies,0);
});
test('failed system actions can be deliberately retried',async()=>{
  const actions=new KeyedActions();
  await assert.rejects(actions.run('system',async()=>{throw Error('offline')}),/offline/);
  assert.equal(await actions.run('system',async()=>{}),true);
});
