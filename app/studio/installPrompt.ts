export async function requestInstall(prompt:{prompt:()=>unknown;userChoice:Promise<unknown>}){
  await prompt.prompt();
  const choice=await prompt.userChoice;
  return !!choice&&typeof choice==='object'&&(choice as {outcome?:unknown}).outcome==='accepted';
}
