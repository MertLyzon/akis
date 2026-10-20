import test from 'node:test';
import assert from 'node:assert/strict';
import {postActionFailure} from '../app/studio/postActionFailure.ts';

test('network failures keep their message and warn that the outcome is unknown',()=>{
  assert.deepEqual(postActionFailure(Error('Connection lost')),{message:'Connection lost',uncertain:true});
});
test('all server failures and request timeouts may follow an accepted write',()=>{
  for(const status of [408,500,502,503,504,599])assert.equal(postActionFailure({status,message:'Server failure'}).uncertain,true);
});
test('explicit client errors do not claim that the write may have completed',()=>{
  for(const status of [400,401,403,404,409,422,429])assert.equal(postActionFailure({status,message:'Request rejected'}).uncertain,false);
});
test('missing or malformed failures have a safe usable fallback',()=>{
  for(const error of [null,undefined,'failure',{}, {message:''},{message:' '},{message:123}])assert.deepEqual(postActionFailure(error),{message:'İşlem tamamlanamadı.',uncertain:true});
});
test('malformed statuses cannot imply a confirmed rejection',()=>{
  for(const status of [0,200,NaN,Infinity,450.5,'503',null])assert.equal(postActionFailure({status}).uncertain,true);
});
