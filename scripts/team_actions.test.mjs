import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyedActions} from '../app/studio/libraryRequests.ts';
import {copyToClipboard} from '../app/studio/clipboard.ts';
import {companyDraft,companyDraftChanged,invitationDraftChanged,mergeCompanyDraft} from '../app/studio/teamDraft.ts';

const savedCompany={name:'Original',timezone:'Europe/Istanbul',require_approval:true};
test('company draft copies editable fields only and initial load does not warn',()=>{
  assert.equal(companyDraftChanged(null,null),false);
  const draft=companyDraft({...savedCompany,id:'not editable'});
  assert.deepEqual(draft,savedCompany);assert.notEqual(draft,savedCompany);
  assert.equal(companyDraftChanged(draft,savedCompany),false);
});
for(const [field,value] of [['name','My company'],['timezone','Europe/London'],['require_approval',false]])test(`unsaved company ${field} survives refresh and clears after save`,()=>{
  const edited={...savedCompany,[field]:value};
  const incoming={...savedCompany,name:'Remote company',timezone:'Europe/Berlin'};
  const merged=mergeCompanyDraft(edited,savedCompany,incoming);
  assert.equal(merged[field],value);assert.equal(companyDraftChanged(merged,incoming),true);
  assert.equal(companyDraftChanged(merged,merged),false);
});
test('untouched company fields follow refreshed data and saved input can be normalized',()=>{
  const incoming={name:'New company',timezone:'Europe/London',require_approval:false};
  assert.deepEqual(mergeCompanyDraft(savedCompany,savedCompany,incoming),incoming);
  const submitted={...savedCompany,name:'  My company  '},normalized={...submitted,name:'My company'};
  assert.deepEqual(mergeCompanyDraft(submitted,submitted,normalized),normalized);
  assert.equal(companyDraftChanged(normalized,normalized),false);
});
test('clearing a company name is still an edit, and merge never mutates inputs',()=>{
  const edited={...savedCompany,name:''};
  const merged=mergeCompanyDraft(edited,savedCompany,{...savedCompany,name:'Remote'});
  assert.equal(merged.name,'');assert.equal(companyDraftChanged(merged,savedCompany),true);
  assert.equal(savedCompany.name,'Original');assert.equal(edited.name,'');
});
test('an invitation warns for email, name, or a changed role, and clears after reset',()=>{
  assert.equal(invitationDraftChanged('','','editor'),false);
  assert.equal(invitationDraftChanged('test@example.com','','editor'),true);
  assert.equal(invitationDraftChanged('','Test member','editor'),true);
  assert.equal(invitationDraftChanged('','','viewer'),true);
  assert.equal(invitationDraftChanged('','','editor'),false);
});

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
