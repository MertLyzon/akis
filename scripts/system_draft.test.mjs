import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySystemCompany,systemDraftChanged,mergePublicUrl} from '../app/studio/systemDraft.ts';

test('empty company and unchanged public URL do not warn about unsaved work',()=>{
  assert.equal(systemDraftChanged(emptySystemCompany(),'https://example.com','https://example.com'),false);
});
test('each company creation field protects its draft, including whitespace edits',()=>{
  for(const field of ['name','email','admin','timezone'])assert.equal(systemDraftChanged({...emptySystemCompany(),[field]:'typed'},'',''),true);
  assert.equal(systemDraftChanged({...emptySystemCompany(),name:' '},'',''),true);
});
test('changing or deliberately clearing the public URL remains unsaved until confirmed',()=>{
  assert.equal(systemDraftChanged(emptySystemCompany(),'https://new.example.com','https://old.example.com'),true);
  assert.equal(systemDraftChanged(emptySystemCompany(),'','https://old.example.com'),true);
  assert.equal(systemDraftChanged(emptySystemCompany(),'https://new.example.com','https://new.example.com'),false);
});
test('background URL changes follow untouched fields but never overwrite typed or cleared values',()=>{
  assert.equal(mergePublicUrl('old','old','new'),'new');
  assert.equal(mergePublicUrl('my draft','old','new'),'my draft');
  assert.equal(mergePublicUrl('','old','new'),'');
});
test('successful creation resets only its own company fields, not another URL draft',()=>{
  const first=emptySystemCompany(),second=emptySystemCompany();first.name='Typed';assert.equal(second.name,'');
  assert.equal(systemDraftChanged(emptySystemCompany(),'unsaved URL','saved URL'),true);
});
