import {useEffect,useRef,useState} from 'react';
import {Layers3,ShieldCheck,Server} from 'lucide-react';
import {api,ApiError,isApp,serverUrl,setServer,checkServer,setToken,setCompany,forgetState} from './api';
import {t} from './i18n';
import {KeyedActions} from './libraryRequests';
import {normalizedTotpCode} from './accountSecurity';
import {needsAuthenticator} from './authFlow';

export default function Login({loading,sessionError='',onRetry,onChangeServer,onDone}:{loading:boolean;sessionError?:string;onRetry:()=>void;onChangeServer:()=>void;onDone:()=>void}){
const [server,setServerField]=useState(serverUrl()),[editingServer,setEditingServer]=useState(isApp&&!serverUrl()),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState(''),[needsCode,setNeedsCode]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
const actions=useRef(new KeyedActions()),mounted=useRef(true);
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
async function run(operation:()=>Promise<void>){
if(loading||sessionError)return;
try{await actions.current.run('login',async()=>{setBusy(true);setError('');try{await operation()}finally{if(mounted.current)setBusy(false)}})}catch(err:any){if(mounted.current)setError(err.message)}
}
function saveServer(event:any){event.preventDefault();const requested=server;return run(async()=>{
const checked=await checkServer(requested);if(!mounted.current)return;
if(checked!==serverUrl()){setToken('');setCompany('');forgetState();setEmail('');setPassword('');setCode('');setNeedsCode(false)}
setServer(checked);setServerField(checked);setEditingServer(false);
})}
function submit(event:any){
event.preventDefault();if(loading||actions.current.has('login'))return;
const normalized=needsCode?normalizedTotpCode(code):'';
if(needsCode&&!normalized){setError('Doğrulama uygulamasındaki 6 haneli kodu gir.');return}
return run(async()=>{
try{await api('login',{email,password,code:normalized});if(mounted.current){setPassword('');setCode('');onDone()}}
catch(err:any){if(!mounted.current)return;if(err instanceof ApiError&&needsAuthenticator(err.status,err.data)&&!needsCode){setNeedsCode(true);setCode('')}else throw err}
});
}
return <div className="login-screen"><div className="panel login-card"><div className="brand"><span className="brand-icon"><Layers3/></span>akış.</div><h1>{t(loading?'Stüdyon açılıyor…':sessionError?'Oturum kontrol edilemedi':editingServer?'Sunucuna bağlan':needsCode?'İki aşamalı doğrulama':'Şirket hesabına giriş')}</h1>
{!loading&&sessionError&&<><p className="error" role="alert">{t(sessionError)}</p><p className="field-help">{t('Bağlantını kontrol edip oturumunu yeniden kontrol et. Parolan tekrar gönderilmeyecek.')}</p><button type="button" className="primary" onClick={onRetry}>{t('Oturumu yeniden kontrol et')}</button>{isApp&&<button type="button" className="inline-link" onClick={()=>{setEditingServer(true);setError('');onChangeServer()}}>{t('Sunucu')}: {serverUrl().replace(/^https?:\/\//,'')} · {t('değiştir')}</button>}</>}
{!loading&&!sessionError&&editingServer&&<form onSubmit={saveServer} aria-busy={busy}><p className="field-help"><Server size={15}/> {t('Şirketinin Akış sunucusunun adresini gir. Bu adresi sistem yöneticinden alabilirsin.')}</p><label>{t('Sunucu adresi')}<input disabled={busy} type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://akis.sirketin.com" required value={server} onChange={e=>setServerField(e.target.value)}/></label><button className="primary" disabled={busy}>{t(busy?'Bağlanıyor…':'Devam et')}</button></form>}
{!loading&&!sessionError&&!editingServer&&<form onSubmit={submit} aria-busy={busy} aria-label={t('Şirket hesabına giriş')}>
{!needsCode?<><label>{t('E-posta')}<input disabled={busy} type="email" autoComplete="username" maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>{t('Parola')}<input disabled={busy} type="password" autoComplete="current-password" maxLength={300} required value={password} onChange={e=>setPassword(e.target.value)}/></label></>:<><p className="field-help"><ShieldCheck size={15}/> {t('Doğrulama uygulamandaki 6 haneli kodu gir.')}</p><label>{t('Doğrulama kodu')}<input disabled={busy} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 \-]{6,12}" maxLength={12} autoFocus required value={code} onChange={e=>setCode(e.target.value)}/></label></>}
<button className="primary" disabled={busy}>{t(busy?'Kontrol ediliyor…':needsCode?'Doğrula ve gir':'Giriş yap')}</button>
{isApp&&!needsCode&&<button type="button" className="inline-link" disabled={busy} onClick={()=>{if(!actions.current.has('login')){setEditingServer(true);setError('')}}}>{t('Sunucu')}: {serverUrl().replace(/^https?:\/\//,'')} · {t('değiştir')}</button>}
{needsCode&&<button type="button" className="inline-link" disabled={busy} onClick={()=>{if(!actions.current.has('login')){setNeedsCode(false);setCode('');setError('')}}}>{t('Geri dön')}</button>}</form>}
{error&&!sessionError&&<p className="error" role="alert">{t(error)}</p>}</div></div>
}
