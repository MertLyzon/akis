import test from 'node:test';
import assert from 'node:assert/strict';
import {filterTeamMembers} from '../app/studio/teamSearch.ts';
const members=[{email:'mert@example.com',name:'Mert'},{email:'istanbul@example.com',name:'İSTANBUL'},{email:'only-email@example.com',name:''}];
test('team search matches names or email and trims query whitespace',()=>{
  assert.deepEqual(filterTeamMembers(members,' MERT '),[members[0]]);
  assert.deepEqual(filterTeamMembers(members,'only-email'),[members[2]]);
});
test('team search handles Turkish uppercase without changing member data',()=>{
  const before=JSON.stringify(members);
  assert.deepEqual(filterTeamMembers(members,'istanbul'),[members[1]]);
  assert.equal(JSON.stringify(members),before);
});
test('email search uses case-insensitive email casing rather than Turkish dotless I',()=>{
  const member={name:'Team',email:'info@example.com'};
  assert.deepEqual(filterTeamMembers([member],'INFO'),[member]);
  assert.deepEqual(filterTeamMembers([{...member,email:'INFO@example.com'}],'info'),[{...member,email:'INFO@example.com'}]);
});
test('clearing search restores all members and unmatched queries return no rows',()=>{
  assert.equal(filterTeamMembers(members,'  '),members);
  assert.deepEqual(filterTeamMembers(members,'no-match'),[]);
  assert.deepEqual(filterTeamMembers([],'Mert'),[]);
});
