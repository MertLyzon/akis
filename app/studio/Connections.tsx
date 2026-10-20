import {useEffect,useRef,useState} from 'react';
import {Link2,RefreshCw,ShieldCheck,Clock3,AlertTriangle} from 'lucide-react';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {toast} from 'sonner';
import {platforms,api,dateInput,isApp,serverUrl,openExternal} from './api';
import {Checkbox} from '@/components/ui/checkbox';
import {t} from './i18n';
import {KeyedActions} from './libraryRequests';
import {saveThenRefresh,refreshWithWarning} from './settingsSave';
import {ConnectionDraft,connectionDraftChanged,isOAuthResult,mergeConnectionDraft} from './connectionDraft';
import {useNavigationSafety} from './useNavigationSafety';
import {connectionStatus} from './connectionStatus';

export default function Connections({connections,settings,refresh,onSettings}:any){
const saved=platforms.map(p=>connections.find((c:any)=>c.platform===p.id)).filter(Boolean);
const attention=saved.filter(connection=>connectionStatus(connection).attention).length;
return <><div className={'connection-banner '+(attention?'is-warning':'')}>{attention?<AlertTriangle aria-hidden="true"/>:<ShieldCheck aria-hidden="true"/>}<div><strong>{t(attention?'{count} bağlantı kontrol gerektiriyor.':saved.length?'{count} platform hesabı kayıtlı.':'Henüz hesap bağlı değil.',{count:attention||saved.length})}</strong><p>{t(attention?'Aşağıdaki uyarıları incele. Gerekiyorsa hesabı yeniden bağla; kayıtlı olması erişimin hâlâ geçerli olduğunu garanti etmez.':'Erişim ve yenileme anahtarları şifreli saklanır. Desteklenen hesaplar arka planda yenilenir.')}</p></div></div><div className="connection-grid">{platforms.map(p=><Connection key={p.id} p={p} saved={connections.find((c:any)=>c.platform===p.id)} app={settings.oauth_apps?.find((a:any)=>a.platform===p.id)} refresh={refresh} onSettings={onSettings}/>)}</div></>}

function fields(saved:any):ConnectionDraft{return {account:saved?.account||'',label:saved?.label||'',expiry:dateInput(saved?.expires_at),refreshExpiry:dateInput(saved?.refresh_expires_at),long:saved?.token_kind==='long_lived'}}
function Connection({p,saved,app,refresh,onSettings}:any){
const [token,setToken]=useState(''),[refreshToken,setRefreshToken]=useState(''),[draft,setDraft]=useState(()=>fields(saved)),[baseline,setBaseline]=useState(()=>fields(saved)),[busy,setBusy]=useState(false),[oauthOpen,setOAuthOpen]=useState(false),[removing,setRemoving]=useState(false),[error,setError]=useState('');
const previous=useRef(fields(saved)),actions=useRef(new KeyedActions()),mounted=useRef(true),operationPending=useRef(false),popup=useRef<Window|null>(null),popupOrigin=useRef(''),latestRefresh=useRef(refresh);
const oauthResultPending=useRef(false);
const [oauthRefreshing,setOAuthRefreshing]=useState(false),[oauthRefreshFailed,setOAuthRefreshFailed]=useState(false);
const reportPending=useNavigationSafety(undefined,false,connectionDraftChanged(draft,baseline,token,refreshToken));
latestRefresh.current=refresh;
const locked=busy||oauthOpen||oauthRefreshing;
const status=connectionStatus(saved);
function syncPending(){reportPending(operationPending.current||oauthResultPending.current||!!(popup.current&&!popup.current.closed))}
function edit<K extends keyof ConnectionDraft>(key:K,value:ConnectionDraft[K]){setDraft(current=>({...current,[key]:value}))}
function closePopup(){const current=popup.current;popup.current=null;try{current?.close()}catch{};if(mounted.current){setOAuthOpen(false);syncPending()}}
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;closePopup()}},[]);
useEffect(()=>{const incoming=fields(saved),before=previous.current;previous.current=incoming;setDraft(current=>mergeConnectionDraft(current,before,incoming));setBaseline(incoming)},[saved?.id,saved?.expires_at,saved?.account,saved?.label,saved?.token_kind,saved?.refresh_expires_at]);
useEffect(()=>{
const handle=(event:MessageEvent)=>{
if(!isOAuthResult(event,popup.current,popupOrigin.current))return;
void refreshOAuthState(()=>{closePopup();event.data.ok?toast.success(event.data.message):toast.error(event.data.message)});
};
window.addEventListener('message',handle);return()=>window.removeEventListener('message',handle);
},[]);
useEffect(()=>{if(!oauthOpen)return;const id=setInterval(()=>{if(!popup.current||popup.current.closed){popup.current=null;setOAuthOpen(false);syncPending()}},500);return()=>clearInterval(id)},[oauthOpen]);

async function refreshOAuthState(start?:()=>void){
if(oauthResultPending.current)return;
oauthResultPending.current=true;setOAuthRefreshing(true);setOAuthRefreshFailed(false);syncPending();
try{
start?.();
await refreshWithWarning(()=>latestRefresh.current(),()=>{if(mounted.current){setOAuthRefreshFailed(true);toast.warning(t('Bağlantı durumu yenilenemedi. Listeyi tekrar yenile.'))}});
}finally{oauthResultPending.current=false;if(mounted.current){setOAuthRefreshing(false);syncPending()}}
}

async function guarded(operation:()=>Promise<void>){
if(oauthResultPending.current||popup.current&&!popup.current.closed)return false;
try{return await actions.current.run('connection',async()=>{operationPending.current=true;syncPending();setBusy(true);setError('');try{await operation()}finally{operationPending.current=false;if(mounted.current){setBusy(false);syncPending()}}})}
catch(e:any){if(mounted.current){setError(e.message);toast.error(t(e.message))}return false}
}
function commit(write:()=>Promise<unknown>,message:string,done?:()=>void){return guarded(()=>saveThenRefresh({
save:write,
saved:()=>{if(mounted.current){done?.();toast.success(t(message))}},
refresh:async()=>{if(mounted.current)return await latestRefresh.current()},
refreshFailed:()=>{if(mounted.current)toast.warning(t('İşlem tamamlandı ancak bağlantı durumu yenilenemedi. Listeyi tekrar yenile.'))},
}))}
function connect(){
// Resolve navigation before taking the operation lock, so the settings shortcut can be guarded too.
if(!isApp&&!app){onSettings();toast.info(t('Önce bu platformun uygulama bilgilerini kaydet.'));return}
return guarded(async()=>{
if(isApp){await openExternal(serverUrl()+'/');if(mounted.current)toast.info(t('Hesap bağlama güvenlik nedeniyle tarayıcıda yapılır. Açılan sayfada giriş yapıp Bağlantılar ekranından devam et.'));return}
// Keep each platform's window separate; capture the expected callback origin for this flow.
popupOrigin.current=new URL(app.redirect_uri).origin;
const current=window.open('about:blank','akis-connect-'+p.id,'width=600,height=760');
if(!current)throw Error('Bağlantı penceresi engellendi. Açılır pencerelere izin ver.');
popup.current=current;setOAuthOpen(true);syncPending();
try{const result=await api('oauth/start',{platform:p.id,account:draft.account});if(mounted.current&&popup.current===current&&!current.closed)current.location.href=result.url}
catch(error){if(popup.current===current)closePopup();throw error}
})}
function submit(event:any){
event.preventDefault();
const snapshot={...draft};
return commit(()=>api('connections',{platform:p.id,token,refresh_token:refreshToken,account:snapshot.account,label:snapshot.label,expires_at:snapshot.expiry?Math.floor(new Date(snapshot.expiry).getTime()/1000):null,refresh_expires_at:snapshot.refreshExpiry?Math.floor(new Date(snapshot.refreshExpiry).getTime()/1000):null,token_kind:snapshot.long?'long_lived':'manual'}),'Bağlantı bilgileri kaydedildi.',()=>{previous.current=snapshot;setBaseline(snapshot);setToken('');setRefreshToken('')});
}
function remove(){return commit(()=>api('connections',{platform:p.id},'DELETE'),'Bağlantı kaldırıldı.',()=>{const empty=fields(null);previous.current=empty;setBaseline(empty);setDraft(empty);setToken('');setRefreshToken('');setRemoving(false)})}

return <section className="panel connection" aria-busy={locked}>
<div className="connection-heading"><span className="platform-icon large" style={{background:p.color}}>{p.symbol}</span><div><h2>{p.name}</h2><p>{saved?.label||t(p.hint)}</p></div><span className={'pill connection-state-'+status.tone}>{t(status.label)}</span></div>
{saved&&<div className={'expiry '+(status.attention?'expiry-warn':'')}><Clock3 size={17}/><div><strong>{saved.days_left==null?t('Bitiş tarihi belirtilmedi'):saved.days_left<=0?t('Bağlantının süresi doldu'):t('Bağlantı {days} gün sonra sona erecek',{days:saved.days_left})}</strong><p>{t(saved.can_refresh?'Otomatik yenileme açık.':'Otomatik yenileme yok; gerektiğinde yeniden bağlan.')}</p>{saved.refresh_error&&<p className="warn">{t(saved.refresh_error)}</p>}</div></div>}
<div className="oauth-actions"><button className="primary" disabled={locked} onClick={connect}><Link2 size={16}/>{t(saved?'Yeniden bağlan':'Hesapla bağlan')}</button>{saved?.can_refresh&&<button className="secondary" disabled={locked} onClick={()=>commit(()=>api('connections/refresh',{platform:p.id}),'Yenileme kontrolü tamamlandı.')}><RefreshCw size={15}/>{t('Yenile')}</button>}</div>
{oauthOpen&&<p role="status">{t('Hesap bağlantısı açılan pencerede bekleniyor.')} <button className="inline-link" type="button" onClick={closePopup}>{t('Bağlantı penceresini kapat')}</button></p>}
{oauthRefreshing&&<p role="status">{t('Bağlantı durumu kontrol ediliyor…')}</p>}
{oauthRefreshFailed&&<p className="error" role="alert">{t('Bağlantı durumu yenilenemedi. Listeyi tekrar yenile.')} <button type="button" className="inline-link" disabled={locked} onClick={()=>void refreshOAuthState()}>{t('Tekrar dene')}</button></p>}
{error&&!removing&&<p className="error" role="alert">{t(error)}</p>}
{!app&&<p className="field-help">{t('Tek tıkla bağlantı için')} <button className="inline-link" disabled={locked} onClick={onSettings}>{t('uygulama ayarlarını')}</button> {t('tamamla.')}</p>}
{p.id==='whatsapp'&&<label className="wa-account-label">{t('WhatsApp telefon numarası ID')}<input disabled={locked} value={draft.account} onChange={e=>edit('account',e.target.value)} placeholder={t('Meta panelindeki numara ID')} inputMode="numeric"/></label>}
<details className="manual-details"><summary>{t('Elle erişim bilgisi gir')}</summary><form onSubmit={submit} aria-label={`${p.name} ${t('Bağlantı bilgileri')}`}>
<label>{t('Hesap etiketi')}<input disabled={locked} value={draft.label} onChange={e=>edit('label',e.target.value)} placeholder={t('Örn. Marka hesabı')}/></label>
<label>{t(p.id==='x'?'OAuth 2.0 kullanıcı erişim anahtarı':'Erişim anahtarı')}<input disabled={locked} type="password" autoComplete="new-password" value={token} onChange={e=>setToken(e.target.value)} placeholder={t(saved?'Değiştirmeyeceksen boş bırak':'Access token')} required={!saved}/></label>
{p.id==='instagram'&&<label>{t('Instagram hesap ID')}<input disabled={locked} value={draft.account} onChange={e=>edit('account',e.target.value)} required pattern="[0-9]+"/></label>}
{['x','tiktok'].includes(p.id)&&<><label>{t('Yenileme anahtarı')}<input disabled={locked} type="password" autoComplete="new-password" value={refreshToken} onChange={e=>setRefreshToken(e.target.value)} placeholder={t(saved?.has_refresh?'Kayıtlı · değiştirmek için yaz':'Refresh token')}/></label><p className="field-help">{t('Yeni erişim anahtarı giriyorsan ona ait yenileme anahtarını da gir.')}</p><label>{t('Yenileme anahtarı bitiş tarihi')}<input disabled={locked} type="datetime-local" value={draft.refreshExpiry} onChange={e=>edit('refreshExpiry',e.target.value)}/></label></>}
<label>{t('Erişim anahtarı bitiş tarihi')}<input disabled={locked} type="datetime-local" value={draft.expiry} onChange={e=>edit('expiry',e.target.value)}/></label><p className="field-help">{t('Platformun verdiği gerçek tarihi kullan. Boş alan, sürenin bilinmediği anlamına gelir.')}</p>
{p.id==='instagram'&&<div className="inline-options"><Checkbox disabled={locked} id={'long-'+p.id} checked={draft.long} onCheckedChange={value=>edit('long',!!value)}/><label htmlFor={'long-'+p.id}>{t('Bu, uzun ömürlü Instagram token’ı')}</label></div>}
<div className="connection-actions"><button className="primary" disabled={locked}>{t(busy?'Kaydediliyor…':'Bilgileri kaydet')}</button>{saved&&<button className="text-button" disabled={locked} type="button" onClick={()=>{if(!actions.current.has('connection')){setError('');setRemoving(true)}}}>{t('Bağlantıyı kaldır')}</button>}</div>
</form></details>
<AlertDialog open={removing} onOpenChange={open=>{if(!actions.current.has('connection'))setRemoving(open)}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{p.name} · {t('Bağlantıyı kaldır')}</AlertDialogTitle><AlertDialogDescription>{t('Bu platformun kayıtlı erişim bilgileri kaldırılır. Yeniden bağlanman gerekir.')}</AlertDialogDescription></AlertDialogHeader>{error&&<p className="error" role="alert">{t(error)}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>{t('Vazgeç')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event=>{event.preventDefault();remove()}}>{t(busy?'İşlem sürüyor…':'Bağlantıyı kaldır')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
</section>
}
