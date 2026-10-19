import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInviteToken,needsAuthenticator,parseInvitation,invitationUnavailable} from '../app/studio/authFlow.ts';
import {KeyedActions,LatestRequest} from '../app/studio/libraryRequests.ts';

const invitation={company:'Test company',email:'test@example.com',role:'editor',expires_at:1_800_000_000};
test('invitation details accept supported roles without retaining unrelated response fields',()=>{
  for(const role of ['admin','approver','editor','viewer'])assert.deepEqual(parseInvitation({...invitation,role,unrelated:'not retained'}),{...invitation,role});
});
for(const [name,value] of Object.entries({null:null,empty:{},company:{...invitation,company:''},companyType:{...invitation,company:{}},email:{...invitation,email:'invalid'},emailSpaces:{...invitation,email:'a b@example.com'},role:{...invitation,role:'unknown'},dateString:{...invitation,expires_at:'1800000000'},dateZero:{...invitation,expires_at:0},dateFraction:{...invitation,expires_at:1.5},dateNaN:{...invitation,expires_at:NaN},dateInfinite:{...invitation,expires_at:Infinity},dateRange:{...invitation,expires_at:8_640_000_000_001}}))test(`malformed invitation ${name} gives a retryable error without exposing response details`,()=>{
  assert.throws(()=>parseInvitation(value),/^Error: Davet bilgileri alınamadı\. Bağlantını kontrol edip tekrar dene\.$/);
});
test('invitation expiry decisions remain on the server rather than trusting the device clock',()=>{
  assert.equal(parseInvitation({...invitation,expires_at:1}).expires_at,1);
});
test('only explicit unavailable invitation statuses stop acceptance retries',()=>{
  assert.equal(invitationUnavailable(404),true);assert.equal(invitationUnavailable(410),true);
  for(const status of [200,400,401,403,409,429,500,503])assert.equal(invitationUnavailable(status),false);
});

test('invitation tokens accept URL-safe values at both supported length limits',()=>{
  for(const value of ['a'.repeat(20),'b'.repeat(100),'Akis_123-'.repeat(4)])assert.equal(parseInviteToken('#davet='+value),value);
});
for(const hash of ['', '?davet='+'a'.repeat(32), '#davet='+'a'.repeat(19), '#davet='+'a'.repeat(101), '#davet='+'a'.repeat(32)+'&other=value', '#davet='+'a'.repeat(32)+'\n', '#davet='+'a'.repeat(32)+'%0A', '#davet=<script>alert(1)</script>', '#other=davet='+'a'.repeat(32)])test(`invalid invitation fragment ${hash.length} characters (${hash.slice(0,12)}) is rejected`,()=>{
  assert.equal(parseInviteToken(hash),'');
});
test('only an explicit authentication challenge asks for an OTP',()=>{
  assert.equal(needsAuthenticator(401,{needs_code:true}),true);
  for(const data of [null,{},false,{needs_code:false},{needs_code:'true'},{needs_code:1}])assert.equal(needsAuthenticator(401,data),false);
  for(const status of [200,400,403,429,500,503])assert.equal(needsAuthenticator(status,{needs_code:true}),false);
});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
test('an old invitation lookup cannot replace the new invitation or its error state',async()=>{
  const lookup=new LatestRequest(),old=deferred(),fresh=deferred(),shown=[],errors=[];
  const first=lookup.run(()=>old.promise,value=>shown.push(value),error=>errors.push(error),()=>{});
  lookup.invalidate();
  const second=lookup.run(()=>fresh.promise,value=>shown.push(value),error=>errors.push(error),()=>{});
  fresh.resolve('new invitation');await second;old.resolve('old invitation');await first;
  assert.deepEqual(shown,['new invitation']);assert.deepEqual(errors,[]);
});
test('leaving an invitation suppresses a delayed lookup error',async()=>{
  const lookup=new LatestRequest(),wait=deferred(),events=[];
  const first=lookup.run(()=>wait.promise,()=>events.push('result'),()=>events.push('error'),()=>events.push('settled'));
  lookup.invalidate();wait.reject(Error('old failure'));await first;assert.deepEqual(events,[]);
});
test('credentials cannot be submitted twice or change server while login is pending',async()=>{
  const actions=new KeyedActions(),wait=deferred();let logins=0,servers=0;
  const first=actions.run('login',async()=>{logins++;await wait.promise});
  assert.equal(await actions.run('login',async()=>{logins++}),false);
  assert.equal(await actions.run('login',async()=>{servers++}),false);
  wait.resolve();await first;assert.equal(logins,1);assert.equal(servers,0);
});

test('session retries cannot overlap and a failed check releases the guard',async()=>{
  const actions=new KeyedActions(),wait=deferred();let checks=0;
  const first=actions.run('session',async()=>{checks++;await wait.promise});
  assert.equal(await actions.run('session',async()=>{checks++}),false);
  wait.reject(Error('connection lost'));await assert.rejects(first,/connection lost/);
  assert.equal(await actions.run('session',async()=>{checks++}),true);
  assert.equal(checks,2);
});
