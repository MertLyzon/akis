export type CompanyDraft={name:string;timezone:string;require_approval:boolean};

export function companyDraft(saved:CompanyDraft):CompanyDraft{
  return {name:saved.name,timezone:saved.timezone,require_approval:saved.require_approval};
}
export function mergeCompanyDraft(current:CompanyDraft,previous:CompanyDraft,incoming:CompanyDraft):CompanyDraft{
  return {
    name:current.name===previous.name?incoming.name:current.name,
    timezone:current.timezone===previous.timezone?incoming.timezone:current.timezone,
    require_approval:current.require_approval===previous.require_approval?incoming.require_approval:current.require_approval,
  };
}
export function companyDraftChanged(current:CompanyDraft|null,saved:CompanyDraft|null){
  return !!current&&!!saved&&(current.name!==saved.name||current.timezone!==saved.timezone||current.require_approval!==saved.require_approval);
}
export function invitationDraftChanged(email:string,name:string,role:string){return !!email||!!name||role!=='editor'}
