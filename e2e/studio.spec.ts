import {expect,test} from '@playwright/test';

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
