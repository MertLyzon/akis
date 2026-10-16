import {ChangeEvent,useEffect,useRef,useState} from 'react';
import {UploadCloud,Loader2,FileVideo,Trash2,CheckCircle2,X} from 'lucide-react';
import {toast} from 'sonner';
import {companyHeader,authHeaders,apiUrl,mediaSrc} from './api';
import {t} from './i18n';
import {UploadQueue} from './uploadQueue';

const acceptedMedia='image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm';

export default function MediaUpload({asset,onUploaded,onRemove,onBusy,maxMB=100,onLibrary,multiple=false,disabled=false}:any){
  const input=useRef<HTMLInputElement>(null),mounted=useRef(true);
  const [progress,setProgress]=useState<number|null>(null),[drag,setDrag]=useState(false),[queued,setQueued]=useState(0);
  const callbacks=useRef({onUploaded,onBusy,multiple});
  callbacks.current={onUploaded,onBusy,multiple};
  const uploader=useRef<UploadQueue|null>(null);
  if(!uploader.current)uploader.current=new UploadQueue({
    onChange:state=>{if(mounted.current){setProgress(state.progress);setQueued(state.queued);if(state.progress===null&&input.current)input.current.value=''}},
    onBusy:busy=>callbacks.current.onBusy?.(busy),
    onSuccess:(result,file)=>{callbacks.current.onUploaded(result);toast.success(callbacks.current.multiple?`${file.name} ${t('yüklendi.')}`:t('Dosya yüklendi, paylaşım için hazırlanıyor.'))},
    onError:(message,file,skipped)=>toast.error((callbacks.current.multiple?`${file.name}: `:'')+t(message)+(skipped?' '+t('Kuyruktaki {count} dosya başlatılmadı.',{count:skipped}):'')),
  });
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;uploader.current?.cancel()}},[]);

  function enqueue(files:File[]){
    if(disabled)return;
    const result=uploader.current!.enqueue(files,{url:apiUrl('media'),headers:{...companyHeader(),...authHeaders()},maxBytes:maxMB*1024*1024,multiple});
    if(result.oversized)toast.error(t('{count} dosya {max} MB sınırını aştığı için atlandı.',{count:result.oversized,max:maxMB}));
    if(result.duplicates)toast.info(t('{count} dosya zaten yükleme sırasında olduğu için tekrar eklenmedi.',{count:result.duplicates}));
  }
  function choose(){
    if(disabled||!input.current||uploader.current!.isBusy)return;
    input.current.value='';input.current.click();
  }
  function selected(event:ChangeEvent<HTMLInputElement>){enqueue(Array.from(event.currentTarget.files||[]))}
  function stop(){uploader.current?.cancel();toast.info(t('Yükleme durduruldu. Tamamlanan dosyalar kütüphanede kalır.'))}

  return <div className="media-uploader" aria-busy={progress!==null} onDragOver={event=>{event.preventDefault();if(!disabled)setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={event=>{event.preventDefault();setDrag(false);if(!asset)enqueue(Array.from(event.dataTransfer.files))}}>
    <input ref={input} className="sr-only" tabIndex={-1} type="file" accept={acceptedMedia} multiple={multiple} disabled={disabled||progress!==null} aria-label={t('Medya dosyası seç')} onChange={selected}/>
    {!asset?<>
      <button type="button" className={'dropzone '+(drag?'dragging':'')} disabled={disabled||progress!==null} onClick={choose}>
        {progress!==null?<Loader2 className="spin" size={28}/>:<UploadCloud size={30}/>}<strong>{progress!==null?`${t('Yükleniyor')} · %${progress}${queued?` · ${queued} ${t('dosya sırada')}`:''}`:t(multiple?'Dosyalarını buraya bırak veya seç':'Dosyanı buraya bırak veya seç')}</strong><span>{t('Görsel veya video · En fazla')} {maxMB} MB</span><small>{t('JPG, JPEG, PNG, WebP ve HEIC dahil. Biçim ve boyutları biz hazırlıyoruz.')}</small>{progress!==null&&<progress value={progress} max={100} aria-label={t('Yükleme ilerlemesi')}/>}
      </button>
      {onLibrary&&progress===null&&<button type="button" className="inline-link library-pick" disabled={disabled} onClick={onLibrary}>{t('veya medya kütüphanesinden seç')}</button>}
    </>:<div className={'asset-card '+(asset.status==='failed'?'asset-failed':'')}>
      {asset.url&&asset.mime_type.startsWith('image')?<img src={mediaSrc(asset.url)} alt={t('Yüklenen görsel önizlemesi')}/>:<FileVideo size={35}/>}<div><strong>{asset.filename}</strong><span>{asset.status==='ready'?`${asset.width} × ${asset.height} · ${(asset.size/1024/1024).toFixed(1)} MB`:t(asset.status==='failed'?'Dosya hazırlanamadı':'Dosya hazırlanıyor…')}</span><p>{asset.error||asset.note}</p></div>{asset.status==='ready'?<CheckCircle2 className="ready-icon" size={18}/>:asset.status!=='failed'&&<Loader2 className="spin" size={18}/>}<button className="icon-button" title={t('Medyayı içerikten kaldır')} aria-label={t('Medyayı içerikten kaldır')} disabled={disabled||progress!==null} onClick={onRemove}><Trash2 size={17}/></button>
    </div>}
    {progress!==null&&<button type="button" className="secondary" onClick={stop}><X size={16}/>{t('Yüklemeyi durdur')}</button>}
  </div>
}
