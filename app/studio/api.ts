import {t} from './i18n';
import {StateCache} from './stateCache';
import {fetchJson,RequestTimeoutError,InvalidJsonError,apiTimeout,STATE_TIMEOUT_MS,SERVER_CHECK_TIMEOUT_MS} from './requestDeadline';

export const platforms=[{id:'x',name:'X / Twitter',symbol:'𝕏',color:'#171c25',hint:'Metin, görsel ve video'},{id:'instagram',name:'Instagram',symbol:'◎',color:'#dc4369',hint:'Görsel ve Reels'},{id:'tiktok',name:'TikTok',symbol:'♪',color:'#171c25',hint:'Görselden video ve aktarım'},{id:'whatsapp',name:'WhatsApp',symbol:'◉',color:'#159467',hint:'Medya ve şablon mesajlar'}];
export const statuses:Record<string,string>={draft:'Taslak',pending:'Sırada',queued:'Sırada',sending:'Gönderiliyor',sent:'Yayımlandı',failed:'Başarısız',submitted:'Platforma iletildi',unknown:'Sonuç belirsiz'};
export const contentStatuses:Record<string,string>={draft:'Taslak',pending_approval:'Onay bekliyor',rejected:'Reddedildi',scheduled:'Planlandı',processing:'Gönderiliyor',completed:'Tamamlandı',attention:'Kontrol gerekiyor'};
export const outcomes:Record<string,string>={running:'Sürüyor',sent:'Yayımlandı',submitted:'Platforma iletildi',waiting:'Platform işliyor',retry:'Tekrar denenecek',failed:'Başarısız',unknown:'Sonuç belirsiz'};
export const stages:Record<string,string>={start:'Başlangıç',prepare:'Hazırlık',media_upload:'Medya yükleme',publish:'Yayımlama'};
export const roleNames:Record<string,string>={admin:'Şirket yöneticisi',approver:'Onaylayan',editor:'Editör',viewer:'Görüntüleyen'};

// Active company for every request. Stored per browser so a refresh keeps the same workspace.
let company='';
try{company=localStorage.getItem('akis-company')||''}catch{}
export function setCompany(id:string){if(company!==id)forgetState();company=id;try{localStorage.setItem('akis-company',id)}catch{}}
export function companyHeader():Record<string,string>{return company?{'X-Akis-Company':company}:{}}

// ---- Native app (Tauri) runtime ----
// On the web the UI is served by the API server itself (same origin, httpOnly cookie).
// In the apps the UI is bundled, so it needs the server address and keeps a bearer token.
export const isApp=typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window;
function stored(key:string){try{return localStorage.getItem(key)||''}catch{return ''}}
function store(key:string,value:string){try{value?localStorage.setItem(key,value):localStorage.removeItem(key)}catch{}}
let server=isApp?stored('akis-server'):'';
let token=isApp?stored('akis-token'):'';
let authRevision=0;
export function serverUrl(){return server}
export function setServer(url:string){const next=url.trim().replace(/\/+$/,'');if(server!==next){authRevision++;forgetState()}server=next;store('akis-server',server)}
export function setToken(t:string){if(token!==t){authRevision++;forgetState()}token=t;store('akis-token',t)}
export function authHeaders():Record<string,string>{return isApp?{'X-Akis-Client':'app',...(token?{Authorization:'Bearer '+token}:{})}:{}}
export function apiUrl(path:string){return server+'/api/'+path}
// Media URLs from the server are relative (/api/media/...) or absolute Cloudinary links.
export function mediaSrc(url:string|null|undefined){return url&&url.startsWith('/')?server+url:url||''}
export async function checkServer(url:string){const base=url.trim().replace(/\/+$/,'');let parsed:URL;try{parsed=new URL(base)}catch{throw new Error('Geçerli bir sunucu adresi gir.')}const loopback=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);if(parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&loopback))throw new Error('Uzak sunucu adresi güvenli bir https:// adresi olmalı.');let r:Response,j:any;try{({response:r,data:j}=await fetchJson(base+'/api/health',{},SERVER_CHECK_TIMEOUT_MS))}catch(error){if(error instanceof RequestTimeoutError)throw new Error('Sunucu zamanında yanıt vermedi. Bağlantını kontrol edip tekrar dene.');if(error instanceof InvalidJsonError)throw new Error('Bu adreste bir Akış sunucusu bulunamadı.');throw new Error('Sunucuya ulaşılamadı. Adresi ve internet bağlantını kontrol et.')}if(!r.ok||!j?.ok)throw new Error('Bu adreste bir Akış sunucusu bulunamadı.');return base}
export async function openExternal(url:string){if(isApp){const {openUrl}=await import('@tauri-apps/plugin-opener');await openUrl(url)}else window.open(url,'_blank','noopener')}

export class ApiError extends Error{data:any;status:number;constructor(message:string,status:number,data:any){super(message);this.status=status;this.data=data}}
function errorMessage(data:any){const message=t(data?.error||'İşlem tamamlanamadı.');return data?.support_code?`${message} ${t('Destek kodu')}: ${data.support_code}`:message}
export async function api(path:string,body?:any,method?:string){
const revision=authRevision,verb=method||(body?'POST':'GET');let r:Response,j:any;
const readOnly=['GET','HEAD'].includes(verb.toUpperCase());
try{({response:r,data:j}=await fetchJson(apiUrl(path),{method:verb,headers:{...companyHeader(),...authHeaders(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})},apiTimeout(path)))}catch(error){
if(error instanceof RequestTimeoutError)throw new Error(readOnly?'Sunucu zamanında yanıt vermedi. Bağlantını kontrol edip tekrar dene.':'İstek zaman aşımına uğradı. İşlem sunucuda tamamlanmış olabilir. Yeniden denemeden önce sonucu kontrol et.');
// A lost connection or unreadable response does not prove that a write failed.
if(!readOnly)throw new Error('İşlem sonucu doğrulanamadı. İşlem sunucuda tamamlanmış olabilir. Yeniden denemeden önce sonucu kontrol et.');
if(error instanceof InvalidJsonError)throw new Error('Sunucuya ulaşılamıyor. Biraz sonra tekrar dene.');throw new Error('Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.')}
if(!r.ok){if(r.status===401&&isApp&&token&&revision===authRevision)setToken('');throw new ApiError(errorMessage(j),r.status,j)}
if(isApp&&j&&typeof j.token==='string'&&revision===authRevision)setToken(j.token);
return j;
}
// Polled state: sends the last ETag so an unchanged workspace costs a bodiless 304 and no re-render.
const stateCache=new StateCache();
export async function fetchState():Promise<any|null>{
const request=stateCache.begin(company),revision=authRevision;let r:Response,j:any;
try{({response:r,data:j}=await fetchJson(apiUrl('state'),{cache:'no-store',headers:{...companyHeader(),...authHeaders(),...request.headers}},STATE_TIMEOUT_MS))}catch(error){
if(!request.current())return null;
if(error instanceof RequestTimeoutError)throw new Error('Sunucu zamanında yanıt vermedi. Bağlantını kontrol edip tekrar dene.');if(error instanceof InvalidJsonError)throw new Error('Sunucuya ulaşılamıyor. Biraz sonra tekrar dene.');throw new Error('Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.')}
if(!request.current())return null;
if(r.status===304)return null;
if(!r.ok){if(r.status===401&&isApp&&token&&revision===authRevision)setToken('');throw new ApiError(errorMessage(j),r.status,j)}
request.commit(r.headers.get('ETag')||'');return j;
}
export function forgetState(){stateCache.clear()}
export function dateInput(stamp:number|null){if(!stamp)return '';const d=new Date(stamp*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
export type HourFormat='24'|'12';
export function readHourFormat():HourFormat{try{return localStorage.getItem('akis-hour-format')==='12'?'12':'24'}catch{return '24'}}
export function saveHourFormat(value:HourFormat){try{localStorage.setItem('akis-hour-format',value)}catch{}}
// Unix seconds → text in the company's timezone, so everyone on the team sees the same schedule.
export function inZone(stamp:number|null|undefined,tz:string,opts:Intl.DateTimeFormatOptions={dateStyle:'medium',timeStyle:'short'}){if(!stamp)return '';const twelve=readHourFormat()==='12',clock=opts.timeStyle||opts.hour?{hour12:twelve}:{};const language=(()=>{try{return localStorage.getItem('akis-language')==='en'?'en-US':'tr-TR'}catch{return 'tr-TR'}})();try{const formatter=new Intl.DateTimeFormat(language,{...opts,...clock,timeZone:tz}),date=new Date(stamp*1000);return twelve&&language==='tr-TR'?formatter.formatToParts(date).map(p=>p.type==='dayPeriod'?(p.value.toLocaleUpperCase('tr-TR').includes('ÖÖ')?'AM':'PM'):p.value).join(''):formatter.format(date)}catch{return new Date(stamp*1000).toLocaleString(language)}}
// Unix seconds → 'YYYY-MM-DDTHH:MM' wall-clock in the company's timezone (for datetime-local inputs).
export function zoneInput(stamp:number|null|undefined,tz:string){if(!stamp)return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp*1000)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`}
export function bytes(n:number){if(!n)return '0 MB';if(n<1024*1024)return (n/1024).toFixed(0)+' KB';if(n<1024**3)return (n/1024/1024).toFixed(1)+' MB';return (n/1024**3).toFixed(2)+' GB'}
