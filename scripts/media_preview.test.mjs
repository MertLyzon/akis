import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaPreviewState,mediaIsProcessing,mediaStatusLabel,readyMediaDetails} from '../app/studio/mediaPreviewState.ts';

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
test('only explicit processing statuses keep the metadata spinner running',()=>{
  for(const status of ['processing','queued','converting'])assert.equal(mediaIsProcessing(status),true);
  for(const status of ['ready','failed','unknown',undefined,''])assert.equal(mediaIsProcessing(status),false);
  assert.equal(mediaStatusLabel('unknown'),'Durum bilinmiyor.');assert.equal(mediaStatusLabel('failed'),'Hazırlanamadı');
});
test('complete ready metadata uses one size formatter shared by library and uploader',()=>{
  assert.equal(readyMediaDetails({width:1920,height:1080,size:1500},value=>`${value} bytes`),'1920 × 1080 · 1500 bytes');
});
test('nullable or invalid dimensions are omitted without inventing zero dimensions',()=>{
  for(const width of [null,undefined,NaN,Infinity,0,-1,1.5,'1920'])assert.equal(readyMediaDetails({width,height:1080,size:100},value=>`${value} bytes`),'100 bytes');
});
test('invalid sizes never reach the formatter and dimensions remain usable',()=>{
  for(const size of [null,undefined,NaN,Infinity,-1,'100'])assert.equal(readyMediaDetails({width:10,height:20,size},()=>{throw Error('invalid formatter input')}),'10 × 20');
});
test('empty ready metadata has a plain ready label rather than nulls or NaN',()=>{
  assert.equal(readyMediaDetails({},String),'Hazır');assert.equal(readyMediaDetails({size:0},value=>`${value} bytes`),'0 bytes');
});
