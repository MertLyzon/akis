import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {FileText,RefreshCw,Image as ImageIcon,Check,X,CalendarClock,Pencil,Trash2,History,Copy,Search,Loader2} from 'lucide-react';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {Textarea} from '@/components/ui/textarea';
import {toast} from 'sonner';
import {api,platforms,statuses,contentStatuses,outcomes,stages,inZone,mediaSrc} from './api';
import {t} from './i18n';
import {useNavigationSafety} from './useNavigationSafety';
import {saveThenRefresh} from './settingsSave';
import {postFilters,filterPosts,matchesPost,nextPostFilter} from './postFilters';
import {postMediaStatus} from './mediaPreviewState';
import {actionFailure as postActionFailure} from './actionFailure';
import type {PostReadBarrier} from './postReadBarrier';
import {KeyedActions} from './libraryRequests';

export default function Posts({posts,loading,refresh,readBarrier,can,tz,onEdit,onDuplicate,initialFilter='all'}:any){
const [filter,setFilter]=useState(initialFilter),[q,setQ]=useState('');
const filterId=useId(),searchInput=useRef<HTMLInputElement>(null);
const inFlight=useRef(new Set<string>()),mounted=useRef(true);
const reportPending=useNavigationSafety(undefined,false);
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
const [active,setActive]=useState(new Set<string>()),[confirmation,setConfirmation]=useState<{post:any;kind:'reject'|'cancel'|'delete'}|null>(null),[note,setNote]=useState('');
const [confirmationError,setConfirmationError]=useState(''),[confirmationStale,setConfirmationStale]=useState(false);
const [actionErrors,setActionErrors]=useState<Record<string,ReturnType<typeof postActionFailure>&{updatedAt:unknown}>>({});
const barrier:PostReadBarrier=readBarrier,reads=useRef(new KeyedActions());
const [,renderBarrier]=useState(0),[reading,setReading]=useState(false);
const blocked=new Set(barrier.snapshot().keys());
const locked=(id:string)=>active.has(id)||blocked.has(id);
function syncBarrier(){if(mounted.current)renderBarrier(value=>value+1)}
async function readPosts(){const result=await refresh();syncBarrier();return result}
async function reload(){return reads.current.run('list',async()=>{setReading(true);try{if(await readPosts()===false&&mounted.current)toast.warning(t('Gönderi listesi yenilenemedi. Listeyi tekrar yenile.'))}catch{if(mounted.current)toast.warning(t('Gönderi listesi yenilenemedi. Listeyi tekrar yenile.'))}finally{if(mounted.current)setReading(false)}})}
const confirmationBusy=!!confirmation&&active.has(confirmation.post.id);
const needle=q.trim().toLocaleLowerCase('tr');
const shown=useMemo(()=>filterPosts(posts,filter,q),[posts,filter,q]);
const stats=useMemo(()=>[{label:'Toplam içerik',value:posts.length},{label:'Onay bekleyen',value:posts.filter((p:any)=>p.status==='pending_approval').length},{label:'Planlı',value:posts.filter((p:any)=>p.status==='scheduled').length},{label:'Kontrol gerekiyor',value:posts.filter((p:any)=>matchesPost(p,'attention')).length}],[posts]);
async function act(id:string,path:string,body:any,done:string,method?:string){
if(inFlight.current.has(id)||barrier.has(id))return false;
inFlight.current.add(id);reportPending(true);setActive(new Set(inFlight.current));
setActionErrors(current=>{const next={...current};delete next[id];return next});
const refreshFailed=()=>{if(mounted.current){barrier.hold(id);syncBarrier();toast.warning(t('İşlem tamamlandı ancak gönderi listesi yenilenemedi. Listeyi tekrar yenile.'))}};
try{await saveThenRefresh({save:()=>api(path,body,method),saved:()=>{if(mounted.current)toast.success(done)},refresh:async()=>{if(mounted.current)return await readPosts()},refreshFailed});return true}
catch(e:any){if(mounted.current){const failure=postActionFailure(e);setActionErrors(current=>({...current,[id]:{...failure,updatedAt:posts.find((post:any)=>post.id===id)?.updated_at}}));toast.error(t(failure.message));if(confirmation?.post.id===id){setConfirmationError(failure.message);setConfirmationStale(e.status===409||e.status===404)}if(e.status===409||e.status===404)try{await refresh()}catch{toast.warning(t('Gönderi listesi yenilenemedi. Listeyi tekrar yenile.'))}}return false}
finally{inFlight.current.delete(id);if(mounted.current){reportPending(inFlight.current.size>0);setActive(new Set(inFlight.current))}}
}
function ask(post:any,kind:'reject'|'cancel'|'delete'){if(inFlight.current.has(post.id)||barrier.has(post.id))return;setNote('');setConfirmationError('');setConfirmationStale(false);setConfirmation({post,kind})}
async function confirmAction(){
if(!confirmation||confirmationStale)return;
const {post,kind}=confirmation;
if(kind==='reject'&&!note.trim())return;
const done=kind==='reject'?'İçerik reddedildi, editöre not iletildi.':kind==='cancel'?'Plan iptal edildi, içerik taslağa döndü.':'İçerik silindi.';
const ok=await act(post.id,`posts/${post.id}${kind==='delete'?'':'/'+kind}`,{expected_updated_at:post.updated_at,...(kind==='reject'?{note:note.trim()}:{})},t(done),kind==='delete'?'DELETE':undefined);
if(ok&&mounted.current)setConfirmation(null);
}
return <><div className="stats">{stats.map(s=><div className="stat-card" key={s.label}><span>{t(s.label)}</span><strong>{s.value}</strong></div>)}</div>
{blocked.size>0&&<p className="error" role="alert">{t('İşlem tamamlandı ancak gönderi listesi yenilenemedi. Listeyi tekrar yenile.')} <button type="button" disabled={reading||loading} onClick={()=>void reload()}>{t('Listeyi yenile')}</button></p>}
<section className="panel"><div className="panel-head"><div className="filter-tabs" role="tablist" aria-label={t('İçerik filtreleri')}>{postFilters.map(f=><button key={f.id} id={`${filterId}-${f.id}`} type="button" role="tab" aria-selected={filter===f.id} aria-controls={`${filterId}-results`} tabIndex={filter===f.id?0:-1} className={filter===f.id?'active':''} onClick={()=>setFilter(f.id)} onKeyDown={event=>{const next=nextPostFilter(f.id,event.key);if(next){event.preventDefault();setFilter(next);document.getElementById(`${filterId}-${next}`)?.focus()}}}>{t(f.name)}</button>)}</div><label className="search-field"><Search size={15} aria-hidden="true"/><input ref={searchInput} type="search" placeholder={t('İçeriklerde ara')} aria-label={t('İçeriklerde ara')} value={q} onChange={e=>setQ(e.target.value)}/></label><button className="secondary" disabled={loading||reading} onClick={()=>void reload()}><RefreshCw size={14}/>{t('Yenile')}</button></div>
{!loading&&<div className="post-results-summary"><span role="status" aria-live="polite">{t('{shown} / {total} içerik gösteriliyor',{shown:shown.length,total:posts.length})}</span>{(needle||filter!=='all')&&<button type="button" className="inline-link" onClick={()=>{setQ('');setFilter('all');searchInput.current?.focus()}}>{t('Filtreleri temizle')}</button>}</div>}
<div id={`${filterId}-results`} role="tabpanel" aria-labelledby={`${filterId}-${filter}`} tabIndex={0}>
{loading?<div className="empty-state" role="status"><Loader2 className="spin" size={24} aria-hidden="true"/>{t('Gönderiler yükleniyor…')}</div>:!shown.length?<div className="empty-state"><FileText size={36} aria-hidden="true"/><h3>{t(needle?'Aramana uyan içerik yok.':filter==='all'?'İlk paylaşımına yer ayırdık.':'Bu listede içerik yok.')}</h3><p>{t(needle||filter!=='all'?'Aramayı değiştir veya tüm içerikleri görmek için filtreleri temizle.':'Taslaklar, onaylar ve gönderim sonuçları burada görünecek.')}</p></div>:shown.map((p:any)=><article key={p.id} className="post-item" aria-busy={active.has(p.id)}>
<div className="post-meta"><span className={'pill status-'+p.status}>{t(contentStatuses[p.status]||p.status)}</span><span>{inZone(Math.floor(p.created/1000),tz)}</span>{p.created_by&&<span>{t('Hazırlayan')}: {p.created_by}</span>}{p.approved_by&&<span>{t('Onaylayan')}: {p.approved_by}</span>}{p.scheduled_at&&<span className="schedule"><CalendarClock size={14}/>{inZone(p.scheduled_at,tz)}</span>}</div>
<h3>{p.text||p.options.template||t('Medya paylaşımı')}</h3>
{p.asset&&<div className="post-media">{p.asset.url&&p.asset.mime_type?.startsWith('image/')?<img className="post-media-preview" src={mediaSrc(p.asset.url)} alt={p.asset.filename} loading="lazy" decoding="async"/>:<ImageIcon size={15}/>}<span>{p.asset.filename}<small>{t(postMediaStatus(p.asset))}</small></span></div>}
{p.review_note&&<p className={'review-note '+(p.status==='rejected'?'rejected':'')}>{t(p.status==='rejected'?'Red nedeni':'Onay notu')}: {p.review_note}</p>}
<div className="post-channels">{p.platforms.map((id:string)=><span key={id} className="pill">{platforms.find(x=>x.id===id)?.name}</span>)}</div>
{p.deliveries.length>0&&<div className="delivery-list">{p.deliveries.map((d:any)=><div key={d.id} className={'delivery '+d.status}><div className="delivery-heading"><strong>{platforms.find(x=>x.id===d.platform)?.name}</strong><span>{t(statuses[d.status]||d.status)}</span></div>{d.recipient&&<small>{t('Alıcı')}: {d.recipient}</small>}{d.status==='pending'&&d.next_attempt_at>Math.floor(Date.now()/1000)&&<small>{t('Sıradaki deneme')}: {inZone(d.next_attempt_at,tz)}</small>}{d.media_note&&<small className="media-note">{d.media_note}</small>}{d.error&&<small>{d.error}</small>}{d.error_code&&<small className="error-code">{t('Kod')}: {d.error_code}</small>}{d.retry_count>0&&<small>{t('Otomatik tekrar')}: {d.retry_count}/3</small>}{d.externalId&&<small className="external-id">{t('İşlem')}: {d.externalId}</small>}
{d.attempts.length>0&&<details className="attempts"><summary><History size={13}/>{d.attempts_total??d.attempts.length} {t('deneme')}{(d.attempts_total??0)>d.attempts.length?` · ${t('son')} ${d.attempts.length}`:''}</summary><ol>{d.attempts.map((a:any,i:number)=><li key={i}><span>{inZone(a.started_at,tz,{dateStyle:'short',timeStyle:'medium'})}</span><strong>{t(outcomes[a.outcome]||a.outcome)}</strong><span>{t(stages[a.stage]||a.stage)}</span>{a.error_code&&<code>{a.error_code}</code>}{a.error&&<em>{t(a.error)}</em>}</li>)}</ol></details>}
{d.status==='failed'&&can('approve')&&<button className="secondary" disabled={locked(p.id)} onClick={()=>act(p.id,'retry',{delivery_id:d.id},t('Yeniden kuyruğa alındı.'))}>{t('Tekrar dene')}</button>}</div>)}</div>}
{actionErrors[p.id]&&actionErrors[p.id].updatedAt===p.updated_at&&confirmation?.post.id!==p.id&&<p className="error" role="alert">{t(actionErrors[p.id].message)}{actionErrors[p.id].uncertain&&<span className="block">{t('İstek sunucuda tamamlanmış olabilir. Yeniden denemeden önce listeyi yenile.')}</span>}</p>}
<div className="post-actions">{active.has(p.id)&&<span role="status"><Loader2 size={14} className="spin"/> {t('İşlem sürüyor…')}</span>}
{p.status==='pending_approval'&&can('approve')&&<><button className="primary" disabled={locked(p.id)} onClick={()=>act(p.id,`posts/${p.id}/approve`,{expected_updated_at:p.updated_at},t(p.scheduled_at?'Onaylandı, planlanan zamanda gönderilecek.':'Onaylandı, gönderim başladı.'))}><Check size={15}/>{t('Onayla')}</button><button className="secondary" disabled={locked(p.id)} onClick={()=>ask(p,'reject')}><X size={15}/>{t('Reddet')}</button></>}
{['draft','rejected','pending_approval'].includes(p.status)&&can('compose')&&<button className="secondary" disabled={locked(p.id)} onClick={()=>onEdit(p)}><Pencil size={14}/>{t('Düzenle')}</button>}
{p.status==='scheduled'&&can('approve')&&<button className="secondary" disabled={locked(p.id)} onClick={()=>ask(p,'cancel')}><CalendarClock size={14}/>{t('Planı iptal et')}</button>}
{onDuplicate&&<button className="secondary" title={t('Bu içeriğin kopyasıyla yeni taslak başlat')} disabled={locked(p.id)} onClick={()=>onDuplicate(p)}><Copy size={14}/>{t('Kopyala')}</button>}
{['draft','rejected'].includes(p.status)&&can('compose')&&<button className="text-button" disabled={locked(p.id)} onClick={()=>ask(p,'delete')}><Trash2 size={14}/>{t('Sil')}</button>}
</div></article>)}</div></section>
<AlertDialog open={!!confirmation} onOpenChange={open=>{if(!open&&(!confirmation||!inFlight.current.has(confirmation.post.id)))setConfirmation(null)}}>
<AlertDialogContent aria-busy={confirmationBusy}>
<AlertDialogHeader><AlertDialogTitle>{t(confirmation?.kind==='delete'?'İçeriği sil':confirmation?.kind==='cancel'?'Planı iptal et':'İçeriği reddet')}</AlertDialogTitle><AlertDialogDescription>{t(confirmation?.kind==='delete'?'Bu içerik kalıcı olarak silinsin mi?':confirmation?.kind==='cancel'?'Plan iptal edilsin mi? İçerik taslağa döner.':'Reddetme nedeni (editör bu notu görecek):')}</AlertDialogDescription></AlertDialogHeader>
<p className="field-help line-clamp-3 break-words">{confirmation?.post.text||confirmation?.post.options?.template||t('Medya paylaşımı')}</p>
{confirmation?.kind==='reject'&&<label htmlFor="review-note">{t('Red nedeni')}<Textarea id="review-note" className="max-h-48" maxLength={1000} required value={note} disabled={confirmationBusy} onChange={event=>setNote(event.target.value)}/></label>}
{confirmationError&&<p className="error" role="alert">{t(confirmationError)}{confirmationStale&&' '+t('İçerik değişti veya kaldırıldı. Pencereyi kapatıp güncel liste üzerinden yeniden aç.')}{confirmation&&actionErrors[confirmation.post.id]?.uncertain&&<span className="block">{t('İstek sunucuda tamamlanmış olabilir. Yeniden denemeden önce listeyi yenile.')}</span>}</p>}
<AlertDialogFooter><AlertDialogCancel disabled={confirmationBusy}>{t('İptal et')}</AlertDialogCancel><AlertDialogAction disabled={confirmationBusy||confirmationStale||(confirmation?.kind==='reject'&&!note.trim())} onClick={event=>{event.preventDefault();void confirmAction()}}>{confirmationBusy&&<Loader2 size={14} className="spin"/>}{t(confirmation?.kind==='delete'?'Sil':confirmation?.kind==='cancel'?'Planı iptal et':'Reddet')}</AlertDialogAction></AlertDialogFooter>
</AlertDialogContent></AlertDialog></>}
