import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCommands} from '../app/studio/commandSearch.ts';

const items=[{id:'compose',name:'İçerik oluştur'},{id:'team',name:'Şirket yönetimi'},{id:'settings',name:'Ayarlar'},{id:'library',name:'Media library'}];
test('command search accepts Turkish upper/lower casing and an ASCII keyboard',()=>{
  for(const query of ['İÇERİK','içerik','ICERIK','  icerik  ','ic\u0327erik'])assert.deepEqual(filterCommands(items,query).map(item=>item.id),['compose']);
  for(const query of ['ŞİRKET','sirket yonetimi','şirket yönetimi'])assert.deepEqual(filterCommands(items,query).map(item=>item.id),['team']);
});
test('English command names remain searchable even with Turkish I case folding',()=>{
  assert.deepEqual(filterCommands(items,'LIBRARY').map(item=>item.id),['library']);
  assert.deepEqual(filterCommands(items,'AYARLAR').map(item=>item.id),['settings']);
});
test('empty and unmatched command searches preserve item order and never mutate labels',()=>{
  const before=JSON.stringify(items);
  assert.equal(filterCommands(items,'  '),items);
  assert.deepEqual(filterCommands(items,'not a screen'),[]);
  assert.deepEqual(filterCommands(items,'i').map(item=>item.id),['compose','team','library']);
  assert.equal(JSON.stringify(items),before);
});
