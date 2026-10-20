export type SystemCompanyDraft={name:string;email:string;admin:string;timezone:string};
export function emptySystemCompany():SystemCompanyDraft{return {name:'',email:'',admin:'',timezone:''}}
export function systemDraftChanged(company:SystemCompanyDraft,publicUrl:string,savedPublicUrl:string){
  return Object.values(company).some(value=>value!=='')||publicUrl!==savedPublicUrl;
}
export function mergePublicUrl(current:string,previous:string,incoming:string){
  return current===previous?incoming:current;
}
