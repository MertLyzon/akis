import {useEffect,useRef,useState} from 'react';
import {Layers3,ShieldCheck,UserPlus} from 'lucide-react';
import {api,ApiError,roleNames,setCompany} from './api';
import {locale,t} from './i18n';
import {KeyedActions,LatestRequest} from './libraryRequests';
import {normalizedTotpCode} from './accountSecurity';
import {needsAuthenticator,parseInviteToken} from './authFlow';

// Browser invitation links keep the token in the fragment, not the page query string.
// Lookup and acceptance send it only to the invitation API.
export function inviteToken(){return parseInviteToken(location.hash)}

export default function Invite({token,onDone}:{token:string;onDone:()=>void}){
const [info,setInfo]=useState<any>(null),[error,setError]=useState(''),[mode,setMode]=useState<'existing'|'new'>('existing'),[password,setPassword]=useState(''),[again,setAgain]=useState(''),[name,setName]=useState(''),[code,setCode]=useState(''),[needsCode,setNeedsCode]=useState(false),[busy,setBusy]=useState(false);
const [checking,setChecking]=useState(true);
const actions=useRef(new KeyedActions()),lookup=useRef(new LatestRequest()),mounted=useRef(true),context=useRef(token);
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;lookup.current.invalidate()}},[]);
function load(){setChecking(true);setError('');return lookup.current.run(()=>api('invites/'+token),setInfo,(err:any)=>setError(err.message),()=>setChecking(false))}
useEffect(()=>{context.current=token;setInfo(null);setPassword('');setAgain('');setName('');setCode('');setNeedsCode(false);setMode('existing');load();return()=>lookup.current.invalidate()},[token]);
function leave(){if(actions.current.has('accept'))return;history.replaceState(null,'',location.pathname+location.search);onDone()}
function submit(event:any){event.preventDefault();if(checking||!info||parseInviteToken(location.hash)!==token||actions.current.has('accept'))return;setError('');
if(mode==='new'&&password!==again){setError(t('Parolalar eşleşmiyor.'));return}
const normalized=needsCode?normalizedTotpCode(code):'';
if(needsCode&&!normalized){setError(t('Doğrulama uygulamasındaki 6 haneli kodu gir.'));return}
const requested=token;
const current=()=>mounted.current&&context.current===requested&&parseInviteToken(location.hash)===requested;
return actions.current.run('accept',async()=>{
setBusy(true);
try{const result=await api(`invites/${requested}/accept`,{password,code:normalized,name:mode==='new'?name:''});if(current()){setCompany(result.company_id);setPassword('');setAgain('');setCode('');history.replaceState(null,'',location.pathname+location.search);onDone()}}
catch(err:any){if(!current())return;if(err instanceof ApiError&&needsAuthenticator(err.status,err.data)&&!needsCode){setNeedsCode(true);setCode('')}else setError(t(err instanceof ApiError&&err.status===401?(mode==='new'?'Bu e-postayla zaten bir Akış hesabın var gibi görünüyor. “Hesabım var” seçeneğiyle mevcut parolanı gir.':'E-posta, parola veya doğrulama kodu yanlış.'):err.message))}
finally{if(current())setBusy(false)}
});
}
return <div className="login-screen"><div className="panel login-card"><div className="brand"><span className="brand-icon"><Layers3/></span>akış.</div>
<h1><UserPlus size={22}/> {t('Ekibe katıl')}</h1>
{checking&&<p className="field-help" role="status">{t('Davet kontrol ediliyor…')}</p>}
{info&&<><p className="field-help"><strong>{info.company}</strong> {t('seni')} <strong>{t(roleNames[info.role]||info.role)}</strong> {t('olarak davet etti. Davet')} {new Date(info.expires_at*1000).toLocaleDateString(locale())} {t('tarihine kadar geçerli.')}</p>
<form onSubmit={submit} aria-label={t('Daveti kabul et')} aria-busy={busy}>
{!needsCode&&<div className="theme-switch invite-mode" role="group" aria-label={t('Hesap durumu')}><button type="button" disabled={busy} aria-pressed={mode==='existing'} onClick={()=>{setMode('existing');setError('')}}>{t('Hesabım var')}</button><button type="button" disabled={busy} aria-pressed={mode==='new'} onClick={()=>{setMode('new');setError('')}}>{t('Yeni hesap')}</button></div>}
<label>{t('E-posta')}<input type="email" value={info.email} readOnly autoComplete="username"/></label>
{!needsCode?<>
  {mode==='new'&&<label>{t('Ad Soyad · isteğe bağlı')}<input disabled={busy} value={name} onChange={e=>setName(e.target.value)} autoComplete="name" maxLength={120}/></label>}
  <label>{t(mode==='new'?'Yeni parola · en az 10 karakter':'Akış parolan')}<input disabled={busy} type="password" required minLength={10} maxLength={300} autoComplete={mode==='new'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>
  {mode==='new'&&<label>{t('Yeni parola tekrar')}<input disabled={busy} type="password" required minLength={10} maxLength={300} autoComplete="new-password" value={again} onChange={e=>setAgain(e.target.value)}/></label>}
</>:<><p className="field-help"><ShieldCheck size={15}/> {t('Doğrulama uygulamandaki 6 haneli kodu gir.')}</p><label>{t('Doğrulama kodu')}<input disabled={busy} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 \-]{6,12}" maxLength={12} autoFocus required value={code} onChange={e=>setCode(e.target.value)}/></label></>}
<button className="primary" disabled={busy}>{t(busy?'Kontrol ediliyor…':'Daveti kabul et')}</button>
{needsCode&&<button type="button" className="inline-link" disabled={busy} onClick={()=>{if(!actions.current.has('accept')){setNeedsCode(false);setCode('');setError('')}}}>{t('Geri dön')}</button>}
</form></>}
{error&&<p className="error" role="alert">{error}</p>}
{!info&&!checking&&error&&<button className="secondary" type="button" onClick={()=>load()}>{t('Tekrar dene')}</button>}
<button type="button" className="inline-link" disabled={busy} onClick={leave}>{t('Davet olmadan devam et')}</button>
</div></div>}
