import test from 'node:test';
import assert from 'node:assert/strict';
import {PostReadBarrier} from '../app/studio/postReadBarrier.ts';

test('only posts with confirmed writes and failed refreshes are held',()=>{
  const barrier=new PostReadBarrier();barrier.hold('a');
  assert.equal(barrier.has('a'),true);assert.equal(barrier.has('b'),false);
});
test('a successful fresh read releases the holds it started with',()=>{
  const barrier=new PostReadBarrier();barrier.hold('a');barrier.hold('b');
  barrier.confirm(barrier.snapshot());assert.equal(barrier.snapshot().size,0);
});
test('a read that started before a write cannot release its later hold',()=>{
  const barrier=new PostReadBarrier(),before=barrier.snapshot();barrier.hold('a');
  barrier.confirm(before);assert.equal(barrier.has('a'),true);
});
test('overlapping posts keep holds created after the read started',()=>{
  const barrier=new PostReadBarrier();barrier.hold('a');const before=barrier.snapshot();barrier.hold('b');
  barrier.confirm(before);assert.equal(barrier.has('a'),false);assert.equal(barrier.has('b'),true);
});
test('an old read cannot clear a newer hold for the same post',()=>{
  const barrier=new PostReadBarrier();barrier.hold('a');const before=barrier.snapshot();barrier.hold('a');
  barrier.confirm(before);assert.equal(barrier.has('a'),true);
  barrier.confirm(barrier.snapshot());assert.equal(barrier.has('a'),false);
});
test('a failed read leaves its snapshot isolated and its holds intact',()=>{
  const barrier=new PostReadBarrier();barrier.hold('a');const before=barrier.snapshot();before.clear();
  assert.equal(barrier.has('a'),true);assert.equal(barrier.snapshot().size,1);
});
