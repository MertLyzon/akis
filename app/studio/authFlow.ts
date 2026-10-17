// Invitations deliberately stay in the URL fragment, never a query parameter.
export function parseInviteToken(hash:string){const match=hash.match(/^#davet=([\w-]{20,100})$/);return match&&match[0]===hash?match[1]:''}

export function needsAuthenticator(status:number,data:unknown){
  return status===401&&!!data&&typeof data==='object'&&(data as {needs_code?:unknown}).needs_code===true;
}
