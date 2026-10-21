type StageGuard={saving:boolean;uploading:boolean;editorDirty:boolean;navigation:{pending:boolean;sensitive:boolean;dirty?:boolean}};

// External editor entry points must respect the same unsaved work as navigation.
// Return only validated text; this helper never saves, uploads or publishes anything.
export function stageEditorText(input:unknown,guard:StageGuard):string{
  if(guard.saving||guard.uploading||guard.editorDirty||guard.navigation.pending||guard.navigation.sensitive||guard.navigation.dirty)
    throw Error('Önce bu ekrandaki işlemi tamamla, değişikliklerini kaydet ve tek seferlik bilgileri kapat.');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='text'))throw Error('Geçersiz metin');
  const text=(input as {text?:unknown}).text;
  if(typeof text!=='string'||text.length>5000)throw Error('Geçersiz metin');
  return text;
}
