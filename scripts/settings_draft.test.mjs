import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsDraft,mergeSettingsDraft,settingsDraftChanged} from '../app/studio/settingsDraft.ts';

const initial={client:'original',redirect:'https://example.com/callback',mode:'web'};
test('new platform defaults are clean and saved fields take precedence',()=>{
  const draft=settingsDraft(null,'https://app.example.com','x');
  assert.equal(draft.redirect,'https://app.example.com/api/oauth/x/callback');
  assert.equal(settingsDraftChanged(draft,{...draft},''),false);
  assert.deepEqual(settingsDraft({client_id:initial.client,redirect_uri:initial.redirect,mode:'desktop'},'ignored','x'),{...initial,mode:'desktop'});
});
for(const [field,value] of [['client','edited'],['redirect','https://new.example.com/callback'],['mode','desktop']]){
  test(`an edited ${field} warns until restored or successfully saved`,()=>{
    const edited={...initial,[field]:value};
    assert.equal(settingsDraftChanged(edited,initial,''),true);
    assert.equal(settingsDraftChanged(edited,edited,''),false);
    assert.equal(settingsDraftChanged(initial,initial,''),false);
  });
}
test('a secret-only edit warns without storing the secret in draft metadata',()=>{
  assert.equal(settingsDraftChanged(initial,initial,'test-only-secret'),true);
  assert.equal(settingsDraftChanged(initial,initial,''),false);
  assert.equal(JSON.stringify(settingsDraft({client_secret:'test-only-secret'},'https://example.com','x')).includes('test-only-secret'),false);
});
test('background refresh updates untouched fields but preserves local edits',()=>{
  const current={...initial,client:'my-unsaved-client'},incoming={client:'remote-client',redirect:'https://remote.example.com/callback',mode:'desktop'};
  const merged=mergeSettingsDraft(current,initial,incoming);
  assert.deepEqual(merged,{...incoming,client:current.client});
  assert.equal(settingsDraftChanged(merged,incoming,''),true);
  assert.deepEqual(current,{...initial,client:'my-unsaved-client'});
});
test('a matching server update clears the warning and successful saves form the new baseline',()=>{
  const edited={...initial,client:'saved-client'};
  const merged=mergeSettingsDraft(edited,initial,edited);
  assert.equal(settingsDraftChanged(merged,edited,''),false);
  assert.deepEqual(mergeSettingsDraft(edited,edited,initial),initial);
});
