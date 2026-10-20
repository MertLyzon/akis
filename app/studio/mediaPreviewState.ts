export type PreviewAsset={id?:string;status?:string;url?:string|null;mime_type?:string;filename?:string};
export function mediaPreviewState(asset:PreviewAsset|null|undefined){
  if(!asset)return 'empty';
  if(asset.status==='failed')return 'failed';
  if(['processing','queued','converting'].includes(asset.status||''))return 'processing';
  if(asset.status!=='ready'||!asset.url)return 'unavailable';
  if(asset.mime_type?.startsWith('image/'))return 'image';
  if(asset.mime_type?.startsWith('video/'))return 'video';
  return 'unavailable';
}
