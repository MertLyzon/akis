import {ChangeEvent,useRef,useState} from 'react';
import {UploadCloud,Loader2,FileVideo,Trash2,CheckCircle2} from 'lucide-react';
import {toast} from 'sonner';
import {companyHeader,authHeaders,apiUrl,mediaSrc} from './api';
import {t} from './i18n';

const acceptedMedia='image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm';

export default function MediaUpload({asset,onUploaded,onRemove,onBusy,maxMB=100,onLibrary,multiple=false}:any){
  const input=useRef<HTMLInputElement>(null);
  const [progress,setProgress]=useState<number|null>(null),[drag,setDrag]=useState(false),[queued,setQueued]=useState(0);
  const queue=useRef<File[]>([]);

  // Library accepts several files at once; they upload one after another with the same progress bar.
  function enqueue(files:File[]){
    const fits=files.filter(f=>f.size<=maxMB*1024*1024);
    if(fits.length<files.length)toast.error(t('{count} dosya {max} MB sınırını aştığı için atlandı.',{count:files.length-fits.length,max:maxMB}));
    if(!fits.length)return;
    if(!multiple){upload(fits[0]);return}
    queue.current.push(...fits);setQueued(queue.current.length);
    if(progress===null)next();
  }
  function next(){const file=queue.current.shift();setQueued(queue.current.length);if(file)upload(file,true)}

  function upload(file?:File,fromQueue=false){
    if(!file||(progress!==null&&!fromQueue))return;
    if(file.size>maxMB*1024*1024){toast.error(t('Dosya en fazla {max} MB olabilir.',{max:maxMB}));return}
    const data=new FormData();data.append('file',file,file.name);
    setProgress(0);onBusy(true);
    const xhr=new XMLHttpRequest();
    xhr.open('POST',apiUrl('media'));
    for(const [k,v] of Object.entries({...companyHeader(),...authHeaders()}))xhr.setRequestHeader(k,v);
    // Large videos on slow connections need more than two minutes; stalls are still reported by onerror.
    xhr.timeout=30*60*1000;
    xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(Math.round(e.loaded/e.total*100))};
    const finish=()=>{setProgress(null);onBusy(false);if(input.current)input.current.value='';if(multiple&&queue.current.length)next()};
    xhr.onerror=()=>{toast.error((multiple?`${file.name}: `:'')+t('Yükleme tamamlanamadı. Bağlantını kontrol et.'));finish()};
    xhr.ontimeout=()=>{toast.error(t('Dosya yükleme zaman aşımına uğradı.'));finish()};
    xhr.onload=()=>{try{let r:any={};try{r=JSON.parse(xhr.responseText)}catch{}if(xhr.status>=400)throw Error(r.error||'Dosya yüklenemedi');onUploaded(r);toast.success(multiple?`${file.name} ${t('yüklendi.')}`:t('Dosya yüklendi, paylaşım için hazırlanıyor.'))}catch(e:any){toast.error(multiple?`${file.name}: ${t(e.message)}`:t(e.message))}finish()};
    xhr.send(data);
  }

  function choose(){
    if(!input.current||progress!==null)return;
    // Safari does not emit change when the same file is selected twice unless the old value is cleared first.
    input.current.value='';
    input.current.click();
  }

  function selected(event:ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.currentTarget.files||[]);
    if(files.length)enqueue(files);
  }

  return <div className="media-uploader">
    <input ref={input} className="sr-only" tabIndex={-1} type="file" accept={acceptedMedia} multiple={multiple} disabled={progress!==null} aria-label={t('Medya dosyası seç')} onChange={selected}/>
    {!asset?<>
      <button type="button" className={'dropzone '+(drag?'dragging':'')} disabled={progress!==null} onClick={choose} onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);enqueue(Array.from(e.dataTransfer.files))}}>
        {progress!==null?<Loader2 className="spin" size={28}/>:<UploadCloud size={30}/>}<strong>{progress!==null?`${t('Yükleniyor')} · %${progress}${queued?` · ${queued} ${t('dosya sırada')}`:''}`:t(multiple?'Dosyalarını buraya bırak veya seç':'Dosyanı buraya bırak veya seç')}</strong><span>{t('Görsel veya video · En fazla')} {maxMB} MB</span><small>{t('JPG, JPEG, PNG, WebP ve HEIC dahil. Biçim ve boyutları biz hazırlıyoruz.')}</small>{progress!==null&&<progress value={progress} max={100} aria-label={t('Yükleme ilerlemesi')}/>}
      </button>
      {onLibrary&&progress===null&&<button type="button" className="inline-link library-pick" onClick={onLibrary}>{t('veya medya kütüphanesinden seç')}</button>}
    </>:<div className={'asset-card '+(asset.status==='failed'?'asset-failed':'')}>
      {asset.url&&asset.mime_type.startsWith('image')?<img src={mediaSrc(asset.url)} alt={t('Yüklenen görsel önizlemesi')}/>:<FileVideo size={35}/>}<div><strong>{asset.filename}</strong><span>{asset.status==='ready'?`${asset.width} × ${asset.height} · ${(asset.size/1024/1024).toFixed(1)} MB`:t(asset.status==='failed'?'Dosya hazırlanamadı':'Dosya hazırlanıyor…')}</span><p>{asset.error||asset.note}</p></div>{asset.status==='ready'?<CheckCircle2 className="ready-icon" size={18}/>:asset.status!=='failed'&&<Loader2 className="spin" size={18}/>}<button className="icon-button" title={t('Medyayı içerikten kaldır')} aria-label={t('Medyayı içerikten kaldır')} onClick={onRemove}><Trash2 size={17}/></button>
    </div>}
  </div>
}
