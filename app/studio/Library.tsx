import {useCallback,useEffect,useRef,useState} from 'react';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {Folder,Tag,Archive,Trash2,Send,Search,Loader2,Cloud} from 'lucide-react';
import {toast} from 'sonner';
import {api,bytes} from './api';
import MediaPreview from './MediaPreview';
import MediaUpload from './MediaUpload';
import {t} from './i18n';
import {KeyedActions,LatestRequest} from './libraryRequests';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {LibraryDraft,libraryDraft,libraryDraftChanged,applyLibraryMutation} from './libraryDraft';
import {saveThenRefresh} from './settingsSave';
import {useNavigationSafety} from './useNavigationSafety';
import {libraryFilterOptions,libraryEmptyTitle} from './libraryFilters';
import {mediaStatusLabel,readyMediaDetails} from './mediaPreviewState';

export default function Library({can,maxMB,onUse,onBusy,picker=false}:any){
const [uploadBusy,setUploadBusy]=useState(false);
const actions=useRef(new KeyedActions()),requests=useRef(new LatestRequest()),mounted=useRef(true);
const readActions=useRef(new KeyedActions());
const [active,setActive]=useState(new Set<string>()),[deleting,setDeleting]=useState<any>(null);
const [editing,setEditing]=useState<{asset:{id:string;filename:string};draft:LibraryDraft;baseline:LibraryDraft}|null>(null),[discardEdit,setDiscardEdit]=useState(false),[editError,setEditError]=useState('');
const dirty=!!editing&&libraryDraftChanged(editing.draft,editing.baseline);
const reportPending=useNavigationSafety(undefined,false,dirty);
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;requests.current.invalidate()}},[]);
function uploadStatus(busy:boolean){setUploadBusy(busy);onBusy?.(busy)}
const [items,setItems]=useState<any[]>([]),[folders,setFolders]=useState<string[]>([]),[folder,setFolder]=useState(''),[tag,setTag]=useState(''),[q,setQ]=useState(''),[search,setSearch]=useState(''),[archived,setArchived]=useState(false),[loading,setLoading]=useState(true);
const [loadError,setLoadError]=useState(''),[reading,setReading]=useState(false),[loadedQuery,setLoadedQuery]=useState('');
const searchInput=useRef<HTMLInputElement>(null);
const searchPending=q.trim()!==search,filtered=!!(folder||tag||q.trim()||archived);
const query=new URLSearchParams({folder,tag,q:search,archived:String(archived)}).toString();
const currentFilters=useRef({folder,tag,archived});currentFilters.current={folder,tag,archived};
// Search waits for a typing pause instead of querying on every keystroke.
useEffect(()=>{const id=setTimeout(()=>setSearch(q.trim()),300);return()=>clearTimeout(id)},[q]);
const load=useCallback(()=>{if(!mounted.current)return Promise.resolve(false);setReading(true);return requests.current.run(()=>api('media?'+query),r=>{setItems(r.items);setFolders(r.folders);setLoadedQuery(query);setLoadError('')},(e:any)=>setLoadError(e.message),()=>{setLoading(false);setReading(false)})},[query]);
const latestLoad=useRef(load);latestLoad.current=load;
async function retryList(){await readActions.current.run('list-read',async()=>{await latestLoad.current()})}
useEffect(()=>{setLoading(true);load();return()=>requests.current.invalidate()},[load]);
useEffect(()=>{if(!items.some(a=>['processing','queued','converting'].includes(a.status)))return;const id=setTimeout(load,3000);return()=>clearTimeout(id)},[items,load]);
async function mutate(a:any,changes:any,method:string,msg:string){
try{return await actions.current.run(a.id,async()=>{
reportPending(true);setActive(previous=>new Set(previous).add(a.id));
let result:any;
try{await saveThenRefresh({save:async()=>{result=await api('media/'+a.id,changes,method)},saved:()=>{if(mounted.current){requests.current.invalidate();setItems(current=>applyLibraryMutation(current,a.id,method,result,currentFilters.current));toast.success(msg);if(method==='DELETE')setDeleting(null);else setEditing(current=>current?.asset.id===a.id?null:current)}},refresh:async()=>{if(mounted.current)return latestLoad.current()},refreshFailed:()=>{if(mounted.current)toast.warning(t('İşlem tamamlandı ancak medya listesi yenilenemedi. İşlemi tekrarlamadan listeyi yenile.'))}})}
finally{if(mounted.current)setActive(previous=>{const next=new Set(previous);next.delete(a.id);return next})}
})}catch(e:any){if(mounted.current){toast.error(t(e.message));if(editing?.asset.id===a.id)setEditError(e.message);if(e.status===404||e.status===409)await latestLoad.current()}return false}
finally{if(mounted.current)reportPending(actions.current.size>0)}
}
function save(a:any,changes:any,msg:string){return mutate(a,changes,'PATCH',msg)}
function remove(){if(deleting)return mutate(deleting,{},'DELETE',t('Medya silindi.'))}
function openEditor(asset:any){if(actions.current.has(asset.id))return;const draft=libraryDraft(asset);setEditError('');setDiscardEdit(false);setEditing({asset:{id:asset.id,filename:asset.filename},draft,baseline:{...draft}})}
function closeEditor(){if(editing&&actions.current.has(editing.asset.id))return;if(dirty)setDiscardEdit(true);else setEditing(null)}
function saveEditor(event:any){event.preventDefault();if(editing){setEditError('');return save(editing.asset,{folder:editing.draft.folder,tags:editing.draft.tags.split(',')},t('Medya bilgileri kaydedildi.'))}}
function clearFilters(){setQ('');setSearch('');setFolder('');setTag('');setArchived(false);searchInput.current?.focus()}
const tags=libraryFilterOptions(items.flatMap(a=>a.tags),tag),folderOptions=libraryFilterOptions(folders,folder);
return <div className="library">{can('media')&&!picker&&<section className="panel library-upload"><MediaUpload asset={null} onUploaded={()=>latestLoad.current()} onRemove={()=>{}} onBusy={uploadStatus} maxMB={maxMB} multiple/></section>}
<div className="library-filters"><label className="search-field"><Search size={15} aria-hidden="true"/><input ref={searchInput} type="search" aria-label={t('Dosya adında ara')} placeholder={t('Dosya adında ara')} value={q} onChange={e=>setQ(e.target.value)}/></label><select value={folder} onChange={e=>setFolder(e.target.value)} aria-label={t('Klasör')}><option value="">{t('Tüm klasörler')}</option>{folderOptions.map(f=><option key={f}>{f}</option>)}</select><select value={tag} onChange={e=>setTag(e.target.value)} aria-label={t('Etiket')}><option value="">{t('Tüm etiketler')}</option>{tags.map(tg=><option key={tg}>{tg}</option>)}</select>{!picker&&<label className="inline-options"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>{t('Arşiv')}</label>}</div>
<div className="library-results-summary"><span role="status" aria-live="polite">{t(searchPending?'Aranıyor…':reading?'Kütüphane yükleniyor…':loadError||loadedQuery!==query?'Güncel liste bekleniyor.':items.length>=500?'İlk {count} dosya gösteriliyor. Arama veya filtreyle daralt.':'{count} dosya gösteriliyor',{count:items.length})}</span>{filtered&&<button className="inline-link" type="button" onClick={clearFilters}>{t('Filtreleri temizle')}</button>}</div>
{loadError&&<p className="error" role="alert">{t(loadError)} <button type="button" className="inline-link" disabled={reading} onClick={()=>void retryList()}>{t('Tekrar dene')}</button></p>}
{!loading&&items.length>0&&loadedQuery!==query&&<p role="status">{t('Önceki filtrenin sonuçları gösteriliyor. Güncel liste için tekrar dene.')}</p>}
{loading||searchPending?<div className="empty-state" aria-busy="true"><Loader2 className="spin" aria-hidden="true"/>{t('Kütüphane yükleniyor…')}</div>:!items.length?<div className="empty-state"><Folder size={36} aria-hidden="true"/><h3>{t(libraryEmptyTitle({folder,tag,q,archived},loadError))}</h3><p>{t(loadError?'Bağlantını kontrol edip tekrar dene.':filtered?'Dosya adını değiştir veya tüm dosyaları görmek için filtreleri temizle.':'Yüklediğin görseller ve videolar burada toplanır; tekrar yüklemeden yeni içeriklerde kullanabilirsin.')}</p></div>:
<div className="library-grid">{items.map(a=><article key={a.id} aria-busy={active.has(a.id)} className={'library-card '+(a.status==='failed'?'asset-failed':'')}>
<div className="library-thumb"><MediaPreview asset={a} compact/>{a.stored==='cloudinary'&&<span className="cloud-badge" title={t("Cloudinary'de saklanıyor")}><Cloud size={12}/></span>}</div>
<div className="library-info"><strong title={a.filename}>{a.filename}</strong><small>{t(a.status==='ready'?readyMediaDetails(a,bytes):a.status==='failed'&&a.error?a.error:mediaStatusLabel(a.status))}</small>
<div className="library-labels">{a.folder&&<span className="pill"><Folder size={11}/>{a.folder}</span>}{a.tags.map((t:string)=><span key={t} className="pill"><Tag size={11}/>{t}</span>)}</div>
<div className="library-actions">{active.has(a.id)&&<span role="status"><Loader2 size={14} className="spin"/>{t('İşlem sürüyor…')}</span>}{a.status==='ready'&&onUse&&<button className="primary" disabled={uploadBusy||active.has(a.id)} onClick={()=>onUse(a)}><Send size={14}/>{t(picker?'Seç':'Yeni içerikte kullan')}</button>}{can('media')&&!picker&&<><button className="icon-button" disabled={active.has(a.id)} title={t('Klasör ve etiket')} aria-label={t('Klasör ve etiket düzenle')} onClick={()=>openEditor(a)}><Tag size={15}/></button><button className="icon-button" disabled={active.has(a.id)} title={t(a.archived?'Arşivden çıkar':'Arşivle')} aria-label={t(a.archived?'Arşivden çıkar':'Arşivle')} onClick={()=>save(a,{archived:!a.archived},t(a.archived?'Arşivden çıkarıldı.':'Arşivlendi.'))}><Archive size={15}/></button><button className="icon-button" disabled={active.has(a.id)} title={t('Sil')} aria-label={t('Sil')} onClick={()=>{if(!actions.current.has(a.id))setDeleting(a)}}><Trash2 size={15}/></button></>}</div></div></article>)}</div>}
<Dialog open={!!editing} onOpenChange={open=>{if(!open)closeEditor()}}><DialogContent showCloseButton={false} className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t('Klasör ve etiket düzenle')}</DialogTitle><DialogDescription className="break-all">{editing?.asset.filename}</DialogDescription></DialogHeader>
{editing&&<form aria-label={t('Medya bilgileri')} onSubmit={saveEditor} className="grid gap-4" aria-busy={active.has(editing.asset.id)}>
<label className="grid gap-2">{t('Klasör')}<input name="folder" disabled={active.has(editing.asset.id)} value={editing.draft.folder} maxLength={80} onChange={event=>setEditing(current=>current?{...current,draft:{...current.draft,folder:event.target.value}}:current)} list="akis-folders"/></label>
<label className="grid gap-2">{t('Etiketler, virgülle')}<input name="tags" disabled={active.has(editing.asset.id)} value={editing.draft.tags} onChange={event=>setEditing(current=>current?{...current,draft:{...current.draft,tags:event.target.value}}:current)}/></label>
<datalist id="akis-folders">{folders.map(f=><option key={f} value={f}/>)}</datalist>
{editError&&<p className="error" role="alert">{t(editError)}</p>}
<DialogFooter><button type="button" className="text-button" disabled={active.has(editing.asset.id)} onClick={closeEditor}>{t('Vazgeç')}</button><button className="primary" disabled={active.has(editing.asset.id)}>{t(active.has(editing.asset.id)?'İşlem sürüyor…':'Kaydet')}</button></DialogFooter>
</form>}</DialogContent></Dialog>
<AlertDialog open={discardEdit&&!!editing} onOpenChange={setDiscardEdit}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('Kaydedilmemiş değişiklikler')}</AlertDialogTitle><AlertDialogDescription>{t('Kaydedilmemiş değişikliklerin var. Bu değişiklikleri bırakıp devam etmek istiyor musun?')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('Düzenlemeye devam et')}</AlertDialogCancel><AlertDialogAction onClick={event=>{event.preventDefault();if(editing&&actions.current.has(editing.asset.id))return;setDiscardEdit(false);setEditing(null)}}>{t('Değişiklikleri bırak')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
<AlertDialog open={!!deleting} onOpenChange={open=>{if(!open&&(!deleting||!actions.current.has(deleting.id)))setDeleting(null)}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('Medyayı sil')}</AlertDialogTitle><AlertDialogDescription>{t('"{filename}" kalıcı olarak silinsin mi?',{filename:deleting?.filename||''})} {t('Bu işlem geri alınamaz.')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={!!deleting&&active.has(deleting.id)}>{t('Vazgeç')}</AlertDialogCancel><AlertDialogAction disabled={!!deleting&&active.has(deleting.id)} onClick={event=>{event.preventDefault();remove()}}>{t(deleting&&active.has(deleting.id)?'İşlem sürüyor…':'Sil')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
</div>}
