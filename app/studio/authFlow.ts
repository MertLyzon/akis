// Invitations deliberately stay in the URL fragment, never a query parameter.
export function parseInviteToken(hash:string){const match=hash.match(/^#davet=([\w-]{20,100})$/);return match&&match[0]===hash?match[1]:''}

export function needsAuthenticator(status:number,data:unknown){
  return status===401&&!!data&&typeof data==='object'&&(data as {needs_code?:unknown}).needs_code===true;
}

export function invitationUnavailable(status:number){return status===404||status===410}

export function parseInvitation(value:unknown){
  const invalid=()=>new Error('Davet bilgileri alınamadı. Bağlantını kontrol edip tekrar dene.');
  if(!value||typeof value!=='object')throw invalid();
  const {company,email,role,expires_at}=value as Record<string,unknown>;
  if(typeof company!=='string'||!company.trim()||typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+$/.test(email))throw invalid();
  if(typeof role!=='string'||!['admin','approver','editor','viewer'].includes(role)||typeof expires_at!=='number'||!Number.isSafeInteger(expires_at)||expires_at<=0||expires_at>8_640_000_000_000)throw invalid();
  return {company,email,role,expires_at};
}
