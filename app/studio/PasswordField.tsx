import {useEffect,useId,useState} from 'react';
import type {InputHTMLAttributes} from 'react';
import {Eye,EyeOff} from 'lucide-react';
import {t} from './i18n';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'> & {label:string;value:string};

export default function PasswordField({label,value,disabled,id,...props}:Props){
  const generated=useId(),inputId=id||generated;
  const [visible,setVisible]=useState(false);
  useEffect(()=>{if(disabled||!value)setVisible(false)},[disabled,value]);
  useEffect(()=>setVisible(false),[label,props.autoComplete]);
  const revealed=visible&&!disabled&&!!value;
  const action=t(revealed?'Parolayı gizle':'Parolayı göster');
  return <div className="password-field"><label htmlFor={inputId}>{label}</label>
    <div className="password-control"><input {...props} id={inputId} type={revealed?'text':'password'} value={value} disabled={disabled}/>
      <button type="button" className="password-toggle" aria-label={`${action} · ${label}`} aria-controls={inputId} title={action} disabled={disabled||!value}
        onMouseDown={event=>event.preventDefault()} onClick={()=>setVisible(current=>!current)}>
        {revealed?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}
      </button>
    </div>
  </div>;
}
