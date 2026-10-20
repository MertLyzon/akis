type SavedConnection={days_left?:number|null;refresh_error?:string|null};

// These are saved credential states, not a live guarantee that the platform is reachable.
export function connectionStatus(saved:SavedConnection|null|undefined){
  if(!saved)return {label:'Bağlanmadı',tone:'neutral',attention:false};
  const days=saved.days_left;
  if(typeof days==='number'&&Number.isFinite(days)&&days<=0)return {label:'Süresi doldu',tone:'danger',attention:true};
  if(saved.refresh_error)return {label:'Kontrol gerekiyor',tone:'warning',attention:true};
  if(typeof days==='number'&&Number.isFinite(days)&&days<=7)return {label:'Yakında doluyor',tone:'warning',attention:true};
  return {label:'Bağlı',tone:'saved',attention:false};
}
