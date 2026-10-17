export function normalizedTotpCode(value:string):string|null{
  const code=value.replace(/[ -]/g,'');
  return /^[0-9]{6}$/.test(code)?code:null;
}

// Never render a malformed setup response or turn a server response into an arbitrary link.
export function parseTotpSetup(value:unknown):{secret:string;uri:string}{
  const invalid=()=>new Error('İki aşamalı giriş kurulum bilgileri alınamadı. Tekrar dene.');
  if(!value||typeof value!=='object')throw invalid();
  const {secret,uri}=value as Record<string,unknown>;
  if(typeof secret!=='string'||!/^[A-Z2-7]{32}$/.test(secret)||typeof uri!=='string')throw invalid();
  let url:URL;try{url=new URL(uri)}catch{throw invalid()}
  if(url.protocol!=='otpauth:'||url.hostname!=='totp'||!url.pathname||url.searchParams.getAll('secret').length!==1||url.searchParams.get('secret')!==secret)throw invalid();
  return {secret,uri};
}
