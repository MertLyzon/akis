import test from 'node:test';
import assert from 'node:assert/strict';
import {UploadQueue} from '../app/studio/uploadQueue.ts';

class Request{
  upload={};headers={};aborts=0;
  open(method,url){this.method=method;this.url=url}
  setRequestHeader(key,value){this.headers[key]=value}
  send(body){this.body=body}
  abort(){this.aborts++;this.onabort?.()}
  respond(status,data){this.status=status;this.responseText=typeof data==='string'?data:JSON.stringify(data);this.onload?.()}
}
const context={url:'/api/media',headers:{'X-Akis-Company':'company-a'},maxBytes:1024,multiple:true};
const file=name=>new File(['image'],name,{type:'image/png',lastModified:123});
const asset=id=>({id,mime_type:'image/png',status:'processing'});
function harness(overrides={}){
  const requests=[],busy=[],states=[],saved=[],errors=[];
  const queue=new UploadQueue({
    createRequest:()=>{const request=new Request();requests.push(request);return request},
    onBusy:value=>busy.push(value),onChange:state=>states.push(state),
    onSuccess:(result,file)=>saved.push({result,file}),onError:(message,file,skipped)=>errors.push({message,file,skipped}),
    ...overrides,
  });
  return {queue,requests,busy,states,saved,errors};
}

test('rapid additions deduplicate active and waiting files and run sequentially',()=>{
  const h=harness(),a=file('a.png'),b=file('b.png');
  assert.deepEqual(h.queue.enqueue([a,a,b],context),{oversized:0,duplicates:1});
  assert.deepEqual(h.queue.enqueue([a,b],context),{oversized:0,duplicates:2});
  assert.equal(h.requests.length,1);
  assert.equal(h.states.at(-1).queued,1);
  h.requests[0].respond(201,asset('a'));
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].body.get('file').name,'b.png');
  assert.deepEqual(h.busy,[true]);
  h.requests[1].respond(202,asset('b'));
  assert.deepEqual(h.busy,[true,false]);
  assert.deepEqual(h.saved.map(entry=>entry.result.id),['a','b']);
  assert.equal(h.queue.isBusy,false);
  assert.deepEqual(h.states.at(-1),{progress:null,queued:0});
});

test('single-file mode cannot start another request before the first finishes',()=>{
  const h=harness(),options={...context,multiple:false};
  h.queue.enqueue([file('a.png'),file('b.png')],options);
  h.queue.enqueue([file('b.png')],options);
  assert.equal(h.requests.length,1);
  h.requests[0].respond(200,asset('a'));
  assert.equal(h.requests.length,1);
  h.queue.enqueue([file('b.png')],options);
  assert.equal(h.requests.length,2);
});

test('network failure stops the remaining queue and permits a deliberate retry',()=>{
  const h=harness(),a=file('a.png');
  h.queue.enqueue([a,file('b.png')],context);
  const fail=h.requests[0].onerror;
  fail();fail();
  assert.equal(h.requests.length,1);
  assert.equal(h.errors.length,1);
  assert.equal(h.errors[0].skipped,1);
  assert.match(h.errors[0].message,/kütüphaneyi kontrol et/);
  assert.equal(h.queue.isBusy,false);
  assert.deepEqual(h.busy,[true,false]);
  h.queue.enqueue([a],context);
  assert.equal(h.requests.length,2);
});

for(const status of [401,403,413,429,500])test(`HTTP ${status} stops the batch`,()=>{
  const h=harness();h.queue.enqueue([file('a.png'),file('b.png')],context);
  h.requests[0].respond(status,{error:'Cannot continue'});
  assert.equal(h.requests.length,1);
  assert.equal(h.errors[0].message,'Cannot continue');
  assert.equal(h.errors[0].skipped,1);
  assert.equal(h.queue.isBusy,false);
});

test('a rejected individual file does not prevent the next valid file',()=>{
  const h=harness();h.queue.enqueue([file('a.png'),file('b.png')],context);
  h.requests[0].respond(400,{error:'Invalid image'});
  assert.equal(h.errors[0].skipped,0);
  assert.equal(h.requests.length,2);
  h.requests[1].respond(200,asset('b'));
  assert.deepEqual(h.saved.map(entry=>entry.result.id),['b']);
  assert.deepEqual(h.busy,[true,false]);
});

for(const response of ['<html>Proxy error</html>',null,{}, {id:'a'}, {id:'',mime_type:'image/png',status:'processing'}])test(`invalid success payload ${JSON.stringify(response)} is not treated as uploaded`,()=>{
  const h=harness();h.queue.enqueue([file('a.png'),file('b.png')],context);
  h.requests[0].respond(200,response);
  assert.equal(h.saved.length,0);
  assert.equal(h.errors.length,1);
  assert.equal(h.requests.length,1);
  assert.equal(h.queue.isBusy,false);
});

test('cancellation aborts once and late callbacks cannot affect a new upload',()=>{
  const h=harness();h.queue.enqueue([file('a.png'),file('b.png')],context);
  const old=h.requests[0],lateLoad=old.onload,lateAbort=old.onabort;
  h.queue.cancel();h.queue.cancel();
  assert.equal(old.aborts,1);
  assert.equal(old.onload,null);
  assert.equal(old.upload.onprogress,null);
  assert.deepEqual(h.busy,[true,false]);
  h.queue.enqueue([file('c.png')],context);
  old.status=200;old.responseText=JSON.stringify(asset('old'));
  lateLoad();lateAbort();
  assert.equal(h.queue.isBusy,true);
  assert.equal(h.saved.length,0);
  assert.equal(h.requests.length,2);
  h.requests[1].respond(200,asset('c'));
  assert.deepEqual(h.saved.map(entry=>entry.result.id),['c']);
  assert.deepEqual(h.busy,[true,false,true,false]);
});

test('request construction failures always release the busy state',()=>{
  const h=harness({createRequest:()=>{throw new Error('Unavailable')}});
  h.queue.enqueue([file('a.png'),file('b.png')],context);
  assert.equal(h.errors.length,1);
  assert.equal(h.errors[0].skipped,1);
  assert.deepEqual(h.busy,[true,false]);
  assert.equal(h.queue.isBusy,false);
});

test('timeout stops the batch',()=>{
  const h=harness();h.queue.enqueue([file('a.png'),file('b.png')],context);
  h.requests[0].ontimeout();
  assert.equal(h.requests.length,1);
  assert.equal(h.errors.length,1);
  assert.match(h.errors[0].message,/sunucuya ulaşmış olabilir/);
  assert.equal(h.queue.isBusy,false);
});

test('queued requests retain the company headers captured when selected',()=>{
  const h=harness(),headers={'X-Akis-Company':'original'};
  h.queue.enqueue([file('a.png'),file('b.png')],{...context,headers});
  headers['X-Akis-Company']='other';
  h.requests[0].respond(200,asset('a'));
  assert.equal(h.requests[1].headers['X-Akis-Company'],'original');
});

test('oversized files never create a request',()=>{
  const h=harness();
  assert.deepEqual(h.queue.enqueue([file('large.png')],{...context,maxBytes:1}),{oversized:1,duplicates:0});
  assert.equal(h.requests.length,0);
  assert.deepEqual(h.busy,[]);
});

test('cancellation from a completion callback does not start the next file',()=>{
  let queue;
  const h=harness({onSuccess:()=>queue.cancel()});queue=h.queue;
  queue.enqueue([file('a.png'),file('b.png')],context);
  h.requests[0].respond(200,asset('a'));
  assert.equal(h.requests.length,1);
  assert.equal(queue.isBusy,false);
});

test('progress ignores zero totals and reports a valid percentage',()=>{
  const h=harness();h.queue.enqueue([file('a.png')],context);
  h.requests[0].upload.onprogress({lengthComputable:true,loaded:0,total:0});
  assert.equal(h.states.at(-1).progress,0);
  h.requests[0].upload.onprogress({lengthComputable:true,loaded:25,total:100});
  assert.equal(h.states.at(-1).progress,25);
});

test('adding files from a completion callback never starts uploads in parallel',()=>{
  let queue,added=false;
  const h=harness({onSuccess:()=>{if(!added){added=true;queue.enqueue([file('c.png')],context)}}});queue=h.queue;
  queue.enqueue([file('a.png'),file('b.png')],context);
  h.requests[0].respond(200,asset('a'));
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].body.get('file').name,'b.png');
  h.requests[1].respond(200,asset('b'));
  assert.equal(h.requests.length,3);
  assert.equal(h.requests[2].body.get('file').name,'c.png');
  h.requests[2].respond(200,asset('c'));
  assert.deepEqual(h.busy,[true,false]);
});

test('cancelling from a busy callback prevents even the first request',()=>{
  let queue;
  const h=harness({onBusy:busy=>{if(busy)queue.cancel()}});queue=h.queue;
  queue.enqueue([file('a.png'),file('b.png')],context);
  assert.equal(h.requests.length,0);
  assert.equal(queue.isBusy,false);
});

test('an external abort clears the waiting queue',()=>{
  const h=harness();h.queue.enqueue([file('a.png'),file('b.png')],context);
  h.requests[0].onabort();
  assert.equal(h.requests.length,1);
  assert.equal(h.queue.isBusy,false);
  assert.deepEqual(h.states.at(-1),{progress:null,queued:0});
});

test('a new upload started from the idle-state notification remains busy after cancellation',()=>{
  let queue,armed=false,added=false;
  const h=harness({onChange:state=>{if(armed&&!added&&state.progress===null){added=true;queue.enqueue([file('replacement.png')],context)}}});queue=h.queue;
  queue.enqueue([file('old.png')],context);armed=true;queue.cancel();
  assert.equal(h.requests.length,2);assert.equal(queue.isBusy,true);
  assert.equal(h.requests[1].body.get('file').name,'replacement.png');
  h.requests[1].respond(200,asset('replacement'));assert.equal(queue.isBusy,false);
});

test('a new upload started from the final idle notification is not unlocked by the old completion',()=>{
  let queue,armed=false,added=false;
  const h=harness({onChange:state=>{if(armed&&!added&&state.progress===null){added=true;queue.enqueue([file('next.png')],context)}}});queue=h.queue;
  queue.enqueue([file('first.png')],context);armed=true;h.requests[0].respond(200,asset('first'));
  assert.equal(h.requests.length,2);assert.equal(queue.isBusy,true);
  h.requests[1].respond(200,asset('next'));assert.equal(queue.isBusy,false);
});

test('even a throwing abort releases the old upload and ignores its late response',()=>{
  const h=harness();h.queue.enqueue([file('old.png'),file('queued.png')],context);
  const old=h.requests[0],lateLoad=old.onload;old.abort=()=>{throw Error('transport closed')};
  assert.doesNotThrow(()=>h.queue.cancel());assert.equal(h.queue.isBusy,false);
  assert.deepEqual(h.states.at(-1),{progress:null,queued:0});
  h.queue.enqueue([file('new.png')],context);
  old.status=200;old.responseText=JSON.stringify(asset('old'));lateLoad();
  assert.equal(h.saved.length,0);assert.equal(h.queue.isBusy,true);
  h.requests[1].respond(200,asset('new'));assert.equal(h.queue.isBusy,false);
});

test('idle busy callbacks can start a replacement without receiving an obsolete empty state',()=>{
  let queue,armed=false,added=false;
  const h=harness({onBusy:value=>{if(armed&&!added&&!value){added=true;queue.enqueue([file('replacement.png')],context)}}});queue=h.queue;
  queue.enqueue([file('old.png')],context);armed=true;queue.cancel();
  assert.equal(queue.isBusy,true);assert.equal(h.requests.length,2);
  assert.deepEqual(h.states.at(-1),{progress:0,queued:0});
  h.requests[1].respond(200,asset('replacement'));assert.equal(queue.isBusy,false);
});
