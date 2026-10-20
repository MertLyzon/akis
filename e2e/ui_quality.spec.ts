import {expect,test} from '@playwright/test';

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
