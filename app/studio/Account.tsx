import {useEffect,useRef,useState} from 'react';
import {KeyRound,ShieldCheck,Smartphone,MonitorSmartphone} from 'lucide-react';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {toast} from 'sonner';
import {api} from './api';
import {t} from './i18n';
import {KeyedActions} from './libraryRequests';
import {saveThenRefresh} from './settingsSave';
import {normalizedTotpCode,parseTotpSetup} from './accountSecurity';
import {useNavigationSafety} from './useNavigationSafety';

type Action='password'|'setup'|'enable'|'disable'|'revoke';
export default function Account({me,refreshSession,onNavigationState}:any){
const [setup,setSetup]=useState<{secret:string;uri:string}|null>(null),[code,setCode]=useState(''),[pw,setPw]=useState({current:'',next:'',again:''}),[off,setOff]=useState({password:'',code:''}),[showDisable,setShowDisable]=useState(false),[revoke,setRevoke]=useState(false),[active,setActive]=useState<Action|null>(null),[error,setError]=useState<{action:Action;message:string}|null>(null),[enabled,setEnabled]=useState(!!me.totp_enabled),[passwordChanged,setPasswordChanged]=useState(false);
const actions=useRef(new KeyedActions()),mounted=useRef(true),latestRefresh=useRef(refreshSession);
const reportPending=useNavigationSafety(onNavigationState,!!setup);
latestRefresh.current=refreshSession;
const busy=active!==null;
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
useEffect(()=>{setEnabled(!!me.totp_enabled)},[me.totp_enabled]);
function report(action:Action,message:string){setError({action,message});toast.error(t(message))}
async function call(action:Action,path:string,body:any,message:string,done?:(result:any)=>void){
try{return await actions.current.run('account',async()=>{
reportPending(true);setActive(action);setError(null);
let result:any;
try{await saveThenRefresh({
save:async()=>{result=await api(path,body);if(action==='setup')result=parseTotpSetup(result)},
saved:()=>{if(mounted.current){done?.(result);if(message)toast.success(t(message))}},
refresh:async()=>{if(action!=='setup'&&mounted.current)await latestRefresh.current()},
refreshFailed:()=>{if(mounted.current)toast.warning(t('İşlem tamamlandı ancak hesap durumu yenilenemedi. Sayfayı tekrar yenile.'))},
})}finally{if(mounted.current){reportPending(false);setActive(null)}}
})}catch(e:any){if(mounted.current)report(action,e.message);return false}
}
function changePassword(event:any){
event.preventDefault();if(actions.current.has('account'))return;
if(pw.next!==pw.again){report('password','Yeni parolalar eşleşmiyor.');return}
return call('password','me/password',{current:pw.current,new:pw.next},'Parolan değiştirildi.',()=>{setPw({current:'',next:'',again:''});setPasswordChanged(true)});
}
function enable(event:any){
event.preventDefault();if(actions.current.has('account'))return;
const normalized=normalizedTotpCode(code);if(!normalized){report('enable','Doğrulama uygulamasındaki 6 haneli kodu gir.');return}
return call('enable','me/2fa/enable',{code:normalized},'İki aşamalı giriş açıldı.',()=>{setEnabled(true);setSetup(null);setCode('')});
}
function disable(event:any){
event.preventDefault();if(actions.current.has('account'))return;
const normalized=normalizedTotpCode(off.code);if(!normalized){report('disable','Doğrulama uygulamasındaki 6 haneli kodu gir.');return}
return call('disable','me/2fa/disable',{password:off.password,code:normalized},'İki aşamalı giriş kapatıldı.',()=>{setEnabled(false);setOff({password:'',code:''});setShowDisable(false)});
}
const passwordError=error?.action==='password',totpError=error&&['setup','enable','disable'].includes(error.action);
return <div className="account">
{me.must_change_password&&!passwordChanged&&<div className="expiry expiry-warn"><KeyRound size={17}/><span>{t('Hesabın geçici parolayla açıldı. Devam etmeden önce kendi parolanı belirle.')}</span></div>}
<section className="panel pad"><h2><KeyRound size={18}/>{t('Parola')}</h2><p className="field-help">{me.email} · {t('Parolan değişince diğer cihazlardaki oturumlar kapanır.')}</p>
<form className="form-grid" aria-label={t('Parolayı değiştir')} aria-busy={active==='password'} onSubmit={changePassword}>
<label>{t('Mevcut parola')}<input disabled={busy} type="password" autoComplete="current-password" required maxLength={300} value={pw.current} onChange={e=>setPw({...pw,current:e.target.value})}/></label>
<label>{t('Yeni parola · en az 10 karakter')}<input disabled={busy} type="password" autoComplete="new-password" minLength={10} maxLength={300} required value={pw.next} onChange={e=>setPw({...pw,next:e.target.value})}/></label>
<label>{t('Yeni parola tekrar')}<input disabled={busy} type="password" autoComplete="new-password" minLength={10} maxLength={300} required value={pw.again} onChange={e=>setPw({...pw,again:e.target.value})}/></label>
{passwordError&&<p className="error wide" role="alert">{t(error.message)}</p>}
<button className="primary" disabled={busy}>{t(active==='password'?'İşlem sürüyor…':'Parolayı değiştir')}</button></form></section>
<section className="panel pad"><h2><ShieldCheck size={18}/>{t('İki aşamalı giriş')}</h2>
{totpError&&<p className="error" role="alert">{t(error.message)}</p>}
{enabled?<><p className="field-help"><span className="pill saved">{t('Açık')}</span> {t('Hesabın korunuyor. Bundan sonraki girişlerde parolana ek olarak doğrulama uygulamandaki kod istenir.')}</p>
{!showDisable?<button className="secondary account-disable-toggle" disabled={busy} onClick={()=>{setError(null);setShowDisable(true)}}>{t('İki aşamalı girişi kapat')}</button>:<div className="totp-disable"><p className="field-help">{t('Yalnızca iki aşamalı korumayı kapatmak istiyorsan parolanı ve doğrulama uygulamandaki güncel kodu gir.')}</p>
<form className="form-grid" aria-label={t('İki aşamalı girişi kapat')} aria-busy={active==='disable'} onSubmit={disable}>
<label>{t('Mevcut parola')}<input disabled={busy} type="password" autoComplete="current-password" required maxLength={300} value={off.password} onChange={e=>setOff({...off,password:e.target.value})}/></label>
<label>{t('Doğrulama uygulamasındaki 6 haneli kod')}<input disabled={busy} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 \-]{6,12}" maxLength={12} required value={off.code} onChange={e=>setOff({...off,code:e.target.value})}/></label>
<div className="account-disable-actions"><button className="secondary" disabled={busy}>{t(active==='disable'?'İşlem sürüyor…':"2FA'yı kapat")}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setShowDisable(false);setOff({password:'',code:''});setError(null)}}>{t('Vazgeç')}</button></div></form></div>}</>:
!setup?<><p className="field-help">{t('Google Authenticator, Microsoft Authenticator, 1Password veya Authy gibi bir uygulama ile hesabını koru. Şirket hesapları için önerilir.')}</p><button className="primary" disabled={busy} onClick={()=>call('setup','me/2fa/setup',{},'',result=>{setSetup(result);setCode('')})}><Smartphone size={15}/>{t(active==='setup'?'İşlem sürüyor…':'Kurulumu başlat')}</button></>:
<div className="totp-setup"><ol><li>{t('Doğrulama uygulamanda yeni hesap ekle → kurulum anahtarı gir seçeneğini aç.')}</li><li>{t('Bu anahtarı gir (zaman tabanlı):')} <code className="totp-secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code> <a className="inline-link" href={setup.uri}>{t('Telefondaysan uygulamada aç')}</a></li><li>{t('Uygulamanın gösterdiği 6 haneli kodu aşağıya yaz.')}</li></ol>
<form className="member-add" aria-label={t('Doğrula ve aç')} aria-busy={active==='enable'} onSubmit={enable}>
<input disabled={busy} inputMode="numeric" autoComplete="one-time-code" aria-label={t('6 haneli kod')} placeholder={t('6 haneli kod')} pattern="[0-9 \-]{6,12}" maxLength={12} required value={code} onChange={e=>setCode(e.target.value)}/>
<button className="primary" disabled={busy}>{t(active==='enable'?'İşlem sürüyor…':'Doğrula ve aç')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setSetup(null);setCode('');setError(null)}}>{t('Vazgeç')}</button></form></div>}</section>
<section className="panel pad"><h2><MonitorSmartphone size={18}/>{t('Açık oturumlar')}</h2><p className="field-help">{t('Telefonunu kaybettiysen veya ortak bir bilgisayarda oturumun açık kaldıysa, bu cihaz dışındaki tüm tarayıcı ve uygulama oturumlarını kapat.')}</p><button className="secondary" disabled={busy} onClick={()=>{if(!actions.current.has('account')){setError(null);setRevoke(true)}}}>{t('Diğer cihazlardan çıkış yap')}</button></section>
<AlertDialog open={revoke} onOpenChange={open=>{if(!actions.current.has('account'))setRevoke(open)}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('Diğer cihazlardan çıkış yap')}</AlertDialogTitle><AlertDialogDescription>{t('Bu cihaz dışındaki tüm oturumlar kapatılsın mı?')}</AlertDialogDescription></AlertDialogHeader>{error?.action==='revoke'&&<p className="error" role="alert">{t(error.message)}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>{t('Vazgeç')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event=>{event.preventDefault();call('revoke','me/sessions/revoke',{},'Diğer cihazlardaki oturumlar kapatıldı.',()=>setRevoke(false))}}>{t(active==='revoke'?'İşlem sürüyor…':'Onayla')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
</div>
}
