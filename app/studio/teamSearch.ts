export function filterTeamMembers<T extends {name?:string;email:string}>(members:T[],query:string){
  const needle=query.trim().toLocaleLowerCase('tr');
  const emailNeedle=query.trim().toLowerCase();
  return needle?members.filter(member=>member.name?.toLocaleLowerCase('tr').includes(needle)||member.email.toLowerCase().includes(emailNeedle)):members;
}
