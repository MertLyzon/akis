import {useState} from 'react';
import {FileVideo,Layers3,Loader2,RefreshCw} from 'lucide-react';
import {mediaSrc} from './api';
import {t} from './i18n';
import {mediaPreviewState} from './mediaPreviewState';
import type {PreviewAsset} from './mediaPreviewState';

export default function MediaPreview({asset,compact=false}:{asset?:PreviewAsset|null;compact?:boolean}){
  return <PreviewResource key={`${asset?.id}:${asset?.url}:${asset?.status}:${asset?.mime_type}`} asset={asset} compact={compact}/>;
}
function PreviewResource({asset,compact}:{asset?:PreviewAsset|null;compact:boolean}){
  const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  const state=mediaPreviewState(asset),resource=state==='image'||state==='video';
  if(resource&&!failed){
    const src=mediaSrc(asset?.url),alt=asset?.filename||t('Paylaşılacak medya');
    return state==='image'?<img key={attempt} src={src} alt={alt} loading={compact?'lazy':'eager'} decoding="async" onError={()=>setFailed(true)}/>:<video key={attempt} src={src} aria-label={alt} controls={!compact} playsInline muted preload="metadata" onError={()=>setFailed(true)}/>;
  }
  const message=failed?'Önizleme yüklenemedi.':state==='empty'?'Fikrine yer aç.':state==='processing'?'Medya hazırlanıyor…':state==='failed'?'Dosya hazırlanamadı':'Önizleme bağlantısı yok.';
  const Icon=state==='processing'?Loader2:state==='empty'?Layers3:FileVideo;
  return <div className={'media-preview-fallback '+(compact?'compact':'')} data-preview-state={failed?'error':state} role={compact?undefined:'status'}>
    <Icon size={compact?26:32} className={state==='processing'?'spin':''} aria-hidden="true"/><span>{t(message)}</span>
    {!compact&&<small>{t(state==='empty'?'Dosyanı yükle, burada görüntüle.':failed?'Bu yalnızca önizleme hatasıdır; dosya kaydı değiştirilmedi.':state==='processing'?'Dosya hazır olduğunda önizleme burada görünecek.':'Dosyanın durumunu medya kütüphanesinden kontrol edebilirsin.')}</small>}
    {failed&&resource&&<button className="inline-link preview-retry" type="button" onClick={()=>{setAttempt(value=>value+1);setFailed(false)}}><RefreshCw size={13} aria-hidden="true"/>{t('Önizlemeyi tekrar dene')}</button>}
  </div>;
}
