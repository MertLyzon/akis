import {useEffect,useState} from 'react';
import {Layers3,ShieldCheck,UserPlus} from 'lucide-react';
import {api,ApiError,roleNames,setCompany} from './api';

// Invitation links look like https://server/#davet=<token>. The token stays in the fragment,
// so it is never sent to the server in a URL and never reaches access logs.
export function inviteToken(){const m=location.hash.match(/^#davet=([\w-]{20,100})$/);return m?m[1]:''}

export default function Invite({token,onDone}:{token:string;onDone:()=>void}){
const [info,setInfo]=useState<any>(null),[error,setError]=useState(''),[mode,setMode]=useState<'existing'|'new'>('existing'),[password,setPassword]=useState(''),[again,setAgain]=useState(''),[name,setName]=useState(''),[code,setCode]=useState(''),[needsCode,setNeedsCode]=useState(false),[busy,setBusy]=useState(false);
useEffect(()=>{api('invites/'+token).then(setInfo).catch((e:any)=>setError(e.message))},[token]);
function leave(){history.replaceState(null,'',location.pathname+location.search);onDone()}
async function submit(e:any){e.preventDefault();setError('');
  if(mode==='new'&&password!==again){setError('Parolalar eşleşmiyor.');return}
  setBusy(true)
  try{const r=await api(`invites/${token}/accept`,{password,code,name:mode==='new'?name:''});setCompany(r.company_id);leave()}
  catch(err:any){if(err instanceof ApiError&&err.data?.needs_code&&!needsCode)setNeedsCode(true);else setError(err instanceof ApiError&&err.status===401?(mode==='new'?'Bu e-postayla zaten bir Akış hesabın var gibi görünüyor. “Hesabım var” seçeneğiyle mevcut parolanı gir.':'E-posta, parola veya doğrulama kodu yanlış.'):err.message)}
  finally{setBusy(false)}}
return <div className="login-screen"><div className="panel login-card"><div className="brand"><span className="brand-icon"><Layers3/></span>akış.</div>
<h1><UserPlus size={22}/> Ekibe katıl</h1>
{!info&&!error&&<p className="field-help">Davet kontrol ediliyor…</p>}
{info&&<><p className="field-help"><strong>{info.company}</strong> seni <strong>{roleNames[info.role]||info.role}</strong> olarak davet etti. Davet {new Date(info.expires_at*1000).toLocaleDateString('tr-TR')} tarihine kadar geçerli.</p>
<form onSubmit={submit}>
{!needsCode&&<div className="theme-switch invite-mode" role="group" aria-label="Hesap durumu"><button type="button" aria-pressed={mode==='existing'} onClick={()=>setMode('existing')}>Hesabım var</button><button type="button" aria-pressed={mode==='new'} onClick={()=>setMode('new')}>Yeni hesap</button></div>}
<label>E-posta<input type="email" value={info.email} readOnly autoComplete="username"/></label>
{!needsCode?<>
  {mode==='new'&&<label>Ad Soyad · isteğe bağlı<input value={name} onChange={e=>setName(e.target.value)} autoComplete="name" maxLength={120}/></label>}
  <label>{mode==='new'?'Yeni parola · en az 10 karakter':'Akış parolan'}<input type="password" required minLength={10} autoComplete={mode==='new'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>
  {mode==='new'&&<label>Yeni parola tekrar<input type="password" required minLength={10} autoComplete="new-password" value={again} onChange={e=>setAgain(e.target.value)}/></label>}
</>:<><p className="field-help"><ShieldCheck size={15}/> Doğrulama uygulamandaki 6 haneli kodu gir.</p><label>Doğrulama kodu<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" autoFocus required value={code} onChange={e=>setCode(e.target.value)}/></label></>}
<button className="primary" disabled={busy}>{busy?'Kontrol ediliyor…':'Daveti kabul et'}</button>
</form></>}
{error&&<p className="error" role="alert">{error}</p>}
<button type="button" className="inline-link" onClick={leave}>Davet olmadan devam et</button>
</div></div>}
