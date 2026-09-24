/// <reference types="vite/client" />
import {useEffect,useState} from 'react';
import {Download,Share,X} from 'lucide-react';
import {isApp} from './api';

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
  useEffect(()=>{const on=()=>setCanPrompt(true);window.addEventListener('akis-installable',on);return()=>window.removeEventListener('akis-installable',on)},[]);
  if(isApp||hidden||standalone())return null;
  const ios=isIOS();
  if(!ios&&!canPrompt)return null;
  function close(){setHidden(true);try{localStorage.setItem('akis-install-hint','hidden')}catch{}}
  return <div className="install-hint" role="note"><Download size={18}/>
    {ios?<span><strong>Akış’ı uygulama olarak kullan.</strong> Safari’de <Share size={14} aria-label="Paylaş"/> <b>Paylaş</b> → <b>Ana Ekrana Ekle</b>’ye dokun.</span>
      :<span><strong>Akış’ı uygulama olarak yükle.</strong> Ana ekranından veya masaüstünden tek dokunuşla aç.</span>}
    {!ios&&<button className="primary" onClick={async()=>{deferred?.prompt();const r=await deferred?.userChoice;deferred=null;setCanPrompt(false);if(r?.outcome==='accepted')close()}}>Yükle</button>}
    <button className="icon-button" aria-label="Kapat" title="Kapat" onClick={close}><X size={15}/></button></div>;
}
