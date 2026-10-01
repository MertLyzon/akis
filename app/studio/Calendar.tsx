import {useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import {platforms,contentStatuses,zoneInput,inZone} from './api';
import {locale,t} from './i18n';

const days=['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

// When a post lands on the calendar: its planned time, else when it was actually published.
function when(p:any){return p.scheduled_at||Math.min(...p.deliveries.map((d:any)=>d.sent_at).filter(Boolean))||null}

export default function Calendar({posts,tz,can,onCompose,onEdit}:any){
const today=zoneInput(Math.floor(Date.now()/1000),tz).slice(0,10);
const [month,setMonth]=useState(today.slice(0,7));
const byDay=useMemo(()=>{const map:Record<string,any[]>={};for(const p of posts){const t=when(p);if(!t||!isFinite(t))continue;const key=zoneInput(t,tz).slice(0,10);(map[key]=map[key]||[]).push({...p,at:t})}for(const k in map)map[k].sort((a,b)=>a.at-b.at);return map},[posts,tz]);
const [y,m]=month.split('-').map(Number);
const first=new Date(Date.UTC(y,m-1,1));const offset=(first.getUTCDay()+6)%7;const count=new Date(Date.UTC(y,m,0)).getUTCDate();
const cells=Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>{const d=i-offset+1;return d>=1&&d<=count?`${month}-${String(d).padStart(2,'0')}`:null});
function shift(n:number){const d=new Date(Date.UTC(y,m-1+n,1));setMonth(d.toISOString().slice(0,7))}
const title=new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
const monthPosts=Object.entries(byDay).filter(([day])=>day.startsWith(month)).sort(([a],[b])=>a.localeCompare(b)).flatMap(([,items])=>items);
return <section className="panel calendar"><div className="panel-head"><h2>{title}</h2><span className="field-help">{t('Saatler şirket saat dilimine göre')}: {tz}</span><div className="calendar-nav"><button className="secondary" aria-label={t('Önceki ay')} onClick={()=>shift(-1)}><ChevronLeft size={16}/></button><button className="secondary" onClick={()=>setMonth(today.slice(0,7))}>{t('Bugün')}</button><button className="secondary" aria-label={t('Sonraki ay')} onClick={()=>shift(1)}><ChevronRight size={16}/></button></div></div>
<div className="calendar-grid">{days.map(d=><div key={d} className="calendar-dow">{t(d)}</div>)}{cells.map((key,i)=><div key={i} className={'calendar-cell '+(key===today?'today ':'')+(key&&key<today?'past':'')}>{key&&<><div className="calendar-day"><span>{Number(key.slice(8))}</span>{can('compose')&&key>=today&&<button className="icon-button" title={t('Bu güne içerik planla')} aria-label={`${key} ${t('Bu güne içerik planla')}`} onClick={()=>onCompose(key+'T10:00')}><Plus size={14}/></button>}</div>{(byDay[key]||[]).map((p:any)=><button key={p.id} className={'calendar-item status-'+p.status} title={`${t(contentStatuses[p.status]||p.status)} · ${inZone(p.at,tz)}`} onClick={()=>['draft','rejected','pending_approval'].includes(p.status)&&can('compose')?onEdit(p):undefined}><span className="calendar-time">{inZone(p.at,tz,{timeStyle:'short'})}</span><span className="calendar-icons">{p.platforms.map((id:string)=>platforms.find(x=>x.id===id)?.symbol).join(' ')}</span><span className="calendar-text">{p.text||p.options.template||t('Medya')}</span></button>)}</>}</div>)}</div>
<div className="calendar-legend">{['scheduled','pending_approval','completed','attention'].map(s=><span key={s} className={'status-'+s}>{t(contentStatuses[s])}</span>)}</div>
<section className="calendar-agenda" aria-label={t('Bu ayki paylaşımlar')}><h2>{t('Bu ayki paylaşımlar')}</h2>{monthPosts.length?<ul>{monthPosts.map((p:any)=><li key={p.id}><div className="agenda-meta"><time dateTime={new Date(p.at*1000).toISOString()}>{inZone(p.at,tz,{dateStyle:'short',timeStyle:'short'})}</time><span className={'pill status-'+p.status}>{t(contentStatuses[p.status]||p.status)}</span></div><p>{p.text||p.options.template||t('Medya')}</p><div className="agenda-platforms">{p.platforms.map((id:string)=>platforms.find(x=>x.id===id)?.name).join(' · ')}{['draft','rejected','pending_approval'].includes(p.status)&&can('compose')&&<button className="secondary" onClick={()=>onEdit(p)}>{t('Düzenle')}</button>}</div></li>)}</ul>:<p className="field-help">{t('Bu ay için planlı veya yayımlanmış içerik yok.')}</p>}</section>
</section>}
