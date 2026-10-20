import {expect,test} from '@playwright/test';

test('post filters announce results, reset locally and support keyboard navigation',async({page})=>{
  const state=await (await page.request.get('/api/state')).json();
  state.posts=[{id:'ui-post-a',status:'draft',text:'Visible draft',created:Date.now(),options:{},platforms:['x'],deliveries:[],asset:{id:'ui-ready',filename:'ready.png',status:'ready',mime_type:'image/png',url:null}},
    {id:'ui-post-b',status:'scheduled',text:'Scheduled draft',created:Date.now(),options:{},platforms:['x'],deliveries:[]}];
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.goto('/');await page.getByRole('button',{name:/^Gönderiler/}).click();
  const filters=page.getByRole('tablist',{name:'İçerik filtreleri',exact:true});
  await expect(page.locator('.post-results-summary')).toContainText('2 / 2 içerik gösteriliyor');
  await expect(page.locator('.post-media small')).toHaveText('Hazır');
  const search=page.getByRole('searchbox',{name:'İçeriklerde ara',exact:true});
  await search.fill('not-found');await expect(page.getByRole('heading',{name:'Aramana uyan içerik yok.',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Filtreleri temizle',exact:true}).click();
  await expect(search).toHaveValue('');await expect(search).toBeFocused();await expect(page.locator('.post-item')).toHaveCount(2);
  await filters.getByRole('tab',{name:'Tümü',exact:true}).press('End');
  await expect(filters.getByRole('tab',{name:'Taslak / reddedilen',exact:true})).toBeFocused();
  await expect(page.locator('.post-item')).toHaveCount(1);
  await filters.getByRole('tab',{name:'Taslak / reddedilen',exact:true}).press('ArrowRight');
  await expect(filters.getByRole('tab',{name:'Tümü',exact:true})).toBeFocused();
  await expect(page.locator('.post-item')).toHaveCount(2);
});

test('password visibility is explicit, never submits the form and resets after clearing or submitting',async({page})=>{
  let logins=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/session',route=>route.fulfill({json:{authenticated:false,local:false,user:null}}));
  await page.route('**/api/login',async route=>{logins++;await held;return route.fulfill({status:401,json:{error:'Test login rejected'}})});
  await page.goto('/');
  const password=page.getByLabel('Parola',{exact:true});
  const show=page.getByRole('button',{name:'Parolayı göster · Parola',exact:true});
  await expect(show).toBeDisabled();await expect(password).toHaveAttribute('type','password');
  await page.getByLabel('E-posta',{exact:true}).fill('visibility-test@example.com');
  await password.fill('test-only-password');await show.click();
  await expect(password).toHaveAttribute('type','text');expect(logins).toBe(0);
  await password.fill('');await password.fill('test-only-password');
  await expect(password).toHaveAttribute('type','password');
  await show.click();await page.getByRole('button',{name:'Giriş yap',exact:true}).click();
  await expect.poll(()=>logins).toBe(1);await expect(password).toHaveAttribute('type','password');
  await expect(show).toBeDisabled();release();
  await expect(page.getByRole('alert')).toHaveText('Test login rejected');
  await expect(password).toHaveValue('test-only-password');await expect(password).toHaveAttribute('type','password');
  await expect(show).toBeEnabled();expect(logins).toBe(1);
});

test('quick navigation traps focus, recovers from empty results and restores its trigger',async({page})=>{
  await page.goto('/');
  const trigger=page.getByRole('button',{name:"Akış'ta ara",exact:true});
  await expect(trigger).toBeEnabled();await trigger.click();
  const dialog=page.getByRole('dialog',{name:"Akış'ta ara",exact:true}),search=dialog.getByRole('combobox');
  await expect(search).toBeFocused();
  await search.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Kapat',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(search).toBeFocused();
  await search.fill('no-matching-screen');await search.press('ArrowDown');
  await expect(dialog.getByRole('status')).toHaveText('Aramana uyan ekran yok.');
  await expect(search).not.toHaveAttribute('aria-activedescendant');
  await search.fill('Takvim');
  await expect(dialog.getByRole('option',{selected:true})).toHaveText('Takvim');
  await search.press('Enter');await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading',{name:'Takvim',exact:true})).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();await expect(search).toHaveValue('');
  await search.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
});

for(const theme of ['light','dark'])test(`phone library fits long labels and keeps touch controls usable in ${theme} theme`,async({page})=>{
  await page.setViewportSize({width:360,height:780});
  await page.addInitScript(value=>localStorage.setItem('akis-theme',value),theme);
  const item={id:'ui-long-media',filename:'very-long-filename-'.repeat(15)+'.png',folder:'long-folder-'.repeat(12),tags:['long-tag-'.repeat(15)],status:'ready',mime_type:'image/png',url:null,archived:false,width:100,height:100,size:10};
  await page.route(/\/api\/media\?/,route=>route.fulfill({json:{items:[item],folders:[item.folder]}}));
  await page.goto('/');await expect(page.locator('#content')).toBeVisible();
  await page.getByRole('button',{name:"Akış'ta ara",exact:true}).click();
  const dialog=page.getByRole('dialog',{name:"Akış'ta ara",exact:true});
  await dialog.getByRole('combobox').fill('Medya kütüphanesi');await dialog.getByRole('combobox').press('Enter');
  await expect(page.locator('.library-card')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const buttons=page.locator('.library-actions button');
  for(const button of await buttons.all())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:test.info().outputPath(`library-${theme}-phone.png`),fullPage:true});
});
