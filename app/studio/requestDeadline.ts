export class RequestTimeoutError extends Error{constructor(){super('Request timed out');this.name='RequestTimeoutError'}}
export class InvalidJsonError extends Error{constructor(){super('Invalid JSON response');this.name='InvalidJsonError'}}

export const STATE_TIMEOUT_MS=20_000,SERVER_CHECK_TIMEOUT_MS=15_000;
export function apiTimeout(path:string){return /^system\/backup(?:\/[^/]+\/verify)?$/.test(path)?300_000:60_000}

// One deadline covers headers AND the JSON body. Never retry here: a write may
// already have committed even when its response does not reach the client.
export async function fetchJson(input:string,init:Omit<RequestInit,'signal'>,timeoutMs:number,fetcher:typeof fetch=fetch){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new RangeError('Invalid request timeout');
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new RequestTimeoutError());controller.abort()},timeoutMs)});
  async function read(){
    const response=await fetcher(input,{...init,signal:controller.signal});
    if(response.status===304)return {response,data:null};
    let data:any;try{data=await response.json()}catch{throw new InvalidJsonError()}
    return {response,data};
  }
  try{return await Promise.race([read(),deadline])}finally{clearTimeout(timer)}
}
