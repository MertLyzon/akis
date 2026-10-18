type Batch={read:()=>Promise<boolean>;waiters:Array<(result:boolean)=>void>};

// Reads requested during another read need a fresh pass: the caller may have
// just committed a write. Merge that burst into one follow-up, without retries.
export class WorkspaceRefresh{
  private active=false;
  private queued:Batch|null=null;
  get busy(){return this.active}
  run(read:()=>Promise<boolean>):Promise<boolean>{
    return new Promise(resolve=>{
      if(this.active){
        if(this.queued){this.queued.read=read;this.queued.waiters.push(resolve)}
        else this.queued={read,waiters:[resolve]};
        return;
      }
      this.active=true;void this.drain({read,waiters:[resolve]});
    });
  }
  private async drain(batch:Batch){
    let result=false;
    // Reporting belongs to the read callback; even a failure must release all waiters.
    try{result=await batch.read()}catch{}
    const next=this.queued;this.queued=null;
    if(next)void this.drain(next);else this.active=false;
    for(const resolve of batch.waiters)resolve(result);
  }
}
