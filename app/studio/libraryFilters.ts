export function libraryFilterOptions(options:string[],selected:string){
  return [...new Set([...options,...(selected?[selected]:[])])].sort();
}
export function libraryEmptyTitle(filters:{folder:string;tag:string;q:string;archived:boolean},error:string){
  if(error)return 'Medya listesi alınamadı.';
  if(filters.folder||filters.tag||filters.q.trim())return 'Filtrelerine uyan medya yok.';
  return filters.archived?'Arşiv boş.':'Kütüphanende henüz medya yok.';
}
