import {useCallback,useEffect,useRef,useState} from 'react';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {FileVideo,Folder,Tag,Archive,Trash2,Send,Search,Loader2,Cloud} from 'lucide-react';
import {toast} from 'sonner';
import {api,bytes,mediaSrc} from './api';
import MediaUpload from './MediaUpload';
import {t} from './i18n';
import {KeyedActions,LatestRequest} from './libraryRequests';

export default function Library({can,maxMB,onUse,onBusy,picker=false}:any){
const [uploadBusy,setUploadBusy]=useState(false);
const actions=useRef(new KeyedActions()),requests=useRef(new LatestRequest()),mounted=useRef(true);
const [active,setActive]=useState(new Set<string>()),[deleting,setDeleting]=useState<any>(null);
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;requests.current.invalidate()}},[]);
function uploadStatus(busy:boolean){setUploadBusy(busy);onBusy?.(busy)}
const [items,setItems]=useState<any[]>([]),[folders,setFolders]=useState<string[]>([]),[folder,setFolder]=useState(''),[tag,setTag]=useState(''),[q,setQ]=useState(''),[search,setSearch]=useState(''),[archived,setArchived]=useState(false),[loading,setLoading]=useState(true),[editing,setEditing]=useState<string|null>(null);
// Search waits for a typing pause instead of querying on every keystroke.
useEffect(()=>{const id=setTimeout(()=>setSearch(q.trim()),300);return()=>clearTimeout(id)},[q]);
const load=useCallback(()=>{if(!mounted.current)return Promise.resolve();return requests.current.run(()=>api('media?'+new URLSearchParams({folder,tag,q:search,archived:String(archived)})),r=>{setItems(r.items);setFolders(r.folders)},(e:any)=>toast.error(t(e.message)),()=>setLoading(false))},[folder,tag,search,archived]);
const latestLoad=useRef(load);latestLoad.current=load;
useEffect(()=>{setLoading(true);load();return()=>requests.current.invalidate()},[load]);
useEffect(()=>{if(!items.some(a=>['processing','queued','converting'].includes(a.status)))return;const id=setTimeout(load,3000);return()=>clearTimeout(id)},[items,load]);
async function mutate(a:any,changes:any,method:string,msg:string){
try{return await actions.current.run(a.id,async()=>{
setActive(previous=>new Set(previous).add(a.id));
try{await api('media/'+a.id,changes,method);if(mounted.current){toast.success(msg);if(method==='DELETE')setDeleting(null);else setEditing(current=>current===a.id?null:current);await latestLoad.current()}}
finally{if(mounted.current)setActive(previous=>{const next=new Set(previous);next.delete(a.id);return next})}
})}catch(e:any){if(mounted.current){toast.error(t(e.message));if(e.status===404||e.status===409)await latestLoad.current()}return false}
}
function save(a:any,changes:any,msg:string){return mutate(a,changes,'PATCH',msg)}
function remove(){if(deleting)return mutate(deleting,{},'DELETE',t('Medya silindi.'))}
const tags=[...new Set(items.flatMap(a=>a.tags))].sort();
return <div className="library">{can('media')&&!picker&&<section className="panel library-upload"><MediaUpload asset={null} onUploaded={()=>load()} onRemove={()=>{}} onBusy={uploadStatus} maxMB={maxMB} multiple/></section>}
<div className="library-filters"><label className="search-field"><Search size={15}/><input placeholder={t('Dosya adında ara')} value={q} onChange={e=>setQ(e.target.value)}/></label><select value={folder} onChange={e=>setFolder(e.target.value)} aria-label={t('Klasör')}><option value="">{t('Tüm klasörler')}</option>{folders.map(f=><option key={f}>{f}</option>)}</select><select value={tag} onChange={e=>setTag(e.target.value)} aria-label={t('Etiket')}><option value="">{t('Tüm etiketler')}</option>{tags.map(tg=><option key={tg}>{tg}</option>)}</select>{!picker&&<label className="inline-options"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>{t('Arşiv')}</label>}</div>
{loading?<div className="empty-state"><Loader2 className="spin"/>{t('Kütüphane yükleniyor…')}</div>:!items.length?<div className="empty-state"><Folder size={36}/><h3>{t(archived?'Arşiv boş.':'Kütüphanende henüz medya yok.')}</h3><p>{t('Yüklediğin görseller ve videolar burada toplanır; tekrar yüklemeden yeni içeriklerde kullanabilirsin.')}</p></div>:
<div className="library-grid">{items.map(a=><article key={a.id} aria-busy={active.has(a.id)} className={'library-card '+(a.status==='failed'?'asset-failed':'')}>
<div className="library-thumb">{a.url&&a.mime_type.startsWith('image')?<img src={mediaSrc(a.url)} alt={a.filename} loading="lazy" decoding="async"/>:a.url?<video src={mediaSrc(a.url)} muted preload="metadata"/>:a.status==='failed'?<FileVideo size={30}/>:<Loader2 className="spin" size={26}/>}{a.stored==='cloudinary'&&<span className="cloud-badge" title={t("Cloudinary'de saklanıyor")}><Cloud size={12}/></span>}</div>
<div className="library-info"><strong title={a.filename}>{a.filename}</strong><small>{a.status==='ready'?`${a.width}×${a.height} · ${bytes(a.size)}`:a.status==='failed'?(a.error||t('Hazırlanamadı')):t('Hazırlanıyor…')}</small>
<div className="library-labels">{a.folder&&<span className="pill"><Folder size={11}/>{a.folder}</span>}{a.tags.map((t:string)=><span key={t} className="pill"><Tag size={11}/>{t}</span>)}</div>
{editing===a.id?<form className="library-edit" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save(a,{folder:String(f.get('folder')||''),tags:String(f.get('tags')||'').split(',')},t('Medya bilgileri kaydedildi.'))}}><input name="folder" disabled={active.has(a.id)} defaultValue={a.folder} placeholder={t('Klasör')} list="akis-folders"/><input name="tags" disabled={active.has(a.id)} defaultValue={a.tags.join(', ')} placeholder={t('Etiketler, virgülle')}/><datalist id="akis-folders">{folders.map(f=><option key={f} value={f}/>)}</datalist><button className="primary" disabled={active.has(a.id)}>{t(active.has(a.id)?'İşlem sürüyor…':'Kaydet')}</button><button type="button" className="text-button" disabled={active.has(a.id)} onClick={()=>setEditing(null)}>{t('Vazgeç')}</button></form>:
<div className="library-actions">{active.has(a.id)&&<span role="status"><Loader2 size={14} className="spin"/>{t('İşlem sürüyor…')}</span>}{a.status==='ready'&&onUse&&<button className="primary" disabled={uploadBusy||active.has(a.id)} onClick={()=>onUse(a)}><Send size={14}/>{t(picker?'Seç':'Yeni içerikte kullan')}</button>}{can('media')&&!picker&&<><button className="icon-button" disabled={active.has(a.id)} title={t('Klasör ve etiket')} aria-label={t('Klasör ve etiket düzenle')} onClick={()=>setEditing(a.id)}><Tag size={15}/></button><button className="icon-button" disabled={active.has(a.id)} title={t(a.archived?'Arşivden çıkar':'Arşivle')} aria-label={t(a.archived?'Arşivden çıkar':'Arşivle')} onClick={()=>save(a,{archived:!a.archived},t(a.archived?'Arşivden çıkarıldı.':'Arşivlendi.'))}><Archive size={15}/></button><button className="icon-button" disabled={active.has(a.id)} title={t('Sil')} aria-label={t('Sil')} onClick={()=>{if(!actions.current.has(a.id))setDeleting(a)}}><Trash2 size={15}/></button></>}</div>}</div></article>)}</div>}
<AlertDialog open={!!deleting} onOpenChange={open=>{if(!open&&(!deleting||!actions.current.has(deleting.id)))setDeleting(null)}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('Medyayı sil')}</AlertDialogTitle><AlertDialogDescription>{t('"{filename}" kalıcı olarak silinsin mi?',{filename:deleting?.filename||''})} {t('Bu işlem geri alınamaz.')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={!!deleting&&active.has(deleting.id)}>{t('Vazgeç')}</AlertDialogCancel><AlertDialogAction disabled={!!deleting&&active.has(deleting.id)} onClick={event=>{event.preventDefault();remove()}}>{t(deleting&&active.has(deleting.id)?'İşlem sürüyor…':'Sil')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
</div>}
