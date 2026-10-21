export const postFilters=[{id:'all',name:'Tümü'},{id:'pending_approval',name:'Onay bekleyen'},{id:'scheduled',name:'Planlı'},{id:'attention',name:'Sorunlu'},{id:'draft',name:'Taslak / reddedilen'}];
type Post={status:string;text?:string;options?:{template?:string};created_by?:string;asset?:{filename?:string};deliveries?:{status:string}[]};

export function matchesPost(post:Post,filter:string){
  if(filter==='all')return true;
  if(filter==='attention')return post.status==='attention'||!!post.deliveries?.some(delivery=>['failed','unknown'].includes(delivery.status));
  if(filter==='draft')return ['draft','rejected'].includes(post.status);
  return post.status===filter;
}
export function filterPosts<T extends Post>(posts:T[],filter:string,query:string){
  const needle=query.trim().toLocaleLowerCase('tr');
  return posts.filter(post=>matchesPost(post,filter)&&(!needle||[post.text,post.options?.template,post.created_by,post.asset?.filename].some(value=>value?.toLocaleLowerCase('tr').includes(needle))));
}
export function nextPostFilter(current:string,key:string){
  const index=Math.max(0,postFilters.findIndex(filter=>filter.id===current));
  if(key==='Home')return postFilters[0].id;
  if(key==='End')return postFilters.at(-1)!.id;
  if(key==='ArrowRight')return postFilters[(index+1)%postFilters.length].id;
  if(key==='ArrowLeft')return postFilters[(index+postFilters.length-1)%postFilters.length].id;
}
