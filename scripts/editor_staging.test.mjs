import test from 'node:test';
import assert from 'node:assert/strict';
import {stageEditorText} from '../app/studio/editorStaging.ts';

const clean=()=>({saving:false,uploading:false,editorDirty:false,navigation:{pending:false,sensitive:false,dirty:false}});
test('external staging accepts only text for a clean idle editor without transforming it',()=>{
  for(const text of ['', 'Test content\nwith a line break', 'x'.repeat(5000)])assert.equal(stageEditorText({text},clean()),text);
});
for(const flag of ['saving','uploading','editorDirty'])test(`external staging protects ${flag} before replacing any text`,()=>{
  assert.throws(()=>stageEditorText({text:'replacement'},{...clean(),[flag]:true}),/Önce bu ekrandaki işlemi tamamla/);
});
for(const flag of ['pending','sensitive','dirty'])test(`external staging protects another screen's ${flag} state`,()=>{
  const guard=clean();guard.navigation[flag]=true;
  assert.throws(()=>stageEditorText({text:'replacement'},guard),/Önce bu ekrandaki işlemi tamamla/);
});
test('invalid external staging inputs are refused instead of clearing or coercing the draft',()=>{
  for(const input of [null,undefined,[],{},'',{text:null},{text:123},{text:'x'.repeat(5001)},{text:'hello',publish:true}])assert.throws(()=>stageEditorText(input,clean()),/Geçersiz metin/);
});
