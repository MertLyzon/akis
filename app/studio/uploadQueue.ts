type UploadContext={url:string;headers:Record<string,string>;maxBytes:number;multiple:boolean};
type UploadItem={file:File;context:UploadContext;key:string};
type UploadAsset={id:string;mime_type:string;status:string;[key:string]:unknown};
type UploadCallbacks={
  canEnqueue?:()=>boolean;
  onChange:(state:{progress:number|null;queued:number})=>void;
  onBusy:(busy:boolean)=>void;
  onSuccess:(asset:UploadAsset,file:File)=>void;
  onError:(message:string,file:File,skipped:number)=>void;
  createRequest?:()=>XMLHttpRequest;
};

// Own the in-flight request synchronously: rendering timing must not start a second upload.
export class UploadQueue{
  private callbacks:UploadCallbacks;
  private pending:UploadItem[]=[];
  private active:UploadItem|null=null;
  private request:XMLHttpRequest|null=null;
  private progress:number|null=null;
  private busy=false;
  private generation=0;

  constructor(callbacks:UploadCallbacks){this.callbacks=callbacks}
  get isBusy(){return this.busy}

  enqueue(files:File[],context:UploadContext){
    if(this.callbacks.canEnqueue?.()===false)return {oversized:0,duplicates:0};
    let oversized=0,duplicates=0;
    for(const file of files){
      if(file.size>context.maxBytes){oversized++;continue}
      const key=JSON.stringify([file.name,file.size,file.lastModified,file.type]);
      if(this.active?.key===key||this.pending.some(item=>item.key===key)){duplicates++;continue}
      if(!context.multiple&&(this.active||this.pending.length))continue;
      this.pending.push({file,key,context:{...context,headers:{...context.headers}}});
    }
    if(!this.active)this.next();else this.publish();
    return {oversized,duplicates};
  }

  cancel(){
    this.generation++;
    this.pending=[];this.active=null;
    const request=this.detach();
    // Handlers are already detached: even a broken transport must release the UI.
    try{request?.abort()}catch{}
    this.progress=null;this.setBusy(false);this.publish();
  }

  private setBusy(value:boolean){if(this.busy!==value){this.busy=value;this.callbacks.onBusy(value)}}
  private publish(){this.callbacks.onChange({progress:this.progress,queued:this.pending.length})}
  private detach(){
    const request=this.request;this.request=null;
    if(request){request.onload=null;request.onerror=null;request.ontimeout=null;request.onabort=null;request.upload.onprogress=null}
    return request;
  }

  private finish(item:UploadItem,notify:()=>void,stop=false){
    if(this.active!==item)return;
    const generation=this.generation;
    this.detach();this.active=null;
    if(stop)this.pending=[];
    try{notify()}finally{if(this.generation===generation)this.next()}
  }

  private fail(item:UploadItem,message:string,stop:boolean){
    const skipped=stop?this.pending.length:0;
    this.finish(item,()=>this.callbacks.onError(message,item.file,skipped),stop);
  }

  private next(){
    if(this.active)return;
    const item=this.pending.shift();
    // Observers may enqueue a new upload. Publish idle only after clearing busy,
    // so the old completion cannot unlock a replacement started by a callback.
    if(!item){this.progress=null;this.setBusy(false);this.publish();return}
    this.active=item;this.progress=0;this.setBusy(true);this.publish();
    if(this.active!==item)return;
    try{
      const request=this.callbacks.createRequest?.()||new XMLHttpRequest();this.request=request;
      request.open('POST',item.context.url);
      for(const [key,value] of Object.entries(item.context.headers))request.setRequestHeader(key,value);
      request.timeout=30*60*1000;
      request.upload.onprogress=event=>{if(this.active===item&&event.lengthComputable&&event.total>0){this.progress=Math.round(event.loaded/event.total*100);this.publish()}};
      request.onerror=()=>this.fail(item,'Yükleme sonucu doğrulanamadı. Dosya sunucuya ulaşmış olabilir. Yeniden yüklemeden önce kütüphaneyi kontrol et.',true);
      request.ontimeout=()=>this.fail(item,'Dosya yükleme zaman aşımına uğradı. Dosya sunucuya ulaşmış olabilir. Yeniden yüklemeden önce kütüphaneyi kontrol et.',true);
      request.onabort=()=>{if(this.active===item)this.cancel()};
      request.onload=()=>{
        if(this.active!==item)return;
        let result:any;try{result=JSON.parse(request.responseText)}catch{}
        if(request.status<200||request.status>=300){
          const message=typeof result?.error==='string'?result.error:'Dosya yüklenemedi';
          // A bad individual file may be skipped. Connectivity, quota or permission
          // failures stop the batch instead of repeating the failure for every file.
          this.fail(item,message,![400,415,422].includes(request.status));return;
        }
        if(!result||typeof result.id!=='string'||!result.id||typeof result.mime_type!=='string'||typeof result.status!=='string'){
          this.fail(item,'Geçerli bir yükleme yanıtı alınamadı. Yeniden yüklemeden önce kütüphaneyi kontrol et.',true);return;
        }
        this.finish(item,()=>this.callbacks.onSuccess(result,item.file));
      };
      const body=new FormData();body.append('file',item.file,item.file.name);request.send(body);
    }catch{this.fail(item,'Yükleme tamamlanamadı. Bağlantını kontrol et.',true)}
  }
}
