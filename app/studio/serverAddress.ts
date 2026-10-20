// Keep reverse-proxy base paths, but never treat credentials, query parameters
// or fragments as part of a server base address.
export function normalizeServerAddress(value:string){
  let url:URL;try{url=new URL(value.trim())}catch{throw new Error('Geçerli bir sunucu adresi gir.')}
  if(url.username||url.password)throw new Error('Sunucu adresine kullanıcı adı veya parola ekleme.');
  if(url.href.includes('?')||url.href.includes('#'))throw new Error('Sunucu adresini sorgu veya # bölümü olmadan gir.');
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new Error('Uzak sunucu adresi güvenli bir https:// adresi olmalı.');
  return url.href.replace(/\/+$/,'');
}
