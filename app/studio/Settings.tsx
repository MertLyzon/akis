import {useEffect,useRef,useState} from 'react';
import {Settings2,Clock3,ShieldCheck,Languages,Copy,Check} from 'lucide-react';
import {toast} from 'sonner';
import {platforms,api} from './api';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {t} from './i18n';
import {KeyedActions} from './libraryRequests';
import {saveThenRefresh} from './settingsSave';
import {useNavigationSafety} from './useNavigationSafety';
import {settingsDraft,mergeSettingsDraft,settingsDraftChanged,settingsSaveNeeded} from './settingsDraft';
import {copyToClipboard} from './clipboard';
import {RadioGroup} from 'radix-ui';
export default function Settings({settings,refresh,hourFormat,onHourFormat,language,onLanguage}:any){return <><section className="panel pad preference-panel"><h2><Languages size={18}/>{t('Dil ve saat')}</h2><div><label>{t('Uygulama dili')}</label><RadioGroup.Root className="language-list" value={language} onValueChange={onLanguage} orientation="horizontal" aria-label={t('Uygulama dili')}><RadioGroup.Item value="tr" className={language==='tr'?'active':''}><strong>TR</strong><span>{t('Türkçe')}</span></RadioGroup.Item><RadioGroup.Item value="en" className={language==='en'?'active':''}><strong>EN</strong><span>{t('İngilizce')}</span></RadioGroup.Item></RadioGroup.Root><p className="field-help">{t('Türkçe varsayılan dildir. Tercihin bu cihazda saklanır.')}</p><label htmlFor="hour-format"><Clock3 size={15}/>{t('Saat gösterimi')}</label><select id="hour-format" value={hourFormat} onChange={e=>onHourFormat(e.target.value)}><option value="24">{t('24 saat — 18:30')}</option><option value="12">{t('12 saat — 06:30 PM')}</option></select><p className="field-help">{t('Takvim, gönderiler ve işlem geçmişindeki bütün saatlere uygulanır. Tercihin bu cihazda saklanır.')}</p></div></section><div className="notice setup-note"><Settings2 size={22}/><div><strong>{t('Bir kez kur, hesaplarını kolayca bağla.')}</strong><p>{t('Her platformun geliştirici panelindeki uygulama bilgilerini kaydet. Dönüş adresini o panelde de birebir aynı şekilde tanımla.')}</p></div></div><div className="connection-grid">{platforms.map(p=><OAuthApp key={p.id} p={p} saved={settings.oauth_apps?.find((a:any)=>a.platform===p.id)} refresh={refresh} origin={settings.app_origin}/>)}</div><div className="notice"><ShieldCheck size={18}/><span>{t(settings.queue==='local'?'Yerel geliştirme işleyicisi çalışıyor. Docker dağıtımında PostgreSQL, Redis ve Celery servisleri kullanılır.':'Gönderimler Redis ve Celery üzerinden arka planda işlenir.')} {t(settings.storage==='cloudinary'?'Medya Cloudinary’de saklanır ve oradan platformlara sunulur.':'Medya sunucu diskinde saklanır.')}</span></div></>}
function OAuthApp({p,saved,refresh,origin}:any){
const [draft,setDraft]=useState(()=>settingsDraft(saved,origin,p.id)),[baseline,setBaseline]=useState(()=>settingsDraft(saved,origin,p.id)),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[hasSecret,setHasSecret]=useState(false);
const {client,redirect,mode}=draft;
const dirty=settingsDraftChanged(draft,baseline,secret),configured=!!saved||accepted;
const needsSave=settingsSaveNeeded(configured,draft,baseline,secret);
const [copying,setCopying]=useState(false),[copyResult,setCopyResult]=useState<{value:string;ok:boolean}|null>(null);
const setClient=(client:string)=>setDraft(current=>({...current,client}));
const setRedirect=(redirect:string)=>setDraft(current=>({...current,redirect}));
const setMode=(mode:string)=>setDraft(current=>({...current,mode}));
const incoming=useRef(settingsDraft(saved,origin,p.id));
const reportPending=useNavigationSafety(undefined,false,dirty);
const actions=useRef(new KeyedActions()),mounted=useRef(true);
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
useEffect(()=>{const next=settingsDraft(saved,origin,p.id),previous=incoming.current;incoming.current=next;setDraft(current=>mergeSettingsDraft(current,previous,next));setBaseline(next)},[saved?.client_id,saved?.redirect_uri,saved?.mode,origin,p.id]);
async function save(event:any){
event.preventDefault();
if(!needsSave)return;
const payload={platform:p.id,client_id:client,client_secret:secret,redirect_uri:redirect,mode};
try{await actions.current.run('save',async()=>{
reportPending(true);setBusy(true);setError('');
try{await saveThenRefresh({
save:()=>api('settings/oauth',payload),
saved:()=>{if(mounted.current){const stored={client:payload.client_id,redirect:payload.redirect_uri,mode:payload.mode};incoming.current=stored;setBaseline(stored);setSecret('');setAccepted(true);if(payload.client_secret)setHasSecret(true);toast.success(t('Uygulama ayarları kaydedildi.'))}},
refresh:async()=>{if(mounted.current)return await refresh()},
refreshFailed:()=>{if(mounted.current)toast.warning(t('Ayarlar kaydedildi ancak güncel durum alınamadı. Listeyi yenileyebilirsin.'))},
})}finally{if(mounted.current){reportPending(false);setBusy(false)}}
})}catch(e:any){if(mounted.current){setError(e.message);toast.error(t(e.message))}}
}
async function copyRedirect(){
const value=redirect;if(!value.trim()||actions.current.has('save'))return;
await actions.current.run('copy-redirect',async()=>{setCopying(true);setCopyResult(null);try{await copyToClipboard(value);if(mounted.current)setCopyResult({value,ok:true})}catch{if(mounted.current)setCopyResult({value,ok:false})}finally{if(mounted.current)setCopying(false)}});
}
return <section className="panel connection"><div className="connection-heading"><span className="platform-icon large" style={{background:p.color}}>{p.symbol}</span><h2>{p.name}</h2><span className="pill">{t(saved||accepted?'Tanımlı':'Kurulum gerekli')}</span></div>
<form onSubmit={save} aria-busy={busy} aria-label={`${p.name} ${t('Uygulama ayarları')}`}>
<label>{t(p.id==='tiktok'?'Client key':'Uygulama / Client ID')}<input disabled={busy} value={client} onChange={e=>setClient(e.target.value)} required/></label>
<label>{t('Uygulama gizli anahtarı')}<input disabled={busy} type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder={t(saved?.has_secret||hasSecret?'Kayıtlı · değiştirmeyeceksen boş bırak':'Client secret')}/></label>
{p.id==='tiktok'&&<label>{t('Login Kit türü')}<Select disabled={busy} value={mode} onValueChange={setMode}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="web">{t('Web — HTTPS adres')}</SelectItem><SelectItem value="desktop">{t('Desktop — localhost + PKCE')}</SelectItem></SelectContent></Select></label>}
<label>{t('Dönüş adresi')}<input disabled={busy} type="url" value={redirect} onChange={e=>setRedirect(e.target.value)} required/></label>
<div className="callback-copy"><button type="button" className="secondary" disabled={busy||copying||!redirect.trim()} onClick={()=>void copyRedirect()}>{copyResult?.value===redirect&&copyResult.ok?<Check size={15} aria-hidden="true"/>:<Copy size={15} aria-hidden="true"/>}{t('Dönüş adresini kopyala')}</button>{copyResult?.value===redirect&&<span role="status">{t(copyResult.ok?'Kopyalandı.':'Kopyalanamadı. Metni seçip elle kopyalayabilirsin.')}</span>}</div>
<p className="field-help">{t(p.id==='x'?'tweet.read, tweet.write, users.read, media.write ve offline.access izinlerini etkinleştir.':p.id==='instagram'?'Instagram Login ve instagram_business_content_publish iznini etkinleştir.':p.id==='tiktok'?'user.info.basic ve video.upload izinlerini etkinleştir. Web ve Desktop dönüş adresi kuralları farklıdır.':'WhatsApp Business Management ve Messaging izinlerini etkinleştir. Meta işletme doğrulaması gerekebilir.')}</p>
{error&&<p className="error" role="alert">{t(error)}</p>}
<div className="settings-save-row"><button className="primary" disabled={busy||!needsSave}>{t(busy?'Kaydediliyor…':'Ayarları kaydet')}</button>{(dirty||configured)&&<span className={'settings-draft-state '+(dirty?'is-dirty':'')} role="status">{t(dirty?'Kaydedilmemiş değişiklikler':'Kaydedilmemiş değişiklik yok.')}</span>}</div></form></section>
}
