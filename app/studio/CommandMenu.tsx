import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {CornerDownLeft,Search,X} from 'lucide-react';
import {Dialog} from 'radix-ui';
import type {LucideIcon} from 'lucide-react';
import {t} from './i18n';
import {filterCommands} from './commandSearch';

export type CommandItem={id:string;name:string;icon:LucideIcon;hint?:string;run:()=>void};

export default function CommandMenu({open,items,onClose}:{open:boolean;items:CommandItem[];onClose:()=>void}){
const [query,setQuery]=useState(''),[active,setActive]=useState(0),input=useRef<HTMLInputElement>(null);
const previousFocus=useRef<HTMLElement|null>(null),listId=useId();
const results=useMemo(()=>filterCommands(items,query),[items,query]);
const selected=results.length?Math.min(active,results.length-1):0;
useEffect(()=>{if(open){setQuery('');setActive(0)}},[open]);
useEffect(()=>{if(open&&results[selected])document.getElementById(`${listId}-${results[selected].id}`)?.scrollIntoView({block:'nearest'})},[open,selected,results,listId]);
function choose(item:CommandItem){item.run();onClose()}
return <Dialog.Root open={open} onOpenChange={value=>{if(!value)onClose()}}><Dialog.Portal>
<Dialog.Overlay className="command-backdrop"/>
<Dialog.Content className="command-menu" aria-describedby={undefined}
  onOpenAutoFocus={event=>{event.preventDefault();previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;input.current?.focus()}}
  onCloseAutoFocus={event=>{event.preventDefault();if(previousFocus.current?.isConnected)previousFocus.current.focus()}}>
<Dialog.Title className="sr-only">{t("Akış'ta ara")}</Dialog.Title>
<div className="command-search"><Search size={18} aria-hidden="true"/><input ref={input} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={results[selected]?`${listId}-${results[selected].id}`:undefined} value={query} onChange={event=>{setQuery(event.target.value);setActive(0)}} placeholder={t('Bir ekrana git…')} aria-label={t('Bir ekrana git…')} onKeyDown={event=>{
  if(event.nativeEvent.isComposing)return;
  if(event.key==='ArrowDown'){event.preventDefault();setActive(Math.min(selected+1,Math.max(0,results.length-1)))}
  if(event.key==='ArrowUp'){event.preventDefault();setActive(Math.max(selected-1,0))}
  if(event.key==='Enter'&&results[selected]){event.preventDefault();choose(results[selected])}
}}/><kbd aria-hidden="true">ESC</kbd><Dialog.Close className="icon-button command-close" aria-label={t('Kapat')}><X size={18}/></Dialog.Close></div>
<div id={listId} className="command-results" role="listbox" aria-label={t('Ekranlar')}>{results.length?results.map((item,index)=>{const Icon=item.icon;return <button id={`${listId}-${item.id}`} key={item.id} type="button" role="option" tabIndex={-1} aria-selected={index===selected} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(item)}><span className="command-icon"><Icon size={17}/></span><span>{item.name}</span>{item.hint&&<small>{item.hint}</small>}{index===selected&&<CornerDownLeft size={14} aria-hidden="true"/>}</button>}):<div className="command-empty" role="status">{t('Aramana uyan ekran yok.')}</div>}</div>
<footer><span className="flow-signal" aria-hidden="true"><i/><i/><i/></span>{t('Hazırla · planla · yayınla')}</footer>
</Dialog.Content></Dialog.Portal></Dialog.Root>
}
