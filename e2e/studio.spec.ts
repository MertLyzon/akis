import {expect,test} from '@playwright/test';

test('switching drafts asks before discarding edits and cancelling preserves them',async({page})=>{
  await page.goto('/');
  const names=[`Draft A ${Date.now()}`,`Draft B ${Date.now()}`];
  for(const text of names){
    const result=await page.request.post('/api/posts',{data:{requestId:crypto.randomUUID(),text,platforms:['x']}});
    expect(result.ok()).toBeTruthy();
  }
  await page.reload();
  await page.getByRole('button',{name:/^Gönderiler/}).click();
  await page.locator('article').filter({hasText:names[0]}).getByRole('button',{name:'Düzenle',exact:true}).click();
  await page.locator('#content').fill('Unsaved edits to preserve');
  await page.getByRole('button',{name:/^Gönderiler/}).click();
  await page.locator('article').filter({hasText:names[1]}).getByRole('button',{name:'Düzenle',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toContainText('Kaydedilmemiş değişikliklerin var.');
  await page.getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await page.getByRole('button',{name:'İçerik oluştur',exact:true}).click();
  await expect(page.locator('#content')).toHaveValue('Unsaved edits to preserve');
  await page.getByRole('button',{name:'Düzenlemeyi bırak',exact:true}).click();
  await page.getByRole('button',{name:'Değişiklikleri bırak',exact:true}).click();
  await expect(page.locator('#content')).toHaveValue('');
});

test('new content clears WhatsApp recipients and template settings',async({page})=>{
  await page.goto('/');
  await page.locator('#content').fill(`WhatsApp reset ${Date.now()}`);
  await page.getByRole('button',{name:'◉ WhatsApp',exact:true}).click();
  await page.getByLabel('Alıcı numaraları',{exact:true}).fill('905111111111');
  await page.getByLabel('Onaylı şablon adı',{exact:true}).fill('previous_template');
  await page.getByLabel('Şablon dil kodu',{exact:true}).fill('en_US');
  await page.getByRole('button',{name:'Taslağı kaydet',exact:true}).click();
  await page.getByRole('button',{name:'Yeni içerik',exact:true}).click();
  await expect(page.locator('#content')).toHaveValue('');
  await page.getByRole('button',{name:'◉ WhatsApp',exact:true}).click();
  await expect(page.getByLabel('Alıcı numaraları',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Onaylı şablon adı',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Şablon dil kodu',{exact:true})).toHaveValue('tr');
});

test('an outdated editor preserves text and cannot overwrite a newer save',async({page})=>{
  await page.goto('/');
  const original=`Conflict draft ${Date.now()}`;
  const created=await page.request.post('/api/posts',{data:{
    requestId:crypto.randomUUID(),text:original,platforms:['x'],send:false,
  }});
  expect(created.ok()).toBeTruthy();
  const {id}=await created.json();
  await page.reload();
  await page.getByRole('button',{name:/^Gönderiler/}).click();
  await page.locator('article').filter({hasText:original}).getByRole('button',{name:'Düzenle',exact:true}).click();
  const editor=page.locator('#content');
  await editor.fill('Changes in the older tab');
  const state=await (await page.request.get('/api/state')).json();
  const post=state.posts.find((p:any)=>p.id===id);
  const newer=await page.request.put(`/api/posts/${id}`,{data:{
    text:'Saved in another tab',platforms:['x'],expected_updated_at:post.updated_at,
  }});
  expect(newer.ok()).toBeTruthy();
  await page.getByRole('button',{name:'Taslağı kaydet',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Yazdığın metin korunuyor.');
  await expect(editor).toHaveValue('Changes in the older tab');
  await expect(page.getByRole('button',{name:'Taslağı kaydet',exact:true})).toBeDisabled();
  const latest=await (await page.request.get('/api/state')).json();
  expect(latest.posts.find((p:any)=>p.id===id).text).toBe('Saved in another tab');
});

test('saving locks the editor and a retry reuses the original request',async({page})=>{
  const requests:any[]=[];
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/posts',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    requests.push(route.request().postDataJSON());
    if(requests.length===1){await held;return route.abort('failed')}
    return route.continue();
  });
  await page.goto('/');
  const editor=page.locator('#content');
  const text=`Retry draft ${Date.now()}`;
  await editor.fill(text);
  await page.getByRole('button',{name:'Taslağı kaydet'}).evaluate(button=>{
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect.poll(()=>requests.length).toBe(1);
  await expect(editor).toBeDisabled();
  await expect(page.getByRole('button',{name:'Taslağı kaydet'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Paylaşımı başlat'})).toBeDisabled();
  await expect(page.getByRole('combobox',{name:'Şirket seç'})).toBeDisabled();
  release();
  await expect(editor).toBeEnabled();
  await expect(editor).toHaveValue(text);
  await page.getByRole('button',{name:'Taslağı kaydet'}).click();
  await expect(page.getByText(text,{exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].requestId).toBe(requests[0].requestId);
});

test('unsaved text survives immediate reloads and clearing removes the saved copy',async({page})=>{
  await page.goto('/');
  const editor=page.locator('#content');
  const text=`Unsent draft ${Date.now()}`;
  await editor.fill(text);
  await page.reload();
  await expect(editor).toHaveValue(text);
  await page.reload();
  await expect(editor).toHaveValue(text);
  await editor.fill('');
  await page.reload();
  await expect(editor).toHaveValue('');
});

test('API and system screen expose the running release',async({page,request})=>{
  const response=await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ok:true,release:{version:'0.4.0',commit:''}});

  await page.goto('/');
  await page.getByRole('button',{name:'Sistem yönetimi'}).click();
  await expect(page.getByText('Çalışan sürüm: v0.4.0')).toBeVisible();
  await expect(page.getByText('Yayındaki commit:')).toBeVisible();
});

test('language and hour-format preferences survive a reload',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Ayarlar'}).click();
  await expect(page.getByRole('heading',{name:'Dil ve saat'})).toBeVisible();
  await page.locator('#hour-format').selectOption('12');
  await page.getByText('İngilizce',{exact:true}).click();
  await expect(page.getByRole('heading',{name:'Language and time'})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.reload();
  await page.getByRole('button',{name:'Settings'}).click();
  await expect(page.locator('#hour-format')).toHaveValue('12');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
});

test('a draft can be created from the studio',async({page})=>{
  const text=`E2E smoke draft ${Date.now()}`;
  await page.goto('/');
  await page.getByPlaceholder('Bugün dünyayla ne paylaşmak istersin?').fill(text);
  await page.getByRole('button',{name:'Taslağı kaydet'}).click();
  await expect(page.getByText(text)).toBeVisible();
});
