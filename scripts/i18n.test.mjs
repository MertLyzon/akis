import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {t,readLanguage} from '../app/studio/i18n.ts';

const root=new URL('../',import.meta.url);
const parse=(path,kind=ts.ScriptKind.TS)=>ts.createSourceFile(path,readFileSync(new URL(path,root),'utf8'),ts.ScriptTarget.Latest,true,kind);
const dictionary=new Map();
function dictionaryEntries(node){
  if(ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.name)&&ts.isStringLiteral(node.initializer))dictionary.set(node.name.text,node.initializer.text);
  ts.forEachChild(node,dictionaryEntries);
}
dictionaryEntries(parse('app/studio/i18n.ts'));
function language(tst,value){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>value}});
  tst.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage});
}
function literalChoices(node){
  if(ts.isStringLiteral(node))return [node.text];
  return ts.isConditionalExpression(node)?[...literalChoices(node.whenTrue),...literalChoices(node.whenFalse)]:[];
}
test('literal UI translation calls and conditional messages have an English entry',()=>{
  const unchanged=new Set(['Access token','Refresh token','Client key','Client secret']);
  const files=['app/page.tsx',...readdirSync(new URL('app/studio/',root)).filter(name=>name.endsWith('.tsx')).map(name=>'app/studio/'+name)];
  const missing=[];
  for(const file of files){
    const source=parse(file,ts.ScriptKind.TSX);
    function scan(node){
      if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&node.arguments[0])
        for(const text of literalChoices(node.arguments[0]))if(!dictionary.has(text)&&!unchanged.has(text)&&/[a-zçğıöşü]/i.test(text)&&!['AM','PM','UTC'].includes(text))missing.push(`${file}: ${text}`);
      ts.forEachChild(node,scan);
    }
    scan(source);
  }
  assert.deepEqual(missing,[]);
});
test('English translations preserve every named template variable',()=>{
  const variables=value=>[...new Set([...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match=>match[1]))].sort();
  assert.ok(dictionary.size>100);
  for(const [key,value] of dictionary){assert.ok(value.trim(),key);assert.deepEqual(variables(value),variables(key),key)}
});
for(const lang of ['tr','en'])test(`interpolation preserves literal user values in ${lang} without recursive substitutions`,tst=>{
  language(tst,lang);
  const filename='$& $` $\' {count}';
  assert.equal(t('{filename} · {count}',{filename,count:3}),filename+' · 3');
  assert.equal(t('{count}/{count}/{missing}',{count:0}),'0/0/{missing}');
  assert.equal(t('{name}',Object.create({name:'inherited'})),'{name}');
});
test('unsupported language preferences fall back to Turkish and known messages translate to English',tst=>{
  language(tst,'unsupported');assert.equal(readLanguage(),'tr');assert.equal(t('Taslak kaydedildi.'),'Taslak kaydedildi.');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'en'}});
  assert.equal(t('Taslak kaydedildi.'),'Draft saved.');
});
test('unknown server messages matching object prototype names remain literal text',tst=>{
  language(tst,'en');
  for(const value of ['constructor','toString','__proto__','hasOwnProperty'])assert.equal(t(value),value);
});
