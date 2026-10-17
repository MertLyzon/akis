export type SettingsDraft={client:string;redirect:string;mode:string};

export function settingsDraft(saved:any,origin:string,platform:string):SettingsDraft{
  return {client:saved?.client_id||'',redirect:saved?.redirect_uri||`${origin}/api/oauth/${platform}/callback`,mode:saved?.mode||'web'};
}
export function mergeSettingsDraft(current:SettingsDraft,previous:SettingsDraft,incoming:SettingsDraft):SettingsDraft{
  return {
    client:current.client===previous.client?incoming.client:current.client,
    redirect:current.redirect===previous.redirect?incoming.redirect:current.redirect,
    mode:current.mode===previous.mode?incoming.mode:current.mode,
  };
}
// Secrets stay in component memory. This helper only returns whether they need saving.
export function settingsDraftChanged(current:SettingsDraft,saved:SettingsDraft,secret:string){
  return !!secret||current.client!==saved.client||current.redirect!==saved.redirect||current.mode!==saved.mode;
}
