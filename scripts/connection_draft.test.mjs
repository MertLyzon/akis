import test from 'node:test';
import assert from 'node:assert/strict';
import {isOAuthResult,mergeConnectionDraft} from '../app/studio/connectionDraft.ts';

const previous={account:'123',label:'Original',expiry:'2030-01-01T10:00',refreshExpiry:'2030-02-01T10:00',long:false};
const incoming={account:'456',label:'Updated',expiry:'2030-01-02T10:00',refreshExpiry:'2030-02-02T10:00',long:true};
const edits={account:'789',label:'My unsaved label',expiry:'2031-01-01T10:00',refreshExpiry:'2031-02-01T10:00',long:true};

test('unchanged fields follow background connection updates without mutating inputs',()=>{
  const original={...previous};
  assert.deepEqual(mergeConnectionDraft(previous,previous,incoming),incoming);
  assert.deepEqual(previous,original);
});
for(const field of Object.keys(edits))test(`background updates preserve edited ${field}`,()=>{
  const current={...previous,[field]:edits[field]};
  const remote=field==='long'?{...incoming,long:false}:incoming;
  assert.deepEqual(mergeConnectionDraft(current,previous,remote),{...remote,[field]:edits[field]});
});
test('deliberately cleared labels and expiry dates are edits, not missing values',()=>{
  const current={...previous,label:'',expiry:'',refreshExpiry:''};
  const merged=mergeConnectionDraft(current,previous,incoming);
  assert.equal(merged.label,'');assert.equal(merged.expiry,'');assert.equal(merged.refreshExpiry,'');
});
test('after a successful save, refreshed server values can normalize the submitted draft',()=>{
  const submitted={...edits},normalized={...edits,label:'Normalized'};
  assert.deepEqual(mergeConnectionDraft(submitted,submitted,normalized),normalized);
});

const popup={},origin='https://api.example.com';
const result={source:popup,origin,data:{type:'akis-oauth',ok:true,message:'Connected'}};
test('OAuth accepts a well-formed result from the active popup and captured origin',()=>{
  assert.equal(isOAuthResult(result,popup,origin),true);
  assert.equal(isOAuthResult({...result,data:{...result.data,ok:false}},popup,origin),true);
});
test('OAuth rejects results after cancellation, including null message sources',()=>{
  assert.equal(isOAuthResult(result,null,origin),false);
  assert.equal(isOAuthResult({...result,source:null},null,origin),false);
});
test('OAuth rejects other windows, even if they use the expected origin',()=>{
  assert.equal(isOAuthResult({...result,source:{}},popup,origin),false);
});
test('OAuth rejects other origins, even if they refer to the active popup',()=>{
  assert.equal(isOAuthResult({...result,origin:'https://untrusted.example.com'},popup,origin),false);
});
for(const data of [null,{},'akis-oauth',{type:'other',ok:true,message:'Connected'},{type:'akis-oauth',ok:'true',message:'Connected'},{type:'akis-oauth',ok:true,message:123}])test(`OAuth rejects malformed callback ${JSON.stringify(data)}`,()=>{
  assert.equal(isOAuthResult({...result,data},popup,origin),false);
});
