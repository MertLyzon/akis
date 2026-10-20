import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryFilterOptions,libraryEmptyTitle} from '../app/studio/libraryFilters.ts';

const empty={folder:'',tag:'',q:'',archived:false};
test('empty library, archive and filtered results have distinct titles',()=>{
  assert.equal(libraryEmptyTitle(empty,''),'Kütüphanende henüz medya yok.');
  assert.equal(libraryEmptyTitle({...empty,archived:true},''),'Arşiv boş.');
  for(const filter of [{folder:'Launch'},{tag:'important'},{q:'file.png'},{archived:true,q:'missing'}])assert.equal(libraryEmptyTitle({...empty,...filter},''),'Filtrelerine uyan medya yok.');
  assert.equal(libraryEmptyTitle({...empty,q:'  '},''),'Kütüphanende henüz medya yok.');
});
test('a failed read never pretends the library or current filter is empty',()=>{
  for(const filter of [empty,{...empty,q:'file'},{...empty,archived:true}])assert.equal(libraryEmptyTitle(filter,'offline'),'Medya listesi alınamadı.');
});
test('selected filter remains in the options when no current item contains it',()=>{
  assert.deepEqual(libraryFilterOptions([],'chosen'),['chosen']);
  assert.deepEqual(libraryFilterOptions(['other'],'chosen'),['chosen','other']);
  assert.deepEqual(libraryFilterOptions([],''),[]);
});
test('filter options deduplicate and sort without mutating the original values',()=>{
  const options=['z','a','z'];
  assert.deepEqual(libraryFilterOptions(options,'a'),['a','z']);
  assert.deepEqual(options,['z','a','z']);
});
