import {useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import {platforms,contentStatuses,zoneInput,inZone} from './api';
import {locale,t} from './i18n';
import {calendarDraftTime,calendarPostTime} from './calendarData';

const days=['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

export default function Calendar({posts,tz,can,onCompose,onEdit}:any){
const today=zoneInput(Math.floor(Date.now()/1000),tz).slice(0,10);
const [month,setMonth]=useState(today.slice(0,7));
const [view,setView]=useState<'month'|'list'>('month');
const byDay=useMemo(()=>{const map:Record<string,any[]>={};for(const p of posts){const t=calendarPostTime(p);if(!t)continue;const key=zoneInput(t,tz).slice(0,10);(map[key]=map[key]||[]).push({...p,at:t})}for(const k in map)map[k].sort((a,b)=>a.at-b.at);return map},[posts,tz]);
const [y,m]=month.split('-').map(Number);
const first=new Date(Date.UTC(y,m-1,1));const offset=(first.getUTCDay()+6)%7;const count=new Date(Date.UTC(y,m,0)).getUTCDate();
const cells=Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>{const d=i-offset+1;return d>=1&&d<=count?`${month}-${String(d).padStart(2,'0')}`:null});
function shift(n:number){const d=new Date(Date.UTC(y,m-1+n,1));setMonth(d.toISOString().slice(0,7))}
const title=new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
const monthPosts=Object.entries(byDay).filter(([day])=>day.startsWith(month)).sort(([a],[b])=>a.localeCompare(b)).flatMap(([,items])=>items);
return <section className={'panel calendar calendar-view-'+view}><div className="panel-head"><h2 aria-live="polite">{title}</h2><span className="field-help">{t('Saatler şirket saat dilimine göre')}: {tz}</span><div className="calendar-nav"><button className="secondary" aria-label={t('Önceki ay')} onClick={()=>shift(-1)}><ChevronLeft size={16}/></button><button className="secondary" onClick={()=>setMonth(today.slice(0,7))}>{t('Bugün')}</button><button className="secondary" aria-label={t('Sonraki ay')} onClick={()=>shift(1)}><ChevronRight size={16}/></button></div></div>
<div className="calendar-viewbar"><span role="status">{t('{count} paylaşım bu ayda',{count:monthPosts.length})}</span><div className="calendar-view-switch" role="group" aria-label={t('Takvim görünümü')}><button type="button" aria-pressed={view==='month'} onClick={()=>setView('month')}>{t('Ay görünümü')}</button><button type="button" aria-pressed={view==='list'} onClick={()=>setView('list')}>{t('Liste görünümü')}</button></div></div>
<div className="calendar-grid">{days.map(d=><div key={d} className="calendar-dow">{t(d)}</div>)}{cells.map((key,i)=><div key={i} className={'calendar-cell '+(key===today?'today ':'')+(key&&key<today?'past':'')}>{key&&<><div className="calendar-day"><span>{Number(key.slice(8))}</span>{can('compose')&&key>=today&&<button className="icon-button" title={t('Bu güne içerik planla')} aria-label={`${key} ${t('Bu güne içerik planla')}`} onClick={()=>onCompose(calendarDraftTime(key,zoneInput(Math.floor(Date.now()/1000),tz)))}><Plus size={14}/></button>}</div>{(byDay[key]||[]).map((p:any)=>{const editable=['draft','rejected','pending_approval'].includes(p.status)&&can('compose');const Entry=editable?'button':'div';return <Entry role={editable?undefined:'group'} key={p.id} className={'calendar-item status-'+p.status} title={`${t(contentStatuses[p.status]||p.status)} · ${inZone(p.at,tz)}`} aria-label={`${t(contentStatuses[p.status]||p.status)} · ${inZone(p.at,tz)} · ${p.text||p.options?.template||t('Medya')}`} onClick={editable?()=>onEdit(p):undefined}><span className="calendar-time">{inZone(p.at,tz,{timeStyle:'short'})}</span><span className="calendar-icons">{p.platforms.map((id:string)=>platforms.find(x=>x.id===id)?.symbol).join(' ')}</span><span className="calendar-text">{p.text||p.options.template||t('Medya')}</span></Entry>})}</>}</div>)}</div>
<div className="calendar-legend">{['scheduled','pending_approval','completed','attention'].map(s=><span key={s} className={'status-'+s}>{t(contentStatuses[s])}</span>)}</div>
<section className="calendar-agenda" aria-label={t('Bu ayki paylaşımlar')}><h2>{t('Bu ayki paylaşımlar')}</h2>{monthPosts.length?<ul>{monthPosts.map((p:any)=><li key={p.id}><div className="agenda-meta"><time dateTime={new Date(p.at*1000).toISOString()}>{inZone(p.at,tz,{dateStyle:'short',timeStyle:'short'})}</time><span className={'pill status-'+p.status}>{t(contentStatuses[p.status]||p.status)}</span></div><p>{p.text||p.options.template||t('Medya')}</p><div className="agenda-platforms">{p.platforms.map((id:string)=>platforms.find(x=>x.id===id)?.name).join(' · ')}{['draft','rejected','pending_approval'].includes(p.status)&&can('compose')&&<button className="secondary" onClick={()=>onEdit(p)}>{t('Düzenle')}</button>}</div></li>)}</ul>:<p className="field-help">{t('Bu ay için planlı veya yayımlanmış içerik yok.')}</p>}</section>
</section>}
