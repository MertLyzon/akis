export type LibraryDraft={folder:string;tags:string};
export function libraryDraft(asset:{folder?:string;tags?:string[]}):LibraryDraft{
  return {folder:asset.folder||'',tags:(asset.tags||[]).join(', ')};
}
export function libraryDraftChanged(current:LibraryDraft,baseline:LibraryDraft){return current.folder!==baseline.folder||current.tags!==baseline.tags}
