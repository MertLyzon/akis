// Company-local wall-clock values; never use the device's timezone for defaults.
export function calendarDraftTime(day:string,nowLocal:string){
  const defaultTime=day+'T10:00';
  if(day!==nowLocal.slice(0,10)||defaultTime>nowLocal.slice(0,16))return defaultTime;
  const nextHour=new Date(nowLocal.slice(0,13)+':00:00Z').getTime()+60*60*1000;
  return new Date(nextHour).toISOString().slice(0,16);
}
export function calendarPostTime(post:{scheduled_at?:number|null;deliveries?:{sent_at?:number|null}[]}){
  if(typeof post.scheduled_at==='number'&&Number.isFinite(post.scheduled_at)&&post.scheduled_at>0)return post.scheduled_at;
  const sent=(post.deliveries||[]).map(delivery=>delivery.sent_at).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0);
  return sent.length?Math.min(...sent):null;
}
