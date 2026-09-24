import {useState} from 'react';
import {FileText,RefreshCw,Image as ImageIcon,Check,X,CalendarClock,Pencil,Trash2,History} from 'lucide-react';
import {toast} from 'sonner';
import {api,platforms,statuses,contentStatuses,outcomes,stages,inZone} from './api';

const filters=[{id:'all',name:'Tümü'},{id:'pending_approval',name:'Onay bekleyen'},{id:'scheduled',name:'Planlı'},{id:'attention',name:'Sorunlu'},{id:'draft',name:'Taslak / reddedilen'}];
function matches(p:any,f:string){if(f==='all')return true;if(f==='attention')return p.status==='attention'||p.deliveries.some((d:any)=>['failed','unknown'].includes(d.status));if(f==='draft')return ['draft','rejected'].includes(p.status);return p.status===f}

export default function Posts({posts,loading,refresh,can,tz,onEdit,initialFilter='all'}:any){
const [filter,setFilter]=useState(initialFilter);
const shown=posts.filter((p:any)=>matches(p,filter));
async function act(path:string,body:any,done:string,method?:string){try{await api(path,body,method);toast.success(done);await refresh()}catch(e:any){toast.error(e.message)}}
async function reject(p:any){const note=prompt('Reddetme nedeni (editör bu notu görecek):');if(note===null)return;await act(`posts/${p.id}/reject`,{note},'İçerik reddedildi, editöre not iletildi.')}
return <><div className="stats">{[{label:'Toplam içerik',value:posts.length},{label:'Onay bekleyen',value:posts.filter((p:any)=>p.status==='pending_approval').length},{label:'Planlı',value:posts.filter((p:any)=>p.status==='scheduled').length},{label:'Kontrol gerekiyor',value:posts.filter((p:any)=>matches(p,'attention')).length}].map(s=><div className="stat-card" key={s.label}><span>{s.label}</span><strong>{s.value}</strong></div>)}</div>
<section className="panel"><div className="panel-head"><div className="filter-tabs" role="tablist">{filters.map(f=><button key={f.id} role="tab" aria-selected={filter===f.id} className={filter===f.id?'active':''} onClick={()=>setFilter(f.id)}>{f.name}</button>)}</div><button className="secondary" onClick={refresh}><RefreshCw size={14}/>Yenile</button></div>
{loading?<div className="empty-state">Gönderiler yükleniyor…</div>:!shown.length?<div className="empty-state"><FileText size={36}/><h3>{filter==='all'?'İlk paylaşımına yer ayırdık.':'Bu listede içerik yok.'}</h3><p>Taslaklar, onaylar ve gönderim sonuçları burada görünecek.</p></div>:shown.map((p:any)=><article key={p.id} className="post-item">
<div className="post-meta"><span className={'pill status-'+p.status}>{contentStatuses[p.status]||p.status}</span><span>{new Date(p.created).toLocaleString('tr-TR')}</span>{p.created_by&&<span>Hazırlayan: {p.created_by}</span>}{p.approved_by&&<span>Onaylayan: {p.approved_by}</span>}{p.scheduled_at&&<span className="schedule"><CalendarClock size={14}/>{inZone(p.scheduled_at,tz)}</span>}</div>
<h3>{p.text||p.options.template||'Medya paylaşımı'}</h3>
{p.asset&&<p className="post-media"><ImageIcon size={15}/>{p.asset.filename} · {p.asset.note||'Hazırlanıyor'}</p>}
{p.review_note&&<p className={'review-note '+(p.status==='rejected'?'rejected':'')}>{p.status==='rejected'?'Red nedeni: ':'Onay notu: '}{p.review_note}</p>}
<div className="post-channels">{p.platforms.map((id:string)=><span key={id} className="pill">{platforms.find(x=>x.id===id)?.name}</span>)}</div>
{p.deliveries.length>0&&<div className="delivery-list">{p.deliveries.map((d:any)=><div key={d.id} className={'delivery '+d.status}><div className="delivery-heading"><strong>{platforms.find(x=>x.id===d.platform)?.name}</strong><span>{statuses[d.status]||d.status}</span></div>{d.recipient&&<small>Alıcı: {d.recipient}</small>}{d.status==='pending'&&d.next_attempt_at>Math.floor(Date.now()/1000)&&<small>Sıradaki deneme: {inZone(d.next_attempt_at,tz)}</small>}{d.media_note&&<small className="media-note">{d.media_note}</small>}{d.error&&<small>{d.error}</small>}{d.error_code&&<small className="error-code">Kod: {d.error_code}</small>}{d.retry_count>0&&<small>Otomatik tekrar: {d.retry_count}/3</small>}{d.externalId&&<small className="external-id">İşlem: {d.externalId}</small>}
{d.attempts.length>0&&<details className="attempts"><summary><History size={13}/>{d.attempts.length} deneme</summary><ol>{d.attempts.map((a:any,i:number)=><li key={i}><span>{inZone(a.started_at,tz,{dateStyle:'short',timeStyle:'medium'})}</span><strong>{outcomes[a.outcome]||a.outcome}</strong><span>{stages[a.stage]||a.stage}</span>{a.error_code&&<code>{a.error_code}</code>}{a.error&&<em>{a.error}</em>}</li>)}</ol></details>}
{d.status==='failed'&&can('approve')&&<button className="secondary" onClick={()=>act('retry',{delivery_id:d.id},'Yeniden kuyruğa alındı.')}>Tekrar dene</button>}</div>)}</div>}
<div className="post-actions">
{p.status==='pending_approval'&&can('approve')&&<><button className="primary" onClick={()=>act(`posts/${p.id}/approve`,{},p.scheduled_at?'Onaylandı, planlanan zamanda gönderilecek.':'Onaylandı, gönderim başladı.')}><Check size={15}/>Onayla</button><button className="secondary" onClick={()=>reject(p)}><X size={15}/>Reddet</button></>}
{['draft','rejected','pending_approval'].includes(p.status)&&can('compose')&&<button className="secondary" onClick={()=>onEdit(p)}><Pencil size={14}/>Düzenle</button>}
{p.status==='scheduled'&&can('approve')&&<button className="secondary" onClick={()=>confirm('Plan iptal edilsin mi? İçerik taslağa döner.')&&act(`posts/${p.id}/cancel`,{},'Plan iptal edildi, içerik taslağa döndü.')}><CalendarClock size={14}/>Planı iptal et</button>}
{['draft','rejected'].includes(p.status)&&can('compose')&&<button className="text-button" onClick={()=>confirm('Bu içerik kalıcı olarak silinsin mi?')&&act(`posts/${p.id}`,{},'İçerik silindi.','DELETE')}><Trash2 size={14}/>Sil</button>}
</div></article>)}</section></>}
