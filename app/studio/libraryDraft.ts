export type LibraryDraft={folder:string;tags:string};
export function libraryDraft(asset:{folder?:string;tags?:string[]}):LibraryDraft{
  return {folder:asset.folder||'',tags:(asset.tags||[]).join(', ')};
}
export function libraryDraftChanged(current:LibraryDraft,baseline:LibraryDraft){return current.folder!==baseline.folder||current.tags!==baseline.tags}

export function canPickLibraryMedia(asset:{id?:unknown;status?:unknown;archived?:unknown}|null|undefined,saving:boolean,uploading:boolean){
  return !saving&&!uploading&&!!asset&&typeof asset.id==='string'&&!!asset.id&&asset.status==='ready'&&asset.archived!==true;
}

// Apply only a confirmed server result, never a guessed mutation outcome.
export function applyLibraryMutation<T extends {id:string;archived:boolean;folder?:string;tags:string[]}>(items:T[],id:string,method:string,result:Partial<T>|null|undefined,filters:{archived:boolean;folder:string;tag:string}){
  if(method==='DELETE')return items.filter(item=>item.id!==id);
  if(result?.id!==id)return items;
  return items.flatMap(item=>{
    if(item.id!==id)return [item];
    const updated={...item,...result};
    return updated.archived!==filters.archived||(filters.folder&&updated.folder!==filters.folder)||(filters.tag&&!updated.tags.includes(filters.tag))?[]:[updated];
  });
}
