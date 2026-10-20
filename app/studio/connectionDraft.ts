export type ConnectionDraft={account:string;label:string;expiry:string;refreshExpiry:string;long:boolean};

// Tokens are checked only for presence, never added to shared navigation state or storage.
export function connectionDraftChanged(current:ConnectionDraft,saved:ConnectionDraft,token:string,refreshToken:string){
  return !!token||!!refreshToken||current.account!==saved.account||current.label!==saved.label||current.expiry!==saved.expiry||current.refreshExpiry!==saved.refreshExpiry||current.long!==saved.long;
}

export function connectionSaveNeeded(configured:boolean,current:ConnectionDraft,saved:ConnectionDraft,token:string,refreshToken:string){
  return !configured||connectionDraftChanged(current,saved,token,refreshToken);
}

// A background token refresh may update saved metadata, but not the user's edits.
export function mergeConnectionDraft(current:ConnectionDraft,previous:ConnectionDraft,incoming:ConnectionDraft):ConnectionDraft{
  return {
    account:current.account===previous.account?incoming.account:current.account,
    label:current.label===previous.label?incoming.label:current.label,
    expiry:current.expiry===previous.expiry?incoming.expiry:current.expiry,
    refreshExpiry:current.refreshExpiry===previous.refreshExpiry?incoming.refreshExpiry:current.refreshExpiry,
    long:current.long===previous.long?incoming.long:current.long,
  };
}

export function isOAuthResult(event:{source:unknown;origin:string;data?:unknown},popup:unknown,origin:string){
  if(!popup||event.source!==popup||event.origin!==origin)return false;
  const data=event.data as {type?:unknown;ok?:unknown;message?:unknown}|null;
  return !!data&&data.type==='akis-oauth'&&typeof data.ok==='boolean'&&typeof data.message==='string';
}
