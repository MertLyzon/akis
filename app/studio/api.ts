export const platforms=[{id:'x',name:'X / Twitter',symbol:'𝕏',color:'#171c25',hint:'Metin, görsel ve video'},{id:'instagram',name:'Instagram',symbol:'◎',color:'#dc4369',hint:'Görsel ve Reels'},{id:'tiktok',name:'TikTok',symbol:'♪',color:'#171c25',hint:'Görselden video ve aktarım'},{id:'whatsapp',name:'WhatsApp',symbol:'◉',color:'#159467',hint:'Medya ve şablon mesajlar'}];
export const statuses:Record<string,string>={draft:'Taslak',pending:'Sırada',sending:'Gönderiliyor',sent:'Yayımlandı',failed:'Başarısız',submitted:'Platforma iletildi',unknown:'Sonuç belirsiz'};
export const contentStatuses:Record<string,string>={draft:'Taslak',pending_approval:'Onay bekliyor',rejected:'Reddedildi',scheduled:'Planlandı',processing:'Gönderiliyor',completed:'Tamamlandı',attention:'Kontrol gerekiyor'};
export const outcomes:Record<string,string>={running:'Sürüyor',sent:'Yayımlandı',submitted:'Platforma iletildi',waiting:'Platform işliyor',retry:'Tekrar denenecek',failed:'Başarısız',unknown:'Sonuç belirsiz'};
export const stages:Record<string,string>={start:'Başlangıç',prepare:'Hazırlık',media_upload:'Medya yükleme',publish:'Yayımlama'};
export const roleNames:Record<string,string>={admin:'Şirket yöneticisi',approver:'Onaylayan',editor:'Editör',viewer:'Görüntüleyen'};

// Active company for every request. Stored per browser so a refresh keeps the same workspace.
let company='';
try{company=localStorage.getItem('akis-company')||''}catch{}
export function setCompany(id:string){company=id;try{localStorage.setItem('akis-company',id)}catch{}}
export function companyHeader():Record<string,string>{return company?{'X-Akis-Company':company}:{}}

// ---- Native app (Tauri) runtime ----
// On the web the UI is served by the API server itself (same origin, httpOnly cookie).
// In the apps the UI is bundled, so it needs the server address and keeps a bearer token.
export const isApp=typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window;
function stored(key:string){try{return localStorage.getItem(key)||''}catch{return ''}}
function store(key:string,value:string){try{value?localStorage.setItem(key,value):localStorage.removeItem(key)}catch{}}
let server=isApp?stored('akis-server'):'';
let token=isApp?stored('akis-token'):'';
export function serverUrl(){return server}
export function setServer(url:string){server=url.trim().replace(/\/+$/,'');store('akis-server',server)}
export function setToken(t:string){token=t;store('akis-token',t)}
export function authHeaders():Record<string,string>{return isApp?{'X-Akis-Client':'app',...(token?{Authorization:'Bearer '+token}:{})}:{}}
export function apiUrl(path:string){return server+'/api/'+path}
// Media URLs from the server are relative (/api/media/...) or absolute Cloudinary links.
export function mediaSrc(url:string|null|undefined){return url&&url.startsWith('/')?server+url:url||''}
export async function checkServer(url:string){const base=url.trim().replace(/\/+$/,'');if(!/^https?:\/\//.test(base))throw new Error('Adres https:// ile başlamalı.');let r:Response;try{r=await fetch(base+'/api/health')}catch{throw new Error('Sunucuya ulaşılamadı. Adresi ve internet bağlantını kontrol et.')}const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok)throw new Error('Bu adreste bir Akış sunucusu bulunamadı.');return base}
export async function openExternal(url:string){if(isApp){const {openUrl}=await import('@tauri-apps/plugin-opener');await openUrl(url)}else window.open(url,'_blank','noopener')}

export class ApiError extends Error{data:any;status:number;constructor(message:string,status:number,data:any){super(message);this.status=status;this.data=data}}
export async function api(path:string,body?:any,method?:string){let r:Response;try{r=await fetch(apiUrl(path),{method:method||(body?'POST':'GET'),headers:{...companyHeader(),...authHeaders(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})}catch{throw new Error('Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.')}let j:any;try{j=await r.json()}catch{throw new Error('Sunucuya ulaşılamıyor. Biraz sonra tekrar dene.')}if(!r.ok){if(r.status===401&&isApp&&token)setToken('');throw new ApiError(j.error||'İşlem tamamlanamadı.',r.status,j)}if(isApp&&j&&typeof j.token==='string')setToken(j.token);return j;}
export function dateInput(stamp:number|null){if(!stamp)return '';const d=new Date(stamp*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
// Unix seconds → text in the company's timezone, so everyone on the team sees the same schedule.
export function inZone(stamp:number|null|undefined,tz:string,opts:Intl.DateTimeFormatOptions={dateStyle:'medium',timeStyle:'short'}){if(!stamp)return '';try{return new Intl.DateTimeFormat('tr-TR',{...opts,timeZone:tz}).format(new Date(stamp*1000))}catch{return new Date(stamp*1000).toLocaleString('tr-TR')}}
// Unix seconds → 'YYYY-MM-DDTHH:MM' wall-clock in the company's timezone (for datetime-local inputs).
export function zoneInput(stamp:number|null|undefined,tz:string){if(!stamp)return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp*1000)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`}
export function bytes(n:number){if(!n)return '0 MB';if(n<1024*1024)return (n/1024).toFixed(0)+' KB';if(n<1024**3)return (n/1024/1024).toFixed(1)+' MB';return (n/1024**3).toFixed(2)+' GB'}
