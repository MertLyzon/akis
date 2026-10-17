export type NavigationStatus={pending:boolean;sensitive:boolean;dirty?:boolean};
export type NavigationReporter=(status:NavigationStatus)=>void;

// Only flags live here, never passwords, invitations, or setup keys.
export class NavigationSafety{
  private sources=new Map<string,NavigationStatus>();
  update(source:string,status:NavigationStatus){
    const previous=this.sources.get(source)||{pending:false,sensitive:false};
    if(previous.pending===status.pending&&previous.sensitive===status.sensitive&&!!previous.dirty===!!status.dirty)return false;
    if(status.pending||status.sensitive||status.dirty)this.sources.set(source,{pending:status.pending,sensitive:status.sensitive,dirty:!!status.dirty});else this.sources.delete(source);
    return true;
  }
  snapshot():NavigationStatus{return {pending:[...this.sources.values()].some(value=>value.pending),sensitive:[...this.sources.values()].some(value=>value.sensitive),dirty:[...this.sources.values()].some(value=>value.dirty)}}
  decision(discardEditor=false,editorDirty=false):'blocked'|'confirm'|'allow'{
    const state=this.snapshot();
    return state.pending?'blocked':state.sensitive||state.dirty||(discardEditor&&editorDirty)?'confirm':'allow';
  }
}
