import {useEffect,useState} from 'react';
import {Monitor,Sun,Moon} from 'lucide-react';
import {readLanguage,t} from './i18n';

type Choice='system'|'light'|'dark';
const media=()=>window.matchMedia('(prefers-color-scheme: dark)');
function read():Choice{try{const v=localStorage.getItem('akis-theme');return v==='light'||v==='dark'?v:'system'}catch{return 'system'}}
export function applyTheme(choice:Choice=read()){document.documentElement.dataset.theme=choice==='system'?(media().matches?'dark':'light'):choice}

export function ThemeSwitch(){
const [choice,setChoice]=useState<Choice>(read);
useEffect(()=>{applyTheme(choice);try{choice==='system'?localStorage.removeItem('akis-theme'):localStorage.setItem('akis-theme',choice)}catch{}
if(choice!=='system')return;const m=media(),on=()=>applyTheme('system');m.addEventListener('change',on);return()=>m.removeEventListener('change',on)},[choice]);
const options:[Choice,string,any][]=[['system','Sistem',Monitor],['light','Açık',Sun],['dark','Koyu',Moon]];
return <div className="theme-switch" role="group" aria-label={t('Tema')}>{options.map(([id,name,Icon])=>{const label=id==='light'&&readLanguage()==='en'?'Light':t(name);return <button key={id} aria-pressed={choice===id} title={`${label} ${t('tema')}`} onClick={()=>setChoice(id)}><Icon size={13}/>{label}</button>})}</div>}
