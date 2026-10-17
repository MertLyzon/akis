// A copy is successful only when the browser confirms the write. No secret is logged.
export async function copyToClipboard(value:string,clipboard:Pick<Clipboard,'writeText'>|undefined=globalThis.navigator?.clipboard){
  if(!clipboard?.writeText)throw new Error('Clipboard unavailable');
  await clipboard.writeText(value);
}
