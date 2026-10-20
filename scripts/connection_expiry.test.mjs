import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionDateInput,connectionExpiry} from '../app/studio/connectionExpiry.ts';

function inZone(zone,run){const previous=process.env.TZ;process.env.TZ=zone;try{run()}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}}
test('missing and malformed timestamps do not crash date fields',()=>{
  for(const value of [null,undefined,NaN,Infinity,1e20])assert.equal(connectionDateInput(value),'');
});
test('ordinary entered dates round trip in several device time zones',()=>{
  for(const zone of ['UTC','Europe/Istanbul','Europe/Berlin','Pacific/Auckland'])inZone(zone,()=>{
    const value='2030-06-15T11:42';assert.equal(connectionDateInput(connectionExpiry(value,null)),value);
  });
});
test('editing unrelated metadata preserves the original seconds of both expiry fields',()=>{
  inZone('Europe/Istanbul',()=>{for(const stamp of [1925035237,1925121691,0])assert.equal(connectionExpiry(connectionDateInput(stamp),stamp),stamp)});
});
test('deliberately clearing an existing expiry saves null rather than the previous timestamp',()=>{
  assert.equal(connectionExpiry('',1925035237),null);assert.equal(connectionExpiry('',null),null);
});
test('invalid days and unsupported date syntax cannot silently normalize or become null',()=>{
  inZone('UTC',()=>{
    for(const value of ['2030-02-30T12:00','2027-02-29T12:00','2030-13-01T12:00','2030-01-01T24:00','2030-01-01T12:60','garbage','2030-01-01','2030-01-01T12:00Z','2030-01-01T12:00:00'])assert.throws(()=>connectionExpiry(value,null),/Bitiş tarihi/);
    assert.equal(connectionDateInput(connectionExpiry('2028-02-29T12:00',null)),'2028-02-29T12:00');
  });
});
test('a changed date uses its newly entered minute instead of the original seconds',()=>{
  inZone('UTC',()=>assert.equal(connectionExpiry('2031-01-01T10:15',1925035237),Date.parse('2031-01-01T10:15Z')/1000));
});
test('nonexistent and repeated device-local times are rejected',()=>{
  inZone('Europe/Berlin',()=>{for(const value of ['2027-03-28T02:30','2027-10-31T02:30'])assert.throws(()=>connectionExpiry(value,null),/Bitiş tarihi/)});
  inZone('Australia/Lord_Howe',()=>assert.throws(()=>connectionExpiry('2027-04-04T01:45',null),/Bitiş tarihi/));
});
test('unchanged repeated times preserve the exact server instant on either side of the clock change',()=>{
  inZone('Europe/Berlin',()=>{
    for(const iso of ['2027-10-31T00:30:27Z','2027-10-31T01:30:48Z']){
      const stamp=Date.parse(iso)/1000;assert.equal(connectionDateInput(stamp),'2027-10-31T02:30');
      assert.equal(connectionExpiry('2027-10-31T02:30',stamp),stamp);
    }
  });
});
