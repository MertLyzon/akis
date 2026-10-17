import test from 'node:test';
import assert from 'node:assert/strict';
import {NavigationSafety} from '../app/studio/navigationSafety.ts';

test('an idle screen can be left without confirmation',()=>{
  const guard=new NavigationSafety();assert.equal(guard.decision(),'allow');
  assert.deepEqual(guard.snapshot(),{pending:false,sensitive:false,dirty:false});
});
test('regular tab navigation preserves the editor; replacing it requires confirmation',()=>{
  const guard=new NavigationSafety();
  assert.equal(guard.decision(false,true),'allow');
  assert.equal(guard.decision(true,true),'confirm');
  assert.equal(guard.decision(true,false),'allow');
});
test('a pending operation blocks even an otherwise confirmed or empty editor',()=>{
  const guard=new NavigationSafety();guard.update('team',{pending:true,sensitive:false});
  assert.equal(guard.decision(),'blocked');assert.equal(guard.decision(true,true),'blocked');
});
test('pending work takes priority over visible one-time details',()=>{
  const guard=new NavigationSafety();guard.update('system',{pending:true,sensitive:true});
  assert.equal(guard.decision(),'blocked');
  guard.update('system',{pending:false,sensitive:true});assert.equal(guard.decision(),'confirm');
});
test('one-time details require confirmation on every route away until closed',()=>{
  const guard=new NavigationSafety();guard.update('account',{pending:false,sensitive:true});
  assert.equal(guard.decision(),'confirm');assert.equal(guard.decision(true,true),'confirm');
  guard.update('account',{pending:false,sensitive:false});assert.equal(guard.decision(),'allow');
});
test('clearing one screen never clears another screen’s pending operation',()=>{
  const guard=new NavigationSafety();
  guard.update('team',{pending:false,sensitive:true});guard.update('system',{pending:true,sensitive:false});
  guard.update('team',{pending:false,sensitive:false});assert.equal(guard.decision(),'blocked');
  guard.update('system',{pending:false,sensitive:false});assert.equal(guard.decision(),'allow');
});
test('failed operations release navigation without inventing a sensitive result',()=>{
  const guard=new NavigationSafety();guard.update('team',{pending:true,sensitive:false});
  guard.update('team',{pending:false,sensitive:false});assert.equal(guard.decision(),'allow');
});
test('identical reports do not trigger unnecessary parent renders',()=>{
  const guard=new NavigationSafety();assert.equal(guard.update('team',{pending:false,sensitive:false}),false);
  assert.equal(guard.update('team',{pending:true,sensitive:false}),true);
  assert.equal(guard.update('team',{pending:true,sensitive:false}),false);
});
test('reports and returned snapshots are copied instead of being externally mutable',()=>{
  const guard=new NavigationSafety(),status={pending:true,sensitive:false};guard.update('team',status);
  status.pending=false;assert.equal(guard.decision(),'blocked');
  const snapshot=guard.snapshot();snapshot.pending=false;assert.equal(guard.decision(),'blocked');
});
test('closing details does not remove the existing unsaved-editor warning',()=>{
  const guard=new NavigationSafety();guard.update('team',{pending:false,sensitive:true});
  guard.update('team',{pending:false,sensitive:false});assert.equal(guard.decision(true,true),'confirm');
});
test('unsaved forms warn on every route, even when the content editor is clean',()=>{
  const guard=new NavigationSafety();guard.update('settings-x',{pending:false,sensitive:false,dirty:true});
  assert.equal(guard.decision(),'confirm');
  guard.update('settings-instagram',{pending:true,sensitive:false});assert.equal(guard.decision(),'blocked');
  guard.update('settings-instagram',{pending:false,sensitive:false});assert.equal(guard.decision(),'confirm');
  guard.update('settings-x',{pending:false,sensitive:false,dirty:false});assert.equal(guard.decision(),'allow');
});
test('saving one platform does not clear unsaved edits on another',()=>{
  const guard=new NavigationSafety();
  guard.update('settings-x',{pending:false,sensitive:false,dirty:true});
  guard.update('settings-tiktok',{pending:false,sensitive:false,dirty:true});
  guard.update('settings-x',{pending:false,sensitive:false,dirty:false});
  assert.equal(guard.decision(),'confirm');assert.equal(guard.snapshot().dirty,true);
});
