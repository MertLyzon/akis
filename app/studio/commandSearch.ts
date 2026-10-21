// Screen names are short natural-language labels, not identifiers or credentials.
// Accept Turkish/English casing and keyboards without Turkish accent keys.
function searchKey(value:string){
  return value.trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replace(/ı/g,'i');
}
export function filterCommands<T extends {name:string}>(items:T[],query:string){
  const needle=searchKey(query);
  return needle?items.filter(item=>searchKey(item.name).includes(needle)):items;
}
