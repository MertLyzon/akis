import {expect,test} from '@playwright/test';

test('platform settings lock repeated saves and preserve the secret after failure',async({page})=>{
  let requests=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/settings/oauth',async route=>{
    requests++;
    expect(route.request().postDataJSON()).toMatchObject({platform:'x',client_id:'test-client',client_secret:'test-only-secret'});
    if(requests===1){await held;return route.fulfill({status:503,json:{error:'Settings temporarily unavailable'}})}
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Ayarlar',exact:true}).click();
  const form=page.getByRole('form',{name:'X / Twitter Uygulama ayarları',exact:true});
  await form.getByLabel('Uygulama / Client ID',{exact:true}).fill('test-client');
  await form.getByLabel('Uygulama gizli anahtarı',{exact:true}).fill('test-only-secret');
  await form.getByLabel('Dönüş adresi',{exact:true}).fill('https://example.com/api/oauth/x/callback');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>requests).toBe(1);
  await expect(form.getByLabel('Uygulama gizli anahtarı',{exact:true})).toBeDisabled();
  await expect(form.getByLabel('Uygulama / Client ID',{exact:true})).toBeDisabled();
  await expect(form.getByLabel('Dönüş adresi',{exact:true})).toBeDisabled();
  await expect(page.getByRole('form',{name:'Instagram Uygulama ayarları',exact:true}).getByRole('button',{name:'Ayarları kaydet',exact:true})).toBeEnabled();
  release();
  await expect(form.getByRole('alert')).toContainText('Settings temporarily unavailable');
  await expect(form.getByLabel('Uygulama gizli anahtarı',{exact:true})).toHaveValue('test-only-secret');
  await form.getByRole('button',{name:'Ayarları kaydet',exact:true}).click();
  await expect(form.getByLabel('Uygulama gizli anahtarı',{exact:true})).toHaveValue('');
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(form.locator('..')).toContainText('Tanımlı');
  expect(requests).toBe(2);
});

test('team invitation locks repeated submits and preserves fields after failure',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/company')).json();
  let requests=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/company',route=>requests<2?route.fulfill({json:snapshot}):route.fulfill({status:503,json:{error:'Company refresh unavailable'}}));
  await page.route('**/api/company/members',async route=>{
    requests++;
    if(requests===1){await held;return route.fulfill({status:503,json:{error:'Invitation temporarily unavailable'}})}
    return route.fulfill({json:{email:'invite-test@example.com',invite_path:'/join?token=test-only',expires_at:Math.floor(Date.now()/1000)+3600}});
  });
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  const form=page.locator('form.member-add');
  await form.getByPlaceholder('E-posta',{exact:true}).fill('invite-test@example.com');
  await form.getByPlaceholder('Ad Soyad (isteğe bağlı)').fill('Test Member');
  await form.getByLabel('Rol',{exact:true}).selectOption('viewer');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>requests).toBe(1);
  await expect(form.getByPlaceholder('E-posta',{exact:true})).toBeDisabled();
  await expect(page.locator('input[name="name"]')).toBeDisabled();
  release();
  await expect(form.getByPlaceholder('E-posta',{exact:true})).toBeEnabled();
  await expect(form.getByPlaceholder('E-posta',{exact:true})).toHaveValue('invite-test@example.com');
  await expect(form.getByPlaceholder('Ad Soyad (isteğe bağlı)')).toHaveValue('Test Member');
  await expect(form.getByLabel('Rol',{exact:true})).toHaveValue('viewer');
  await form.getByRole('button',{name:'Davet et',exact:true}).click();
  await expect(page.locator('.secret-card code')).toContainText('/join?token=test-only');
  await expect(page.getByRole('alert').filter({hasText:'Company refresh unavailable'})).toBeVisible();
  await expect(form.getByPlaceholder('E-posta',{exact:true})).toHaveValue('');
  expect(requests).toBe(2);
});

test('team password reset requires confirmation and cannot submit twice',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/company')).json();
  snapshot.members.push({user_id:'mock-member',email:'reset-test@example.com',name:'Reset Test',role:'editor',totp_enabled:false,must_change_password:false});
  await page.route('**/api/company',route=>route.fulfill({json:snapshot}));
  let requests=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/company/members/mock-member/reset-password',async route=>{
    requests++;
    if(requests===1){await held;return route.fulfill({status:503,json:{error:'Reset temporarily unavailable'}})}
    return route.fulfill({json:{temporary_password:'test-only-password'}});
  });
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:'reset-test@example.com'});
  await row.getByRole('button',{name:'Parolayı sıfırla',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await expect(modal).toContainText('reset-test@example.com');
  await modal.getByRole('button',{name:'Vazgeç',exact:true}).click();
  await expect(modal).toBeHidden();expect(requests).toBe(0);
  await row.getByRole('button',{name:'Parolayı sıfırla',exact:true}).click();
  await modal.getByRole('button',{name:'Onayla',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>requests).toBe(1);
  await expect(row.getByRole('combobox')).toBeDisabled();
  await expect(modal.getByRole('button',{name:'Vazgeç',exact:true})).toBeDisabled();
  release();
  await expect(modal.getByRole('button',{name:'Onayla',exact:true})).toBeEnabled();
  await modal.getByRole('button',{name:'Onayla',exact:true}).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.secret-card code')).toHaveText('test-only-password');
  expect(requests).toBe(2);
});

test('review locks one post and preserves the rejection note after a failure',async({page})=>{
  await page.goto('/');
  const names=[`Review A ${Date.now()}`,`Review B ${Date.now()}`];
  for(const text of names)expect((await page.request.post('/api/posts',{data:{requestId:crypto.randomUUID(),text,platforms:['x']}})).ok()).toBeTruthy();
  const snapshot=await (await page.request.get('/api/state')).json();
  const post=snapshot.posts.find((p:any)=>p.text===names[0]);
  post.status='pending_approval';
  await page.route('**/api/state',route=>route.fulfill({json:snapshot}));
  let requests=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route(`**/api/posts/${post.id}/reject`,async route=>{
    requests++;
    if(requests===1){await held;return route.fulfill({status:503,json:{error:'Temporary review failure'}})}
    post.status='rejected';post.review_note=route.request().postDataJSON().note;
    return route.fulfill({json:{ok:true}});
  });
  await page.reload();
  await page.getByRole('button',{name:/^Gönderiler/}).click();
  const row=page.locator('article').filter({hasText:names[0]});
  await row.getByRole('button',{name:'Reddet',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await expect(modal.getByRole('button',{name:'Reddet',exact:true})).toBeDisabled();
  await modal.getByLabel('Red nedeni',{exact:true}).fill('Please update the image');
  await modal.getByRole('button',{name:'Reddet',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>requests).toBe(1);
  await expect(row).toHaveAttribute('aria-busy','true');
  await expect(row.getByRole('button',{name:'Onayla',exact:true,includeHidden:true})).toBeDisabled();
  await expect(page.locator('article').filter({hasText:names[1]}).getByRole('button',{name:'Düzenle',exact:true,includeHidden:true})).toBeEnabled();
  release();
  await expect(modal.getByLabel('Red nedeni',{exact:true})).toBeEnabled();
  await expect(modal.getByLabel('Red nedeni',{exact:true})).toHaveValue('Please update the image');
  await modal.getByRole('button',{name:'Reddet',exact:true}).click();
  await expect(modal).toBeHidden();
  await expect(row).toContainText('Please update the image');
  expect(requests).toBe(2);
});

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
