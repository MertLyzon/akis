import {expect,test} from '@playwright/test';

test('account password mismatch focuses and describes the confirmation without sending credentials',async({page})=>{
  let writes=0;
  await page.route('**/api/me/password',route=>{writes++;return route.fulfill({status:503,json:{error:'Test password service unavailable'}})});
  await page.goto('/');await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  const form=page.getByRole('form',{name:'Parolayı değiştir',exact:true}),confirmation=form.getByLabel('Yeni parola tekrar',{exact:true});
  await form.getByLabel('Mevcut parola',{exact:true}).fill('test-current-password');
  await form.getByLabel('Yeni parola · en az 10 karakter',{exact:true}).fill('test-new-password');
  await confirmation.fill('test-different-password');
  await form.getByRole('button',{name:'Parolayı değiştir',exact:true}).click();
  await expect(confirmation).toBeFocused();await expect(confirmation).toHaveAttribute('aria-invalid','true');
  await expect(confirmation).toHaveAccessibleDescription('Yeni parolalar eşleşmiyor.');expect(writes).toBe(0);
  await confirmation.fill('test-new-password');
  await expect(confirmation).not.toHaveAttribute('aria-invalid','true');await expect(form.getByRole('alert')).toHaveCount(0);
  await form.getByRole('button',{name:'Parolayı değiştir',exact:true}).click();
  await expect(form.getByRole('alert')).toContainText('Test password service unavailable');expect(writes).toBe(1);
  await expect(confirmation).toHaveValue('test-new-password');
});

test('invitation password mismatch recovers inline and clears when switching account mode',async({page})=>{
  const token='q'.repeat(32);let accepts=0;
  await page.route('**/api/invites/'+token,route=>route.fulfill({json:{company:'Test company',email:'test@example.com',role:'editor',expires_at:Math.floor(Date.now()/1000)+3600}}));
  await page.route('**/api/invites/'+token+'/accept',route=>{accepts++;return route.fulfill({status:503,json:{error:'Test invitation service unavailable'}})});
  await page.goto('/#davet='+token);await page.getByRole('button',{name:'Yeni hesap',exact:true}).click();
  const form=page.getByRole('form',{name:'Daveti kabul et',exact:true}),confirmation=form.getByLabel('Yeni parola tekrar',{exact:true});
  await form.getByLabel('Yeni parola · en az 10 karakter',{exact:true}).fill('test-new-password');
  await confirmation.fill('test-different-password');
  await form.getByRole('button',{name:'Daveti kabul et',exact:true}).click();
  await expect(confirmation).toBeFocused();await expect(confirmation).toHaveAccessibleDescription('Parolalar eşleşmiyor.');expect(accepts).toBe(0);
  await form.getByRole('button',{name:'Hesabım var',exact:true}).click();
  await form.getByRole('button',{name:'Yeni hesap',exact:true}).click();
  await expect(confirmation).not.toHaveAttribute('aria-invalid','true');await expect(page.getByRole('alert')).toHaveCount(0);
  await form.getByRole('button',{name:'Daveti kabul et',exact:true}).click();await expect(confirmation).toHaveAttribute('aria-invalid','true');
  await confirmation.fill('test-new-password');await expect(page.getByRole('alert')).toHaveCount(0);
  await form.getByRole('button',{name:'Daveti kabul et',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Test invitation service unavailable');expect(accepts).toBe(1);
});

test('failed media previews stop retrying automatically and a ready asset without URL is not processing',async({page})=>{
  let previews=0;const writes:string[]=[];
  const broken={id:'ui-broken-preview',filename:'broken.png',folder:'',tags:[],status:'ready',mime_type:'image/png',url:'/test-preview/broken.png',archived:false,width:100,height:100,size:10};
  const missing={...broken,id:'ui-missing-preview',filename:'missing-url.png',url:null};
  await page.route(/\/api\/media\?/,route=>route.fulfill({json:{items:[broken,missing],folders:[]}}));
  await page.route('**/test-preview/broken.png',route=>{previews++;return route.fulfill({status:404,body:'Missing image'})});
  await page.route(/\/api\/media(?:\/[^?]+)?$/,route=>{writes.push(route.request().method());return route.fulfill({json:{ok:true}})});
  await page.goto('/');await page.getByRole('button',{name:'Medya kütüphanesi',exact:true}).click();
  const brokenCard=page.locator('.library-card').filter({hasText:'broken.png'}),missingCard=page.locator('.library-card').filter({hasText:'missing-url.png'});
  await expect(brokenCard.getByText('Önizleme yüklenemedi.',{exact:true})).toBeVisible();
  await expect(missingCard.getByText('Önizleme bağlantısı yok.',{exact:true})).toBeVisible();
  await expect(missingCard.locator('.spin')).toHaveCount(0);expect(previews).toBe(1);
  await brokenCard.getByRole('button',{name:'Önizlemeyi tekrar dene',exact:true}).click();
  await expect(brokenCard.getByText('Önizleme yüklenemedi.',{exact:true})).toBeVisible();
  expect(writes).toEqual([]);
});

test('main content has one landmark and a keyboard skip link without changing the invitation hash',async({page})=>{
  await page.goto('/');await expect(page.locator('#content')).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  const skip=page.getByRole('link',{name:'Ana içeriğe geç',exact:true});
  await skip.focus();await expect(skip).toBeInViewport();
  await skip.press('Enter');await expect(page.getByRole('main')).toBeFocused();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('button',{name:'İçerik oluştur',exact:true})).toHaveAttribute('aria-current','page');
  await page.getByRole('button',{name:/^Gönderiler/}).click();
  await expect(page.getByRole('button',{name:/^Gönderiler/})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('main')).toHaveAccessibleName('Gönderiler');
});

test('phone menu exposes the current destination and dismisses after navigation',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');await expect(page.locator('#content')).toBeVisible();
  const menu=page.getByRole('button',{name:'Menüyü aç veya kapat',exact:true});
  await menu.click();
  const drawer=page.getByRole('dialog');await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button',{name:'İçerik oluştur',exact:true})).toHaveAttribute('aria-current','page');
  await drawer.getByRole('button',{name:'Takvim',exact:true}).click();
  await expect(drawer).toBeHidden();await expect(page.getByRole('main')).toHaveAccessibleName('Takvim');
});

test('system overview does not retain a healthy claim after failed refresh or missing assessment',async({page})=>{
  const snapshot=await (await page.request.get('/api/system/overview')).json();
  snapshot.operational={level:'healthy',issues:[]};let fail=false,reads=0;
  await page.route('**/api/system/overview',route=>{
    reads++;return fail?route.fulfill({status:503,json:{error:'Overview temporarily unavailable'}}):route.fulfill({json:snapshot});
  });
  await page.goto('/');await page.getByRole('button',{name:'Sistem yönetimi',exact:true}).click();
  const summary=page.locator('.operational-summary');
  await expect(summary).toContainText('Tüm sistemler sağlıklı');
  await expect(page.locator('.system-last-update')).toContainText('Son başarılı güncelleme');
  fail=true;await page.getByRole('button',{name:'Yenile',exact:true}).click();
  await expect(summary).toContainText('Sistem durumu doğrulanamadı');
  await expect(page.locator('.health.ok')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Servis sağlığı',exact:true})).toBeVisible();
  fail=false;delete snapshot.operational;
  await page.getByRole('button',{name:'Yenile',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Overview temporarily unavailable'})).toHaveCount(0);
  await expect(summary).toContainText('Sistem durumu doğrulanamadı');
  snapshot.operational={level:'healthy',issues:[]};await page.getByRole('button',{name:'Yenile',exact:true}).click();
  await expect(summary).toContainText('Tüm sistemler sağlıklı');expect(reads).toBeGreaterThanOrEqual(4);
});

test('team search restores rows and failed activity reads have an explicit single-flight retry',async({page})=>{
  let reads=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route(/\/api\/audit\?/,async route=>{
    reads++;if(reads===1)return route.fulfill({status:503,json:{error:'Audit temporarily unavailable'}});
    await held;return route.fulfill({json:{items:[]}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  const table=page.getByRole('table',{name:'Ekip üyeleri',exact:true});
  await expect(table).toBeVisible();
  const rows=await table.locator('tbody tr').count();expect(rows).toBeGreaterThan(0);
  const search=page.getByRole('searchbox',{name:'Ekipte ara',exact:true});
  await search.fill('no-member-with-this-name');await expect(table).toContainText('Aramana uyan üye yok.');
  await table.getByRole('button',{name:'Aramayı temizle',exact:true}).click();await expect(search).toHaveValue('');await expect(search).toBeFocused();
  await expect(table.locator('tbody tr')).toHaveCount(rows);
  const history=page.locator('section').filter({has:page.getByRole('heading',{name:'İşlem geçmişi',exact:true})});
  const error=history.getByRole('alert');await expect(error).toContainText('Audit temporarily unavailable');
  await expect(history.getByText('Henüz işlem kaydı yok.',{exact:true})).toHaveCount(0);
  await error.getByRole('button',{name:'Tekrar dene',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>reads).toBe(2);await expect(error.getByRole('button')).toBeDisabled();
  release();await expect(error).toHaveCount(0);await expect(history.getByText('Henüz işlem kaydı yok.',{exact:true})).toBeVisible();expect(reads).toBe(2);
});

test('activity pagination retries its failed cursor without losing existing records',async({page})=>{
  const first=Array.from({length:50},(_,i)=>({id:`activity-${i}`,at:1000-i,user:'Test member',action:'content.draft_saved',details:{}}));
  const cursors:string[]=[];
  await page.route(/\/api\/audit\?/,route=>{
    const url=new URL(route.request().url());cursors.push(url.searchParams.get('before_id')||'');
    if(cursors.length===1)return route.fulfill({json:{items:first}});
    if(cursors.length===2)return route.fulfill({status:503,json:{error:'Older activity unavailable'}});
    return route.fulfill({json:{items:[{id:'older-activity',at:900,user:'Older member',action:'content.draft_saved',details:{}}]}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  await expect(page.locator('.audit-list li')).toHaveCount(50);
  await page.getByRole('button',{name:'Daha eski kayıtlar',exact:true}).click();
  const error=page.getByRole('alert').filter({hasText:'Older activity unavailable'});await expect(error).toBeVisible();
  await expect(page.locator('.audit-list li')).toHaveCount(50);
  await error.getByRole('button',{name:'Tekrar dene',exact:true}).click();
  await expect(page.locator('.audit-list li')).toHaveCount(51);expect(cursors).toEqual(['','activity-49','activity-49']);
});

test('saved app settings expose copy feedback and do not resend unchanged values',async({page})=>{
  const state=await (await page.request.get('/api/state')).json();
  const config={platform:'x',client_id:'original-client',redirect_uri:'https://example.com/api/oauth/x/callback',mode:'web',has_secret:true};
  state.settings.oauth_apps=[config];let writes=0;
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).testCopiedCallback=value}}}));
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.route('**/api/settings/oauth',route=>{writes++;config.client_id=route.request().postDataJSON().client_id;return route.fulfill({json:{ok:true}})});
  await page.goto('/');await page.getByRole('button',{name:'Ayarlar',exact:true}).click();
  const form=page.getByRole('form',{name:'X / Twitter Uygulama ayarları',exact:true});
  const save=form.getByRole('button',{name:'Ayarları kaydet',exact:true});
  await expect(save).toBeDisabled();await expect(form.getByRole('status')).toHaveText('Kaydedilmemiş değişiklik yok.');
  await form.getByRole('button',{name:'Dönüş adresini kopyala',exact:true}).click();
  await expect(form.getByText('Kopyalandı.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).testCopiedCallback)).toBe(config.redirect_uri);expect(writes).toBe(0);
  await form.getByLabel('Uygulama / Client ID',{exact:true}).fill('updated-client');
  await expect(save).toBeEnabled();await expect(form.getByText('Kaydedilmemiş değişiklikler',{exact:true})).toBeVisible();
  await save.click();await expect(save).toBeDisabled();
  await expect(form.getByLabel('Uygulama / Client ID',{exact:true})).toBeEnabled();
  await form.evaluate(node=>node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await expect(form.getByLabel('Uygulama / Client ID',{exact:true})).toBeEnabled();
  expect(writes).toBe(1);
});

test('connection cards distinguish expired, renewal-error and expiring accounts without extra checks',async({page})=>{
  const state=await (await page.request.get('/api/state')).json();
  state.connections=[{id:'ui-expired',platform:'x',label:'Expired account',days_left:0,expires_at:null,can_refresh:false},
    {id:'ui-renewal',platform:'instagram',label:'Renewal failed',days_left:null,expires_at:null,refresh_error:'Renewal needs attention',can_refresh:false},
    {id:'ui-soon',platform:'tiktok',label:'Expiring account',days_left:7,expires_at:null,can_refresh:true}];
  let checks=0;
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.route('**/api/connections/refresh',route=>{checks++;return route.fulfill({json:{ok:true}})});
  await page.goto('/');await page.getByRole('button',{name:'Bağlantılar',exact:true}).click();
  await expect(page.locator('.connection-banner')).toContainText('3 bağlantı kontrol gerektiriyor.');
  await expect(page.locator('.connection').filter({hasText:'Expired account'}).locator('.connection-heading')).toContainText('Süresi doldu');
  await expect(page.locator('.connection').filter({hasText:'Renewal failed'}).locator('.connection-heading')).toContainText('Kontrol gerekiyor');
  await expect(page.locator('.connection').filter({hasText:'Expiring account'}).locator('.connection-heading')).toContainText('Yakında doluyor');
  await expect(page.locator('.connection-heading').filter({hasText:'WhatsApp'})).toContainText('Bağlanmadı');
  expect(checks).toBe(0);
});

test('calendar offers a desktop agenda and today opens at a future company-local hour',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-10-20T13:42:00Z'));
  const state=await (await page.request.get('/api/state')).json();state.company.timezone='Europe/Istanbul';
  state.posts=[{id:'ui-calendar-completed',status:'completed',text:'Published calendar item',created:Date.now(),options:{},platforms:['x'],deliveries:[{sent_at:Date.parse('2026-10-20T10:00:00Z')/1000}]}];
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.goto('/');await page.getByRole('button',{name:'Takvim',exact:true}).click();
  await expect(page.locator('.calendar-viewbar')).toContainText('1 paylaşım bu ayda');
  await expect(page.locator('.calendar-item')).not.toHaveJSProperty('tagName','BUTTON');
  await page.getByRole('button',{name:'Liste görünümü',exact:true}).click();
  await expect(page.locator('.calendar-grid')).toBeHidden();
  await expect(page.getByRole('region',{name:'Bu ayki paylaşımlar',exact:true})).toContainText('Published calendar item');
  await page.getByRole('button',{name:'Sonraki ay',exact:true}).click();
  await expect(page.getByText('Bu ay için planlı veya yayımlanmış içerik yok.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Bugün',exact:true}).click();
  await page.getByRole('button',{name:'Ay görünümü',exact:true}).click();
  await page.getByRole('button',{name:'2026-10-20 Bu güne içerik planla',exact:true}).click();
  await expect(page.getByRole('heading',{name:'İçerik oluştur',exact:true})).toBeVisible();
  await expect(page.getByLabel('Paylaşım tarihi',{exact:true})).toHaveValue('2026-10-20');
  await expect(page.getByLabel('Saat',{exact:true})).toHaveValue('17');
  await expect(page.getByText('Geçmiş bir saat seçilemez.',{exact:false})).toHaveCount(0);
});

test('empty library filters preserve their selected option and clear in one fresh read',async({page})=>{
  const reads:URL[]=[];
  const asset={id:'ui-library-filter',filename:'launch.png',folder:'Launch',tags:['important'],status:'ready',mime_type:'image/png',url:null,archived:false,width:100,height:100,size:10};
  await page.route(/\/api\/media\?/,route=>{
    const url=new URL(route.request().url());reads.push(url);
    const filtered=['folder','tag','q'].some(key=>url.searchParams.get(key))||url.searchParams.get('archived')==='true';
    return route.fulfill({json:{items:filtered?[]:[asset],folders:['Launch']}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Medya kütüphanesi',exact:true}).click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  const filters=page.locator('.library-filters'),tag=filters.getByRole('combobox',{name:'Etiket',exact:true});
  await tag.selectOption('important');
  await expect(page.getByRole('heading',{name:'Filtrelerine uyan medya yok.',exact:true})).toBeVisible();
  await expect(tag).toHaveValue('important');await expect(tag.locator('option:checked')).toHaveText('important');
  await filters.getByRole('combobox',{name:'Klasör',exact:true}).selectOption('Launch');
  const search=filters.getByRole('searchbox',{name:'Dosya adında ara',exact:true});
  await search.fill('missing');await expect.poll(()=>reads.at(-1)?.searchParams.get('q')).toBe('missing');
  await expect(page.getByRole('heading',{name:'Filtrelerine uyan medya yok.',exact:true})).toBeVisible();
  const before=reads.length;await page.getByRole('button',{name:'Filtreleri temizle',exact:true}).click();
  await expect(page.locator('.library-card')).toHaveCount(1);expect(reads.length).toBe(before+1);
  await expect(search).toBeFocused();await expect(search).toHaveValue('');await expect(tag).toHaveValue('');
  await expect(page.locator('.library-results-summary')).toContainText('1 dosya gösteriliyor');
});

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
