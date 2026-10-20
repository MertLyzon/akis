import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionStatus} from '../app/studio/connectionStatus.ts';

test('an absent account is not shown as connected',()=>{
  for(const saved of [null,undefined])assert.deepEqual(connectionStatus(saved),{label:'Bağlanmadı',tone:'neutral',attention:false});
});
test('expired credentials take precedence over renewal errors',()=>{
  for(const days_left of [0,-1,-30])assert.deepEqual(connectionStatus({days_left,refresh_error:'Refresh failed'}),{label:'Süresi doldu',tone:'danger',attention:true});
});
test('renewal errors warn even if the access expiry is unknown or far away',()=>{
  for(const days_left of [null,undefined,90])assert.deepEqual(connectionStatus({days_left,refresh_error:'Refresh failed'}),{label:'Kontrol gerekiyor',tone:'warning',attention:true});
});
test('the seven day warning boundary is explicit',()=>{
  for(const days_left of [1,7])assert.equal(connectionStatus({days_left}).label,'Yakında doluyor');
  assert.deepEqual(connectionStatus({days_left:8}),{label:'Bağlı',tone:'saved',attention:false});
});
test('unknown expiry does not invent an expired or soon-to-expire state',()=>{
  for(const days_left of [null,undefined,NaN,Infinity])assert.equal(connectionStatus({days_left}).attention,false);
});
