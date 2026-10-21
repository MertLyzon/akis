type PollEnvironment = {
  document: Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>;
  window: Pick<Window,'addEventListener'|'removeEventListener'>;
  navigator: Pick<Navigator,'onLine'>;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

// One request at a time. Hidden/offline screens consume no polling requests;
// returning to an active screen checks immediately, then resumes the normal delay.
export function pollWhileActive(poll:()=>Promise<unknown>,delay:number,env:PollEnvironment=globalThis){
  let stopped=false,running=false,timer:ReturnType<typeof setTimeout>|undefined;
  const available=()=>!env.document.hidden&&env.navigator.onLine;
  let active=available();
  const clear=()=>{if(timer!==undefined){env.clearTimeout(timer);timer=undefined}};
  const schedule=()=>{clear();if(!stopped&&active&&!running)timer=env.setTimeout(()=>void tick(),delay)};
  async function tick(){
    clear();if(stopped||running||!active)return;
    running=true;
    try{await poll()}catch{/* The caller owns its visible error state. A transient failure must not stop polling. */}
    finally{running=false;schedule()}
  }
  const changed=()=>{
    const next=available();if(next===active)return;active=next;
    clear();if(active)void tick();
  };
  env.document.addEventListener('visibilitychange',changed);
  env.window.addEventListener('online',changed);
  env.window.addEventListener('offline',changed);
  schedule();
  return ()=>{
    stopped=true;clear();
    env.document.removeEventListener('visibilitychange',changed);
    env.window.removeEventListener('online',changed);
    env.window.removeEventListener('offline',changed);
  };
}
