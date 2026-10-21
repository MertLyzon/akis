import test from 'node:test';
import assert from 'node:assert/strict';
import {filterPosts,matchesPost,nextPostFilter} from '../app/studio/postFilters.ts';
import {postMediaStatus} from '../app/studio/mediaPreviewState.ts';

const posts=[
  {id:'a',status:'draft',text:'İSTANBUL planı',created_by:'Mert',options:{}},
  {id:'b',status:'rejected',text:'',asset:{filename:'launch.png'},options:{template:'hello_world'}},
  {id:'c',status:'published',text:'Done',deliveries:[{status:'failed'}]},
  {id:'d',status:'scheduled',text:'Next',deliveries:[]},
];
test('filters keep draft/rejected together and include failed deliveries in attention',()=>{
  assert.deepEqual(filterPosts(posts,'draft','').map(p=>p.id),['a','b']);
  assert.deepEqual(filterPosts(posts,'attention','').map(p=>p.id),['c']);
  assert.deepEqual(filterPosts(posts,'scheduled','').map(p=>p.id),['d']);
  assert.equal(matchesPost({status:'draft'},'attention'),false);
  assert.equal(matchesPost({status:'attention'},'attention'),true);
});
test('search trims whitespace, handles Turkish casing and searches media, author and template',()=>{
  for(const [query,ids] of [[' istanbul ',['a']],['MERT',['a']],['hello_world',['b']],['launch.png',['b']],['not-found',[]]])assert.deepEqual(filterPosts(posts,'all',query).map(p=>p.id),ids);
  assert.deepEqual(filterPosts(posts,'scheduled','launch'),[]);
});
test('clearing filters returns the original posts without modifying them',()=>{
  const before=JSON.stringify(posts);
  assert.deepEqual(filterPosts(posts,'all','  '),posts);assert.equal(JSON.stringify(posts),before);
});
test('keyboard filter navigation wraps and supports Home and End',()=>{
  assert.equal(nextPostFilter('all','ArrowLeft'),'draft');
  assert.equal(nextPostFilter('draft','ArrowRight'),'all');
  assert.equal(nextPostFilter('all','ArrowRight'),'pending_approval');
  assert.equal(nextPostFilter('scheduled','Home'),'all');
  assert.equal(nextPostFilter('scheduled','End'),'draft');
  assert.equal(nextPostFilter('all','Tab'),undefined);
});
test('ready media is not described as still processing and server notes are preserved',()=>{
  assert.equal(postMediaStatus({status:'ready'}),'Hazır');
  assert.equal(postMediaStatus({status:'failed'}),'Hazırlanamadı');
  assert.equal(postMediaStatus({status:'processing'}),'Hazırlanıyor…');
  assert.equal(postMediaStatus({status:'ready',note:'Converted without cropping'}),'Converted without cropping');
});
test('post media uses the same unknown-state policy as the library instead of inventing processing',()=>{
  for(const status of [undefined,'unexpected',''])assert.equal(postMediaStatus({status}),'Durum bilinmiyor.');
  for(const status of ['processing','queued','converting'])assert.equal(postMediaStatus({status}),'Hazırlanıyor…');
});
