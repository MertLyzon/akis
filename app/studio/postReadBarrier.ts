// Only a read started after a confirmed operation's failed refresh may release it.
// Revisions keep an older read from clearing a newer hold on the same post.
export class PostReadBarrier{
  private holds=new Map<string,number>();
  private revision=0;
  has(id:string){return this.holds.has(id)}
  hold(id:string){this.holds.set(id,++this.revision)}
  snapshot(){return new Map(this.holds)}
  confirm(snapshot:Map<string,number>){
    for(const [id,revision] of snapshot)if(this.holds.get(id)===revision)this.holds.delete(id);
  }
}
