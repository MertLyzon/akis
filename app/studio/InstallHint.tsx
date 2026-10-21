/// <reference types="vite/client" />
import {useEffect,useRef,useState} from 'react';
import {Download,Share,X} from 'lucide-react';
import {isApp} from './api';
import {t} from './i18n';
import {KeyedActions} from './libraryRequests';
import {requestInstall} from './installPrompt';

// Chrome/Edge/Android fire this before offering install; we keep it to show our own button.
let deferred:any=null;
if(typeof window!=='undefined')window.addEventListener('beforeinstallprompt',(e:any)=>{e.preventDefault();deferred=e;window.dispatchEvent(new Event('akis-installable'))});

const standalone=()=>matchMedia('(display-mode: standalone)').matches||(navigator as any).standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function dismissed(){try{return localStorage.getItem('akis-install-hint')==='hidden'}catch{return false}}

export function registerServiceWorker(){
  // Only for the web build served over HTTPS (or localhost); the Tauri apps bundle their files already.
  if(isApp||!('serviceWorker' in navigator)||import.meta.env.DEV)return;
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}

export default function InstallHint(){
  const [canPrompt,setCanPrompt]=useState(!!deferred),[hidden,setHidden]=useState(dismissed);
  const [busy,setBusy]=useState(false),[installError,setInstallError]=useState('');
  const actions=useRef(new KeyedActions()),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;const on=()=>{setCanPrompt(true);setInstallError('')};window.addEventListener('akis-installable',on);return()=>{mounted.current=false;window.removeEventListener('akis-installable',on)}},[]);
  if(isApp||hidden||standalone())return null;
  const ios=isIOS();
  if(!ios&&!canPrompt&&!installError)return null;
  function close(){setHidden(true);try{localStorage.setItem('akis-install-hint','hidden')}catch{}}
  async function install(){
    return actions.current.run('install',async()=>{
      const prompt=deferred;if(!prompt)return;
      setBusy(true);setInstallError('');
      try{if(await requestInstall(prompt)&&mounted.current)close()}
      catch{if(mounted.current&&deferred===prompt)setInstallError('Yükleme penceresi açılamadı. Tarayıcı menüsündeki uygulama yükleme seçeneğini kullanabilirsin.')}
      finally{if(deferred===prompt)deferred=null;if(mounted.current){setCanPrompt(!!deferred);setBusy(false)}}
    });
  }
  return <div className="install-hint" role="note"><Download size={18}/>
    {ios?<span><strong>{t('Akış’ı uygulama olarak kullan.')}</strong> {t('Safari’de')} <Share size={14} aria-label={t('Paylaş')}/> <b>{t('Paylaş')}</b> → <b>{t('Ana Ekrana Ekle')}</b> {t('seçeneğine dokun.')}</span>
      :<span><strong>{t('Akış’ı uygulama olarak yükle.')}</strong> {t('Ana ekranından veya masaüstünden tek dokunuşla aç.')}</span>}
    {!ios&&canPrompt&&<button type="button" className="primary" disabled={busy} onClick={()=>void install()}>{t(busy?'İşlem sürüyor…':'Yükle')}</button>}
    {installError&&<p className="error" role="alert">{t(installError)}</p>}
    <button type="button" className="icon-button" disabled={busy} aria-label={t('Kapat')} title={t('Kapat')} onClick={close}><X size={15}/></button></div>;
}
