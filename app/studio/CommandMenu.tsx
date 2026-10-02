import {useEffect,useMemo,useRef,useState} from 'react';
import {CornerDownLeft,Search} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {t} from './i18n';

export type CommandItem={id:string;name:string;icon:LucideIcon;hint?:string;run:()=>void};

export default function CommandMenu({open,items,onClose}:{open:boolean;items:CommandItem[];onClose:()=>void}){
const [query,setQuery]=useState(''),[active,setActive]=useState(0),input=useRef<HTMLInputElement>(null);
const results=useMemo(()=>{const needle=query.trim().toLocaleLowerCase();return needle?items.filter(item=>item.name.toLocaleLowerCase().includes(needle)):items},[items,query]);
useEffect(()=>{if(!open)return;setQuery('');setActive(0);requestAnimationFrame(()=>input.current?.focus())},[open]);
useEffect(()=>setActive(value=>Math.min(value,Math.max(0,results.length-1))),[results.length]);
useEffect(()=>{if(!open)return;function key(event:KeyboardEvent){if(event.key==='Escape')onClose();if(event.key==='ArrowDown'){event.preventDefault();setActive(value=>Math.min(value+1,results.length-1))}if(event.key==='ArrowUp'){event.preventDefault();setActive(value=>Math.max(value-1,0))}if(event.key==='Enter'&&results[active]){event.preventDefault();results[active].run();onClose()}}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[open,results,active,onClose]);
if(!open)return null;
return <div className="command-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="command-menu" role="dialog" aria-modal="true" aria-label={t("Akış'ta ara")}><label className="command-search"><Search size={18}/><input ref={input} value={query} onChange={event=>{setQuery(event.target.value);setActive(0)}} placeholder={t('Bir ekrana git…')} aria-label={t('Bir ekrana git…')}/><kbd>ESC</kbd></label><div className="command-results" role="listbox" aria-label={t('Ekranlar')}>{results.length?results.map((item,index)=>{const Icon=item.icon;return <button key={item.id} type="button" role="option" aria-selected={index===active} onMouseEnter={()=>setActive(index)} onClick={()=>{item.run();onClose()}}><span className="command-icon"><Icon size={17}/></span><span>{item.name}</span>{item.hint&&<small>{item.hint}</small>}{index===active&&<CornerDownLeft size={14}/>}</button>}):<div className="command-empty">{t('Aramana uyan ekran yok.')}</div>}</div><footer><span className="flow-signal" aria-hidden="true"><i/><i/><i/></span>{t('Hazırla · planla · yayınla')}</footer></section></div>
}
