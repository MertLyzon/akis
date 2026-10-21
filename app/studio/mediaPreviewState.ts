export type PreviewAsset={id?:string;status?:string;url?:string|null;mime_type?:string;filename?:string};
export function mediaIsProcessing(status:string|undefined){return ['processing','queued','converting'].includes(status||'')}
export function mediaStatusLabel(status:string|undefined){
  return status==='ready'?'Hazır':status==='failed'?'Hazırlanamadı':mediaIsProcessing(status)?'Hazırlanıyor…':'Durum bilinmiyor.';
}
export function postMediaStatus(asset:{note?:string;status?:string}){
  return asset.note||mediaStatusLabel(asset.status);
}
export function readyMediaDetails(asset:{width?:unknown;height?:unknown;size?:unknown},formatSize:(bytes:number)=>string){
  const parts:string[]=[];
  const positiveInteger=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
  if(positiveInteger(asset.width)&&positiveInteger(asset.height))parts.push(`${asset.width} × ${asset.height}`);
  if(typeof asset.size==='number'&&Number.isFinite(asset.size)&&asset.size>=0)parts.push(formatSize(asset.size));
  return parts.join(' · ')||'Hazır';
}
export function mediaPreviewState(asset:PreviewAsset|null|undefined){
  if(!asset)return 'empty';
  if(asset.status==='failed')return 'failed';
  if(mediaIsProcessing(asset.status))return 'processing';
  if(asset.status!=='ready'||!asset.url)return 'unavailable';
  if(asset.mime_type?.startsWith('image/'))return 'image';
  if(asset.mime_type?.startsWith('video/'))return 'video';
  return 'unavailable';
}
