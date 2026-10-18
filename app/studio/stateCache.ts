// Invalidated requests must not repopulate an empty cache after an account,
// server or company change. A later response cannot roll the tag backwards.
export class StateCache{
  private generation=0;
  private sequence=0;
  private accepted=0;
  private tag='';
  private key='';
  clear(){this.generation++;this.tag='';this.key='';this.accepted=0}
  begin(key:string){
    const generation=this.generation,sequence=++this.sequence;
    const current=()=>generation===this.generation;
    const headers:Record<string,string>=this.tag&&this.key===key?{'If-None-Match':this.tag}:{};
    return {
      headers,
      current,
      commit:(tag:string)=>{
        if(!current()||sequence<this.accepted)return;
        this.accepted=sequence;this.key=key;this.tag=tag;
      }
    };
  }
}
