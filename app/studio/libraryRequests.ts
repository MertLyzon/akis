// Ref-owned guards take effect immediately, before React renders disabled controls.
export class KeyedActions{
  private active=new Set<string>();
  get size(){return this.active.size}
  has(key:string){return this.active.has(key)}
  async run(key:string,operation:()=>Promise<void>){
    if(this.active.has(key))return false;
    this.active.add(key);
    try{await operation();return true}finally{this.active.delete(key)}
  }
}

// Requests may finish out of order when filters change or an upload refreshes the list.
export class LatestRequest{
  private version=0;
  invalidate(){this.version++}
  async run<T>(request:()=>Promise<T>,success:(value:T)=>void,failure:(error:unknown)=>void,settled:()=>void){
    const version=++this.version;
    try{const value=await request();if(version===this.version){success(value);return true}return false}
    catch(error){if(version===this.version)failure(error);return false}
    finally{if(version===this.version)settled()}
  }
}
