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

export class ApiError extends Error{data:any;status:number;constructor(message:string,status:number,data:any){super(message);this.status=status;this.data=data}}
export async function api(path:string,body?:any,method?:string){const r=await fetch('/api/'+path,{method:method||(body?'POST':'GET'),headers:{...companyHeader(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});let j:any;try{j=await r.json()}catch{throw new Error('Sunucuya ulaşılamıyor. Biraz sonra tekrar dene.')}if(!r.ok)throw new ApiError(j.error||'İşlem tamamlanamadı.',r.status,j);return j;}
export function dateInput(stamp:number|null){if(!stamp)return '';const d=new Date(stamp*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
// Unix seconds → text in the company's timezone, so everyone on the team sees the same schedule.
export function inZone(stamp:number|null|undefined,tz:string,opts:Intl.DateTimeFormatOptions={dateStyle:'medium',timeStyle:'short'}){if(!stamp)return '';try{return new Intl.DateTimeFormat('tr-TR',{...opts,timeZone:tz}).format(new Date(stamp*1000))}catch{return new Date(stamp*1000).toLocaleString('tr-TR')}}
// Unix seconds → 'YYYY-MM-DDTHH:MM' wall-clock in the company's timezone (for datetime-local inputs).
export function zoneInput(stamp:number|null|undefined,tz:string){if(!stamp)return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp*1000)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`}
export function bytes(n:number){if(!n)return '0 MB';if(n<1024*1024)return (n/1024).toFixed(0)+' KB';if(n<1024**3)return (n/1024/1024).toFixed(1)+' MB';return (n/1024**3).toFixed(2)+' GB'}
