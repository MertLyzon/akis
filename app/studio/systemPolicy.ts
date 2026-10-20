// Missing status information must not imply that automatic backups are enabled.
// This only describes server policy; it never changes configuration or starts a backup.
export function systemBackupPolicy(value:any,cloud:boolean){
  const validInterval=Number.isInteger(value?.interval_days)&&value.interval_days>=0;
  const interval=validInterval?value.interval_days:0;
  const validKeep=Number.isInteger(value?.keep)&&value.keep>=1;
  const keep=validKeep?value.keep:1;
  const known=typeof value?.automatic==='boolean'&&validInterval&&(!value.automatic||(interval>0&&validKeep));
  return {known,automatic:known&&value.automatic===true,interval_days:interval,keep,remote:typeof value?.remote==='boolean'?value.remote:cloud};
}

export function systemOperationalStatus(value:any,stale=false){
  const issues=Array.isArray(value?.issues)?value.issues.filter((issue:any)=>typeof issue?.code==='string'&&issue.code):[];
  const known=['healthy','warning','critical'].includes(value?.level)&&Array.isArray(value?.issues)&&issues.length===value.issues.length&&!(value.level==='healthy'&&issues.length>0);
  return {level:known&&!stale?value.level:'unknown',issues};
}
