import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaPreviewState} from '../app/studio/mediaPreviewState.ts';

test('no selection is distinct from a selected asset without a usable URL',()=>{
  assert.equal(mediaPreviewState(null),'empty');assert.equal(mediaPreviewState(undefined),'empty');
  assert.equal(mediaPreviewState({status:'ready',mime_type:'image/png'}),'unavailable');
  assert.equal(mediaPreviewState({status:'ready',url:'',mime_type:'image/png'}),'unavailable');
});
test('only known processing states show a processing indicator',()=>{
  for(const status of ['processing','queued','converting'])assert.equal(mediaPreviewState({status}),'processing');
  for(const status of ['ready','unexpected',undefined])assert.notEqual(mediaPreviewState({status}),'processing');
});
test('failed files are not treated as still processing or rendered from a leftover URL',()=>{
  assert.equal(mediaPreviewState({status:'failed',url:'/media/file',mime_type:'image/png'}),'failed');
});
test('ready image and video resources get their matching preview',()=>{
  assert.equal(mediaPreviewState({status:'ready',url:'/media/image',mime_type:'image/png'}),'image');
  assert.equal(mediaPreviewState({status:'ready',url:'/media/video',mime_type:'video/mp4'}),'video');
});
test('unknown media types do not start a video request by default',()=>{
  for(const mime_type of [undefined,'application/pdf','text/html'])assert.equal(mediaPreviewState({status:'ready',url:'/media/file',mime_type}),'unavailable');
});
