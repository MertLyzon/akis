import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedTotpCode,parseTotpSetup} from '../app/studio/accountSecurity.ts';
import {KeyedActions} from '../app/studio/libraryRequests.ts';

for(const value of ['012345','012 345','012-345',' 012345 '])test(`six-digit OTP accepts supported formatting (${value.length} characters: ${JSON.stringify(value)})`,()=>{
  assert.equal(normalizedTotpCode(value),'012345');
});
for(const value of ['','12345','1234567','１２３４５６','123a45','123\n456'])test(`OTP rejects invalid input ${JSON.stringify(value)}`,()=>{
  assert.equal(normalizedTotpCode(value),null);
});

const secret='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const uri=`otpauth://totp/Akis:test@example.com?secret=${secret}&issuer=Akis&digits=6&period=30`;
test('setup accepts the backend Base32 secret and matching authenticator link',()=>{
  assert.deepEqual(parseTotpSetup({secret,uri,extra:'not retained'}),{secret,uri});
});
const malformed=[null,{}, {secret:'invalid',uri}, {secret,uri:'javascript:alert(1)'}, {secret,uri:`https://example.com/?secret=${secret}`}, {secret,uri:'not a URL'}, {secret,uri:uri.replace('secret='+secret,'secret=OTHER')}, {secret,uri:uri+'&secret='+secret}];
malformed.forEach((value,index)=>test(`malformed setup ${index+1} is rejected without exposing its contents`,()=>{
  assert.throws(()=>parseTotpSetup(value),error=>error.message==='İki aşamalı giriş kurulum bilgileri alınamadı. Tekrar dene.');
}));

test('a pending 2FA setup blocks duplicate setup and other account changes',async()=>{
  const actions=new KeyedActions();let finish;let setups=0,passwords=0;
  const wait=new Promise(resolve=>{finish=resolve});
  const first=actions.run('account',async()=>{setups++;await wait});
  assert.equal(await actions.run('account',async()=>{setups++}),false);
  assert.equal(await actions.run('account',async()=>{passwords++}),false);
  finish();await first;assert.equal(setups,1);assert.equal(passwords,0);
});

test('an invalid setup response releases the guard for a deliberate retry',async()=>{
  const actions=new KeyedActions();
  await assert.rejects(actions.run('account',async()=>{parseTotpSetup({})}));
  assert.equal(await actions.run('account',async()=>{parseTotpSetup({secret,uri})}),true);
});
