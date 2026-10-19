type SaveSteps={
  save:()=>Promise<unknown>;
  saved:()=>void;
  refresh:()=>Promise<unknown>;
  refreshFailed:()=>void;
};

// A failed refresh must not turn an already committed settings change into a failed save.
// In particular, do not invite the user to resend a secret that the server has accepted.
export async function saveThenRefresh({save,saved,refresh,refreshFailed}:SaveSteps){
  await save();
  saved();
  await refreshWithWarning(refresh,refreshFailed);
}

// A read-only retry must not repeat the write or authorization that preceded it.
export async function refreshWithWarning(refresh:()=>Promise<unknown>,refreshFailed:()=>void){
  let result:unknown;
  try{result=await refresh()}catch{refreshFailed();return}
  if(result===false)refreshFailed();
}

// Attempt every independent read and wait for all of them. A failed read must
// not hide another result or turn an already committed mutation into a failure.
export async function refreshTogether(reads:Array<()=>Promise<unknown>>){
  const results=await Promise.allSettled(reads.map(read=>Promise.resolve().then(read)));
  return results.every(result=>result.status==='fulfilled'&&result.value!==false);
}
