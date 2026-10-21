import test from 'node:test';
import assert from 'node:assert/strict';
import {requestInstall} from '../app/studio/installPrompt.ts';
import {KeyedActions} from '../app/studio/libraryRequests.ts';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
test('install waits for both the prompt and confirmed acceptance',async()=>{
  const opening=deferred(),choice=deferred();let settled=false;
  const result=requestInstall({prompt:()=>opening.promise,userChoice:choice.promise}).then(value=>{settled=true;return value});
  choice.resolve({outcome:'accepted'});await Promise.resolve();assert.equal(settled,false);
  opening.resolve();assert.equal(await result,true);
});
test('dismissed and malformed choices are not reported as installed',async()=>{
  for(const choice of [{outcome:'dismissed'},null,{},'accepted',{outcome:true}])assert.equal(await requestInstall({prompt:()=>undefined,userChoice:Promise.resolve(choice)}),false);
});
test('a failed prompt rejects immediately without waiting indefinitely for user choice',async()=>{
  const failure=Error('prompt unavailable');
  await assert.rejects(requestInstall({prompt:()=>{throw failure},userChoice:new Promise(()=>{})}),error=>error===failure);
});
test('a failed user choice is available to the UI error handler',async()=>{
  const choice=deferred();const result=requestInstall({prompt:()=>undefined,userChoice:choice.promise});
  choice.reject(Error('choice unavailable'));await assert.rejects(result,/choice unavailable/);
});
test('a choice failure is observed while opening the prompt is still pending',async()=>{
  const opening=deferred(),choice=deferred(),failure=Error('early choice failure');
  const result=requestInstall({prompt:()=>opening.promise,userChoice:choice.promise});
  const rejected=assert.rejects(result,error=>error===failure);
  choice.reject(failure);await new Promise(resolve=>setImmediate(resolve));
  opening.resolve();await rejected;
});
test('a failed prompt does not leave a later choice rejection unhandled',async()=>{
  const choice=deferred(),failure=Error('prompt failed first');
  await assert.rejects(requestInstall({prompt:()=>Promise.reject(failure),userChoice:choice.promise}),error=>error===failure);
  choice.reject(Error('choice failed later'));await new Promise(resolve=>setImmediate(resolve));
});
test('rapid install clicks start only one prompt and release the guard after choice',async()=>{
  const actions=new KeyedActions(),choice=deferred();let prompts=0;
  const prompt={prompt:()=>{prompts++},userChoice:choice.promise};
  const first=actions.run('install',async()=>{await requestInstall(prompt)});
  assert.equal(await actions.run('install',async()=>{await requestInstall(prompt)}),false);
  assert.equal(prompts,1);choice.resolve({outcome:'dismissed'});await first;assert.equal(actions.has('install'),false);
});
