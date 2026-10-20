// Manual credential dates use the device's local time, matching datetime-local inputs.
export function connectionDateInput(stamp:number|null|undefined){
  if(stamp==null||!Number.isFinite(stamp))return '';
  const date=new Date(stamp*1000);
  if(!Number.isFinite(date.getTime()))return '';
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

export function connectionExpiry(value:string,original:number|null|undefined):number|null{
  // Displaying minutes must not truncate an unchanged server timestamp's seconds.
  if(original!=null&&value===connectionDateInput(original)&&value)return original;
  if(!value)return null;
  const invalid=()=>new Error('Bitiş tarihi geçersiz veya saat değişimi nedeniyle belirsiz. Başka bir saat seç.');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw invalid();
  const date=new Date(value),stamp=date.getTime();
  // Date normalizes invalid dates and DST gaps; round-tripping must not change the input.
  if(!Number.isFinite(stamp)||connectionDateInput(stamp/1000)!==value)throw invalid();
  // Clock changes can repeat a local time. Check the offsets on either side of the date.
  const offsets=new Set([-2,-1,0,1,2].map(days=>new Date(stamp+days*86400000).getTimezoneOffset()));
  const offset=date.getTimezoneOffset();
  for(const other of offsets){
    const candidate=stamp+(other-offset)*60000;
    if(candidate!==stamp&&connectionDateInput(candidate/1000)===value)throw invalid();
  }
  return Math.floor(stamp/1000);
}
