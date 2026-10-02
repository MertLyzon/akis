import {t,Language} from './i18n';

export default function LanguageQuick({language,onChange,className=''}:{language:Language,onChange:(value:Language)=>void,className?:string}){
return <div className={`language-quick ${className}`.trim()} role="group" aria-label={t('Uygulama dili')}><button type="button" aria-pressed={language==='tr'} onClick={()=>onChange('tr')}>TR</button><button type="button" aria-pressed={language==='en'} onClick={()=>onChange('en')}>EN</button></div>
}
