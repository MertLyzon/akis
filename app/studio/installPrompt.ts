export async function requestInstall(prompt:{prompt:()=>unknown;userChoice:Promise<unknown>}){
  // Both promises can fail independently. Observe choice immediately, even if
  // opening the native prompt is slow or fails first, without swallowing errors.
  const pendingChoice=Promise.resolve(prompt.userChoice).then(
    value=>({ok:true as const,value}),
    error=>({ok:false as const,error}),
  );
  await prompt.prompt();
  const result=await pendingChoice;
  if(!result.ok)throw result.error;
  const choice=result.value;
  return !!choice&&typeof choice==='object'&&(choice as {outcome?:unknown}).outcome==='accepted';
}
