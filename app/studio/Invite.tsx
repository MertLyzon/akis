import {useEffect,useId,useRef,useState} from 'react';
import {Layers3,ShieldCheck,UserPlus} from 'lucide-react';
import PasswordField from './PasswordField';
import {api,ApiError,roleNames,setCompany} from './api';
import {locale,t} from './i18n';
import {KeyedActions,LatestRequest} from './libraryRequests';
import {normalizedTotpCode} from './accountSecurity';
import {needsAuthenticator,parseInviteToken,parseInvitation,invitationUnavailable} from './authFlow';

// Browser invitation links keep the token in the fragment, not the page query string.
// Lookup and acceptance send it only to the invitation API.
export function inviteToken(){return parseInviteToken(location.hash)}

export default function Invite({token,onDone}:{token:string;onDone:()=>void}){
const [info,setInfo]=useState<any>(null),[error,setError]=useState(''),[mode,setMode]=useState<'existing'|'new'>('existing'),[password,setPassword]=useState(''),[again,setAgain]=useState(''),[name,setName]=useState(''),[code,setCode]=useState(''),[needsCode,setNeedsCode]=useState(false),[busy,setBusy]=useState(false);
const [checking,setChecking]=useState(true);
const [unavailable,setUnavailable]=useState(false);
const [mismatch,setMismatch]=useState(false),confirmationId=useId(),errorId=useId();
function editPassword(value:string,confirmation=false){if(confirmation)setAgain(value);else setPassword(value);if(mismatch){setMismatch(false);setError('')}}
const lookupPending=useRef(false),terminal=useRef(false);
const actions=useRef(new KeyedActions()),lookup=useRef(new LatestRequest()),mounted=useRef(true),context=useRef(token);
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;lookup.current.invalidate()}},[]);
function load(force=false){
if(!force&&lookupPending.current)return Promise.resolve(false);
lookupPending.current=true;terminal.current=false;setUnavailable(false);setChecking(true);setError('');
return lookup.current.run(async()=>parseInvitation(await api('invites/'+token)),setInfo,(err:any)=>{if(err instanceof ApiError&&invitationUnavailable(err.status)){terminal.current=true;setUnavailable(true)}setError(err.message)},()=>{lookupPending.current=false;setChecking(false)});
}
useEffect(()=>{context.current=token;setInfo(null);setPassword('');setAgain('');setMismatch(false);setName('');setCode('');setNeedsCode(false);setMode('existing');load(true);return()=>{lookup.current.invalidate();lookupPending.current=false}},[token]);
function leave(){if(actions.current.has('accept'))return;history.replaceState(null,'',location.pathname+location.search);onDone()}
function submit(event:any){event.preventDefault();if(checking||terminal.current||!info||parseInviteToken(location.hash)!==token||actions.current.has('accept'))return;setError('');
if(mode==='new'&&password!==again){setMismatch(true);setError(t('Parolalar eşleşmiyor.'));document.getElementById(confirmationId)?.focus();return}
const normalized=needsCode?normalizedTotpCode(code):'';
if(needsCode&&!normalized){setError(t('Doğrulama uygulamasındaki 6 haneli kodu gir.'));return}
const requested=token;
const current=()=>mounted.current&&context.current===requested&&parseInviteToken(location.hash)===requested;
return actions.current.run('accept',async()=>{
setBusy(true);
try{const result=await api(`invites/${requested}/accept`,{password,code:normalized,name:mode==='new'?name:''});if(current()){setCompany(result.company_id);setPassword('');setAgain('');setCode('');history.replaceState(null,'',location.pathname+location.search);onDone()}}
catch(err:any){if(!current())return;if(err instanceof ApiError&&needsAuthenticator(err.status,err.data)&&!needsCode){setNeedsCode(true);setCode('')}else{if(err instanceof ApiError&&invitationUnavailable(err.status)){terminal.current=true;setUnavailable(true);setInfo(null);setPassword('');setAgain('');setCode('');setNeedsCode(false)}setError(t(err instanceof ApiError&&err.status===401?(mode==='new'?'Bu e-postayla zaten bir Akış hesabın var gibi görünüyor. “Hesabım var” seçeneğiyle mevcut parolanı gir.':'E-posta, parola veya doğrulama kodu yanlış.'):err.message))}}
finally{if(current())setBusy(false)}
});
}
return <div className="login-screen"><div className="panel login-card"><div className="brand"><span className="brand-icon"><Layers3/></span>akış.</div>
<h1><UserPlus size={22}/> {t('Ekibe katıl')}</h1>
{checking&&<p className="field-help" role="status">{t('Davet kontrol ediliyor…')}</p>}
{info&&<><p className="field-help"><strong>{info.company}</strong> {t('seni')} <strong>{t(roleNames[info.role]||info.role)}</strong> {t('olarak davet etti. Davet')} {new Date(info.expires_at*1000).toLocaleDateString(locale())} {t('tarihine kadar geçerli.')}</p>
<form onSubmit={submit} aria-label={t('Daveti kabul et')} aria-busy={busy}>
{!needsCode&&<div className="theme-switch invite-mode" role="group" aria-label={t('Hesap durumu')}><button type="button" disabled={busy} aria-pressed={mode==='existing'} onClick={()=>{setMode('existing');setMismatch(false);setError('')}}>{t('Hesabım var')}</button><button type="button" disabled={busy} aria-pressed={mode==='new'} onClick={()=>{setMode('new');setMismatch(false);setError('')}}>{t('Yeni hesap')}</button></div>}
<label>{t('E-posta')}<input type="email" value={info.email} readOnly autoComplete="username"/></label>
{!needsCode?<>
  {mode==='new'&&<label>{t('Ad Soyad · isteğe bağlı')}<input disabled={busy} value={name} onChange={e=>setName(e.target.value)} autoComplete="name" maxLength={120}/></label>}
  <PasswordField label={t(mode==='new'?'Yeni parola · en az 10 karakter':'Akış parolan')} disabled={busy} required minLength={10} maxLength={300} autoComplete={mode==='new'?'new-password':'current-password'} value={password} onChange={e=>editPassword(e.target.value)}/>
  {mode==='new'&&<PasswordField id={confirmationId} label={t('Yeni parola tekrar')} aria-invalid={mismatch||undefined} aria-describedby={mismatch?errorId:undefined} disabled={busy} required minLength={10} maxLength={300} autoComplete="new-password" value={again} onChange={e=>editPassword(e.target.value,true)}/>}
</>:<><p className="field-help"><ShieldCheck size={15}/> {t('Doğrulama uygulamandaki 6 haneli kodu gir.')}</p><label>{t('Doğrulama kodu')}<input disabled={busy} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 \-]{6,12}" maxLength={12} autoFocus required value={code} onChange={e=>setCode(e.target.value)}/></label></>}
<button className="primary" disabled={busy}>{t(busy?'Kontrol ediliyor…':'Daveti kabul et')}</button>
{needsCode&&<button type="button" className="inline-link" disabled={busy} onClick={()=>{if(!actions.current.has('accept')){setNeedsCode(false);setCode('');setError('')}}}>{t('Geri dön')}</button>}
</form></>}
{error&&<p id={errorId} className="error" role="alert">{error}</p>}
{unavailable&&<p className="field-help">{t('Bu davet artık kullanılamıyor. Şirket yöneticinden yeni bir davet bağlantısı iste.')}</p>}
{!info&&!checking&&error&&!unavailable&&<button className="secondary" type="button" onClick={()=>load()}>{t('Tekrar dene')}</button>}
<button type="button" className="inline-link" disabled={busy} onClick={leave}>{t('Davet olmadan devam et')}</button>
</div></div>}
