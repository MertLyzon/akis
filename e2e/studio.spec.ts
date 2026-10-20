import {expect,test} from '@playwright/test';

test('a stopped upload can be replaced without a late old response replacing the new media',async({page})=>{
  let release!:()=>void,requests=0;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route(/\/api\/media$/,async route=>{
    requests++;
    if(requests===1){await held;try{await route.fulfill({status:202,json:{id:'test-old-upload',filename:'old.png',mime_type:'image/png',status:'processing',url:null}})}catch{/* cancellation already aborted this request */}return}
    return route.fulfill({status:202,json:{id:'test-new-upload',filename:'new.png',mime_type:'image/png',status:'processing',url:null}});
  });
  await page.goto('/');
  const input=page.getByLabel('Medya dosyası seç',{exact:true});
  await input.setInputFiles({name:'old.png',mimeType:'image/png',buffer:Buffer.from('test-only-old-image')});
  await expect.poll(()=>requests).toBe(1);
  await expect(page.getByRole('button',{name:'Taslağı kaydet',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Yüklemeyi durdur',exact:true}).click();
  await expect(input).toBeEnabled();
  await expect(page.getByText('Yükleme durduruldu. Sunucuya ulaşan dosyalar kütüphanede kalabilir. Yeniden yüklemeden önce kontrol et.',{exact:true})).toBeVisible();
  await input.setInputFiles({name:'new.png',mimeType:'image/png',buffer:Buffer.from('test-only-new-image')});
  await expect(page.locator('.asset-card')).toContainText('new.png');release();
  await expect(page.getByRole('button',{name:'Taslağı kaydet',exact:true})).toBeEnabled();
  await expect(page.locator('.asset-card')).not.toContainText('old.png');expect(requests).toBe(2);
});

test('starting an upload closes the picker and ignores a same-event stale media selection',async({page})=>{
  const asset={id:'test-picked-media',filename:'existing-library.png',folder:'',tags:[],status:'ready',mime_type:'image/png',url:null,archived:false,width:1,height:1,size:10};
  let uploads=0,saves=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route(/\/api\/media\?/,route=>route.fulfill({json:{items:[asset],folders:[]}}));
  await page.route(/\/api\/media$/,async route=>{uploads++;await held;return route.fulfill({status:202,json:{id:'test-uploaded-media',filename:'new-upload.png',mime_type:'image/png',status:'processing',url:null}})});
  await page.route('**/api/posts',route=>{saves++;return route.fulfill({json:{id:'unexpected-draft',outcome:'draft'}})});
  await page.goto('/');await page.locator('#content').fill('Keep this draft text');
  await page.getByRole('button',{name:'veya medya kütüphanesinden seç',exact:true}).click();
  await expect(page.locator('.picker').getByRole('button',{name:'Seç',exact:true})).toBeVisible();
  await page.evaluate(()=>{
    const input=document.querySelector<HTMLInputElement>('input[type=file]')!;
    const choose=[...document.querySelectorAll<HTMLButtonElement>('.picker button')].find(button=>button.textContent?.trim()==='Seç')!;
    const save=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Taslağı kaydet')!;
    const files=new DataTransfer();files.items.add(new File(['test-only-image'],'new-upload.png',{type:'image/png'}));
    input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));choose.click();save.click();
  });
  await expect.poll(()=>uploads).toBe(1);await expect(page.locator('.picker')).toHaveCount(0);
  await expect(page.locator('.asset-card')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Taslağı kaydet',exact:true})).toBeDisabled();
  await expect(page.locator('#content')).toHaveValue('Keep this draft text');expect(saves).toBe(0);
  release();await expect(page.locator('.asset-card')).toContainText('new-upload.png');
  await expect(page.locator('.asset-card')).not.toContainText('existing-library.png');
  await expect(page.getByRole('button',{name:'Taslağı kaydet',exact:true})).toBeEnabled();
  expect(uploads).toBe(1);expect(saves).toBe(0);
});

test('saving rejects a same-event file selection and permits upload after a failed save',async({page})=>{
  let saves=0,uploads=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/posts',async route=>{saves++;await held;return route.fulfill({status:503,json:{error:'Draft save temporarily unavailable'}})});
  await page.route(/\/api\/media$/,route=>{uploads++;return route.fulfill({status:202,json:{id:'test-after-save',filename:'after-save.png',mime_type:'image/png',status:'processing',url:null}})});
  await page.goto('/');await page.locator('#content').fill('Keep this draft while saving');
  await expect(page.getByRole('button',{name:'Taslağı kaydet',exact:true})).toBeEnabled();
  await page.evaluate(()=>{
    const input=document.querySelector<HTMLInputElement>('input[type=file]')!;
    const save=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Taslağı kaydet')!;
    const files=new DataTransfer();files.items.add(new File(['test-only-image'],'blocked-upload.png',{type:'image/png'}));
    save.click();input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect.poll(()=>saves).toBe(1);
  await expect(page.getByRole('button',{name:'Taslağı kaydet',exact:true})).toBeDisabled();
  expect(uploads).toBe(0);await expect(page.getByRole('button',{name:'Yüklemeyi durdur',exact:true})).toHaveCount(0);
  release();await expect(page.getByText('Draft save temporarily unavailable',{exact:true})).toBeVisible();
  await expect(page.locator('#content')).toHaveValue('Keep this draft while saving');
  await page.getByLabel('Medya dosyası seç',{exact:true}).setInputFiles({name:'after-save.png',mimeType:'image/png',buffer:Buffer.from('test-only-image')});
  await expect(page.locator('.asset-card')).toContainText('after-save.png');expect(uploads).toBe(1);expect(saves).toBe(1);
});

test('a timed-out draft save keeps the editor and only an explicit retry resends its idempotency key',async({page})=>{
  await page.clock.install();
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve}),bodies:any[]=[];
  await page.route('**/api/posts',async route=>{
    bodies.push(route.request().postDataJSON());
    if(bodies.length===1){await held;try{await route.fulfill({json:{id:'test-late-draft',outcome:'draft'}})}catch{/* the deadline aborted this request */}return}
    return route.fulfill({json:{id:'test-retried-draft',outcome:'draft'}});
  });
  await page.goto('/');
  await page.locator('#content').fill('Keep this text after timeout');
  await page.getByRole('button',{name:'Taslağı kaydet',exact:true}).click();
  await expect.poll(()=>bodies.length).toBe(1);
  await page.clock.fastForward(60_001);
  await expect(page.getByText('İstek zaman aşımına uğradı. İşlem sunucuda tamamlanmış olabilir. Yeniden denemeden önce sonucu kontrol et.',{exact:true})).toBeVisible();
  await expect(page.locator('#content')).toHaveValue('Keep this text after timeout');
  await expect(page.getByRole('button',{name:'Taslağı kaydet',exact:true})).toBeEnabled();
  expect(bodies).toHaveLength(1);release();
  await page.getByRole('button',{name:'Taslağı kaydet',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Gönderiler',exact:true})).toBeVisible();
  expect(bodies).toHaveLength(2);expect(bodies[1].requestId).toBe(bodies[0].requestId);
});

test('a failed initial library read shows an error rather than an empty library and retry is single-flight',async({page})=>{
  const asset={id:'test-library-retry',filename:'retry-library.png',folder:'',tags:[],status:'failed',error:'Test fixture',mime_type:'image/png',url:null,archived:false};
  let reads=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route(/\/api\/media\?/,async route=>{
    reads++;
    if(reads===1)return route.fulfill({status:503,json:{error:'Library temporarily unavailable'}});
    await held;return route.fulfill({json:{items:[asset],folders:[]}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Medya kütüphanesi',exact:true}).click();
  const warning=page.getByRole('alert').filter({hasText:'Library temporarily unavailable'});
  await expect(warning).toBeVisible();
  await expect(page.getByRole('heading',{name:'Medya listesi alınamadı.',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Kütüphanende henüz medya yok.',exact:true})).toHaveCount(0);
  await warning.getByRole('button',{name:'Tekrar dene',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>reads).toBe(2);await expect(warning.getByRole('button')).toBeDisabled();
  release();await expect(page.locator('.library-card')).toContainText('retry-library.png');
  await expect(warning).toBeHidden();expect(reads).toBe(2);
});

test('a confirmed media delete remains removed when list refresh fails and retry only reads',async({page})=>{
  const asset={id:'test-library-delete',filename:'delete-library.png',folder:'',tags:[],status:'failed',error:'Test fixture',mime_type:'image/png',url:null,archived:false};
  let deletes=0,reads=0,recovered=false;
  await page.route(/\/api\/media\?/,route=>{
    reads++;
    if(deletes&&!recovered)return route.fulfill({status:503,json:{error:'Library refresh unavailable'}});
    return route.fulfill({json:{items:deletes?[]:[asset],folders:[]}});
  });
  await page.route('**/api/media/test-library-delete',route=>{expect(route.request().method()).toBe('DELETE');deletes++;return route.fulfill({json:{ok:true}})});
  await page.goto('/');await page.getByRole('button',{name:'Medya kütüphanesi',exact:true}).click();
  await page.locator('.library-card').getByRole('button',{name:'Sil',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Sil',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();await expect(page.locator('.library-card')).toHaveCount(0);
  await expect(page.getByText('İşlem tamamlandı ancak medya listesi yenilenemedi. İşlemi tekrarlamadan listeyi yenile.',{exact:true})).toBeVisible();
  const warning=page.getByRole('alert').filter({hasText:'Library refresh unavailable'});
  await expect(warning).toBeVisible();const before=reads;recovered=true;
  await warning.getByRole('button',{name:'Tekrar dene',exact:true}).click();
  await expect(warning).toBeHidden();await expect(page.getByRole('heading',{name:'Kütüphanende henüz medya yok.',exact:true})).toBeVisible();
  expect(deletes).toBe(1);expect(reads).toBe(before+1);
});

test('library labels survive list refresh and failed saves without duplicate mutations',async({page})=>{
  const asset={id:'test-library-labels',filename:'library-labels.png',folder:'Original',tags:['one'],status:'processing',mime_type:'image/png',url:null,archived:false};
  let items=[asset],requests=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route(/\/api\/media\?/,route=>route.fulfill({json:{items,folders:['Original']}}));
  await page.route('**/api/media/test-library-labels',async route=>{
    requests++;
    expect(route.request().postDataJSON()).toEqual({folder:'Edited folder',tags:['one',' two']});
    if(requests===1){await held;return route.fulfill({status:503,json:{error:'Media temporarily unavailable'}})}
    return route.fulfill({json:{...asset,folder:'Edited folder',tags:['one','two']}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Medya kütüphanesi',exact:true}).click();
  await page.getByRole('button',{name:'Klasör ve etiket düzenle',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Klasör ve etiket düzenle',exact:true});
  const form=dialog.getByRole('form',{name:'Medya bilgileri',exact:true});
  await form.getByLabel('Klasör',{exact:true}).fill('Edited folder');
  await form.getByLabel('Etiketler, virgülle',{exact:true}).fill('one, two');
  items=[];
  await expect(page.locator('.library-card')).toHaveCount(0);
  await expect(form.getByLabel('Klasör',{exact:true})).toHaveValue('Edited folder');
  await form.getByRole('button',{name:'Vazgeç',exact:true}).click();
  const discard=page.getByRole('alertdialog');
  await expect(discard).toContainText('Kaydedilmemiş değişiklikler');
  await discard.getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await expect(form.getByLabel('Etiketler, virgülle',{exact:true})).toHaveValue('one, two');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>requests).toBe(1);
  await expect(form.getByRole('button',{name:'Vazgeç',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Hesabım',exact:true,includeHidden:true})).toBeDisabled();release();
  await expect(form.getByRole('alert')).toContainText('Media temporarily unavailable');
  await expect(form.getByLabel('Klasör',{exact:true})).toHaveValue('Edited folder');
  await form.getByRole('button',{name:'Kaydet',exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button',{name:'Hesabım',exact:true})).toBeEnabled();expect(requests).toBe(2);
});

test('discarding library label edits clears the navigation warning without saving',async({page})=>{
  const asset={id:'test-library-discard',filename:'discard-labels.png',folder:'Original',tags:[],status:'failed',error:'Test fixture',mime_type:'image/png',url:null,archived:false};
  let requests=0;
  await page.route(/\/api\/media\?/,route=>route.fulfill({json:{items:[asset],folders:['Original']}}));
  await page.route('**/api/media/test-library-discard',route=>{requests++;return route.fulfill({json:asset})});
  await page.goto('/');
  await page.getByRole('button',{name:'Medya kütüphanesi',exact:true}).click();
  await page.getByRole('button',{name:'Klasör ve etiket düzenle',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Klasör ve etiket düzenle',exact:true});
  await dialog.getByLabel('Klasör',{exact:true}).fill('Unsaved folder');
  await page.keyboard.press('Escape');
  const discard=page.getByRole('alertdialog');
  await expect(discard).toContainText('Kaydedilmemiş değişiklikler');
  await discard.getByRole('button',{name:'Değişiklikleri bırak',exact:true}).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await expect(page.getByRole('button',{name:'Kurulumu başlat',exact:true})).toBeVisible();
  await expect(discard).toBeHidden();expect(requests).toBe(0);
});

for(const [kind,status,label] of [['delete','draft','Sil'],['cancel','scheduled','Planı iptal et']])test(`a stale ${kind} confirmation must be reopened against the refreshed version`,async({page})=>{
  await page.goto('/');
  const created=await page.request.post('/api/posts',{data:{requestId:crypto.randomUUID(),text:`Original ${kind} confirmation`,platforms:['x']}});
  const identifier=(await created.json()).id;
  const snapshot=await (await page.request.get('/api/state')).json();
  const post=snapshot.posts.find((p:any)=>p.id===identifier);
  post.status=status;
  const originalVersion=post.updated_at;
  await page.route('**/api/state',route=>route.fulfill({json:snapshot}));
  let requests=0;
  await page.route(`**/api/posts/${identifier}${kind==='delete'?'':'/cancel'}`,route=>{
    requests++;
    expect(route.request().postDataJSON().expected_updated_at).toBe(requests===1?originalVersion:post.updated_at);
    if(requests===1){post.text=`Updated ${kind} confirmation`;post.updated_at++;return route.fulfill({status:409,json:{error:'Content changed during confirmation'}})}
    if(kind==='delete')snapshot.posts=snapshot.posts.filter((p:any)=>p.id!==identifier);else post.status='draft';
    return route.fulfill({json:{ok:true}});
  });
  await page.reload();
  await page.getByRole('button',{name:/^Gönderiler/}).click();
  await page.getByRole('tab',{name:'Tümü',exact:true}).click();
  const row=page.locator('article').filter({hasText:`Original ${kind} confirmation`});
  await row.getByRole('button',{name:label,exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await modal.getByRole('button',{name:label,exact:true}).click();
  await expect(modal.getByRole('alert')).toContainText('Pencereyi kapatıp güncel liste üzerinden yeniden aç.');
  await expect(modal.getByRole('button',{name:label,exact:true})).toBeDisabled();
  await modal.getByRole('button',{name:label,exact:true}).evaluate(button=>(button as HTMLButtonElement).click());
  expect(requests).toBe(1);
  await modal.getByRole('button',{name:'İptal et',exact:true}).click();
  const updated=page.locator('article').filter({hasText:`Updated ${kind} confirmation`});
  await updated.getByRole('button',{name:label,exact:true}).click();
  await expect(modal).toContainText(`Updated ${kind} confirmation`);
  await modal.getByRole('button',{name:label,exact:true}).click();
  await expect(modal).toBeHidden();expect(requests).toBe(2);
});

test('independent post approvals can overlap but navigation stays locked until both finish',async({page})=>{
  await page.goto('/');
  const ids=[];
  for(const name of ['A','B']){
    const created=await page.request.post('/api/posts',{data:{requestId:crypto.randomUUID(),text:`Overlapping approval ${name}`,platforms:['x']}});
    ids.push((await created.json()).id);
  }
  const snapshot=await (await page.request.get('/api/state')).json();
  const posts=ids.map(id=>snapshot.posts.find((p:any)=>p.id===id));
  posts.forEach(post=>{post.status='pending_approval'});
  await page.route('**/api/state',route=>route.fulfill({json:snapshot}));
  const releases:Array<()=>void>=[],requests=[0,0];
  for(let index=0;index<2;index++){
    const held=new Promise<void>(resolve=>{releases[index]=resolve});
    await page.route(`**/api/posts/${ids[index]}/approve`,async route=>{requests[index]++;await held;posts[index].status='processing';return route.fulfill({json:{ok:true}})});
  }
  await page.reload();
  await page.getByRole('button',{name:/^Gönderiler/}).click();
  await page.getByRole('tab',{name:'Tümü',exact:true}).click();
  const rows=posts.map(post=>page.locator('article').filter({hasText:post.text}));
  await rows[0].getByRole('button',{name:'Onayla',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>requests[0]).toBe(1);
  const navigation=page.getByRole('button',{name:'Hesabım',exact:true});
  await expect(navigation).toBeDisabled();
  await rows[1].getByRole('button',{name:'Onayla',exact:true}).click();
  await expect.poll(()=>requests[1]).toBe(1);
  releases[0]();
  await expect(rows[0]).toHaveAttribute('aria-busy','false');
  await expect(navigation).toBeDisabled();
  releases[1]();
  await expect(navigation).toBeEnabled();expect(requests).toEqual([1,1]);
});

for(const [date,message] of [
  ['2027-03-28','Bu saat, şirketin saat dilimindeki saat değişimi nedeniyle mevcut değil. Başka bir saat seç.'],
  ['2027-10-31','Bu saat, şirketin saat dilimindeki saat değişiminde iki kez yaşanıyor. Başka bir saat seç.'],
])test(`a rejected clock-change schedule on ${date} preserves the editor for correction`,async({page})=>{
  await page.clock.setFixedTime(new Date('2027-01-01T00:00:00Z'));
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/state')).json();
  snapshot.company.timezone='Europe/Berlin';
  await page.route('**/api/state',route=>route.fulfill({json:snapshot}));
  let requests=0;
  await page.route('**/api/posts',route=>{
    requests++;
    const body=route.request().postDataJSON();
    expect(body.text).toBe('Clock change test');
    expect(body.scheduled_local).toBe(`${date}T${requests===1?'02':'03'}:30`);
    return route.fulfill(requests===1?{status:400,json:{error:message}}:{status:202,json:{id:'test-clock-change',outcome:'approved'}});
  });
  await page.reload();
  await page.locator('#content').fill('Clock change test');
  await page.getByRole('tab',{name:'İleri tarihte',exact:true}).click();
  await page.getByLabel('Paylaşım tarihi',{exact:true}).fill(date);
  await page.getByRole('combobox',{name:'Saat',exact:true}).selectOption('02');
  await page.getByRole('combobox',{name:'Dakika',exact:true}).selectOption('30');
  await page.getByRole('button',{name:'Planla',exact:true}).click();
  await expect(page.getByText(message,{exact:true})).toBeVisible();
  await expect(page.locator('#content')).toHaveValue('Clock change test');
  await expect(page.getByLabel('Paylaşım tarihi',{exact:true})).toHaveValue(date);
  await expect(page.getByRole('combobox',{name:'Saat',exact:true})).toHaveValue('02');
  await expect(page.getByRole('button',{name:'Planla',exact:true})).toBeEnabled();
  expect(requests).toBe(1);
  await page.getByRole('combobox',{name:'Saat',exact:true}).selectOption('03');
  await page.getByRole('button',{name:'Planla',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Gönderiler',exact:true})).toBeVisible();
  expect(requests).toBe(2);
});

test('company refresh preserves edits and saving one form does not discard an invitation',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/company')).json();
  let saves=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/company',async route=>{
    if(route.request().method()==='PATCH'){
      saves++;
      if(saves===1){await held;return route.fulfill({status:503,json:{error:'Company settings temporarily unavailable'}})}
      const body=route.request().postDataJSON();
      Object.assign(snapshot.company,body,{name:body.name.trim()});
      return route.fulfill({json:{ok:true}});
    }
    return route.fulfill({json:snapshot});
  });
  await page.route('**/api/company/members/*',route=>route.fulfill({json:{ok:true}}));
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  const form=page.getByRole('form',{name:'Şirket ayarları',exact:true});
  await form.getByLabel('Şirket adı',{exact:true}).fill('  My edited company  ');
  const invite=page.locator('form.member-add');
  await invite.getByPlaceholder('E-posta',{exact:true}).fill('unsaved-invite@example.com');
  await invite.getByLabel('Rol',{exact:true}).selectOption('viewer');
  const timezone=snapshot.company.timezone==='Europe/London'?'Europe/Berlin':'Europe/London';
  snapshot.company.name='Externally updated company';snapshot.company.timezone=timezone;
  await page.getByRole('combobox',{name:snapshot.members[0].email+' Rol',exact:true}).selectOption(snapshot.members[0].role==='viewer'?'editor':'viewer');
  await expect(form.getByLabel('Saat dilimi',{exact:true})).toHaveValue(timezone);
  await expect(form.getByLabel('Şirket adı',{exact:true})).toHaveValue('  My edited company  ');
  await form.getByRole('button',{name:'Kaydet',exact:true}).click();
  await expect.poll(()=>saves).toBe(1);
  await expect(page.getByRole('button',{name:'Hesabım',exact:true})).toBeDisabled();release();
  await expect(page.getByRole('alert').filter({hasText:'Company settings temporarily unavailable'})).toBeVisible();
  await expect(form.getByLabel('Şirket adı',{exact:true})).toHaveValue('  My edited company  ');
  await expect(invite.getByPlaceholder('E-posta',{exact:true})).toHaveValue('unsaved-invite@example.com');
  await form.getByRole('button',{name:'Kaydet',exact:true}).click();
  await expect(form.getByLabel('Şirket adı',{exact:true})).toHaveValue('My edited company');
  await expect(page.getByRole('button',{name:'Hesabım',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await expect(modal).toContainText('Kaydedilmemiş değişiklikler');
  await modal.getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await invite.getByPlaceholder('E-posta',{exact:true}).fill('');
  await invite.getByLabel('Rol',{exact:true}).selectOption('editor');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await expect(page.getByRole('button',{name:'Kurulumu başlat',exact:true})).toBeVisible();
  await expect(modal).toBeHidden();expect(saves).toBe(2);
});

test('cancelling a populated two-factor disable form clears only its own navigation warning',async({page})=>{
  await page.goto('/');
  const session=await (await page.request.get('/api/session')).json();
  session.user.totp_enabled=true;
  await page.route('**/api/session',route=>route.fulfill({json:session}));
  await page.reload();
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await page.getByRole('button',{name:'İki aşamalı girişi kapat',exact:true}).click();
  const form=page.getByRole('form',{name:'İki aşamalı girişi kapat',exact:true});
  await form.getByLabel('Mevcut parola',{exact:true}).fill('test-only-password');
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await expect(modal).toContainText('Kaydedilmemiş değişiklikler');
  await modal.getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await expect(form.getByLabel('Mevcut parola',{exact:true})).toHaveValue('test-only-password');
  await form.getByRole('button',{name:'Vazgeç',exact:true}).click();
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  await expect(page.getByRole('form',{name:'Şirket ayarları',exact:true})).toBeVisible();
  await expect(modal).toBeHidden();
});

test('connection settings shortcut confirms before discarding unsaved access details',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/state')).json();
  snapshot.settings.oauth_apps=[];snapshot.connections=[];
  await page.route('**/api/state',route=>route.fulfill({json:snapshot}));
  await page.reload();
  await page.getByRole('button',{name:'Bağlantılar',exact:true}).click();
  const form=page.getByRole('form',{name:'X / Twitter Bağlantı bilgileri',exact:true,includeHidden:true});
  const card=form.locator('xpath=../..');
  await card.locator('summary').click();
  await form.getByLabel('OAuth 2.0 kullanıcı erişim anahtarı',{exact:true}).fill('test-only-unsaved-token');
  await card.getByRole('button',{name:'uygulama ayarlarını',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await expect(modal).toContainText('Kaydedilmemiş değişiklikler');
  await modal.getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await expect(form.getByLabel('OAuth 2.0 kullanıcı erişim anahtarı',{exact:true})).toHaveValue('test-only-unsaved-token');
  await card.getByRole('button',{name:'Hesapla bağlan',exact:true}).click();
  await expect(modal).toContainText('Kaydedilmemiş değişiklikler');
  await modal.getByRole('button',{name:'Değişiklikleri bırak',exact:true}).click();
  await expect(page.getByRole('form',{name:'X / Twitter Uygulama ayarları',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Bağlantılar',exact:true}).click();
  await expect(modal).toBeHidden();
  await card.locator('summary').click();
  await expect(form.getByLabel('OAuth 2.0 kullanıcı erişim anahtarı',{exact:true})).toHaveValue('');
});

test('OAuth navigation stays locked until both the start request and popup are closed',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/state')).json();
  snapshot.connections=[];
  snapshot.settings.oauth_apps=[{platform:'x',client_id:'test-client',redirect_uri:'http://127.0.0.1:5173/api/oauth/x/callback',mode:'web',has_secret:true}];
  await page.route('**/api/state',route=>route.fulfill({json:snapshot}));
  let release!:()=>void,requests=0;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/oauth/start',async route=>{requests++;if(requests===1)await held;return route.fulfill({json:{url:'about:blank'}})});
  await page.reload();
  await page.getByRole('button',{name:'Bağlantılar',exact:true}).click();
  const card=page.getByRole('form',{name:'X / Twitter Bağlantı bilgileri',exact:true,includeHidden:true}).locator('xpath=../..');
  const firstPopup=page.waitForEvent('popup');
  await card.getByRole('button',{name:'Hesapla bağlan',exact:true}).click();
  const first=await firstPopup;
  await expect.poll(()=>requests).toBe(1);
  const navigation=page.getByRole('button',{name:'Hesabım',exact:true});
  await expect(navigation).toBeDisabled();
  await card.getByRole('button',{name:'Bağlantı penceresini kapat',exact:true}).click();
  await expect.poll(()=>first.isClosed()).toBe(true);
  await expect(navigation).toBeDisabled();release();
  await expect(navigation).toBeEnabled();
  const secondPopup=page.waitForEvent('popup');
  await card.getByRole('button',{name:'Hesapla bağlan',exact:true}).click();
  const second=await secondPopup;
  await expect.poll(()=>requests).toBe(2);
  await expect(card.getByRole('status')).toContainText('Hesap bağlantısı açılan pencerede bekleniyor.');
  await expect(navigation).toBeDisabled();
  await second.close();
  await expect(navigation).toBeEnabled();
  await navigation.click();
  await expect(page.getByRole('button',{name:'Kurulumu başlat',exact:true})).toBeVisible();
});

test('OAuth completion stays locked through a failed state check and retries only the read',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/state')).json();
  snapshot.connections=[];
  snapshot.settings.oauth_apps=[{platform:'x',client_id:'test-client',redirect_uri:'http://127.0.0.1:5173/api/oauth/x/callback',mode:'web',has_secret:true}];
  let checking=false,reads=0,starts=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/state',async route=>{
    if(!checking)return route.fulfill({json:snapshot});
    reads++;
    if(reads===1){await held;return route.fulfill({status:503,json:{error:'Connection state unavailable'}})}
    return route.fulfill({json:snapshot});
  });
  await page.route('**/api/oauth/start',route=>{starts++;return route.fulfill({json:{url:'about:blank'}})});
  await page.reload();await page.getByRole('button',{name:'Bağlantılar',exact:true}).click();
  const card=page.getByRole('form',{name:'X / Twitter Bağlantı bilgileri',exact:true,includeHidden:true}).locator('xpath=../..');
  const opened=page.waitForEvent('popup');
  await card.getByRole('button',{name:'Hesapla bağlan',exact:true}).click();
  const popup=await opened;await expect.poll(()=>starts).toBe(1);
  checking=true;
  await popup.evaluate(origin=>window.opener.postMessage({type:'akis-oauth',ok:true,message:'Test account connected'},origin),new URL(page.url()).origin);
  await expect.poll(()=>reads).toBe(1);await expect.poll(()=>popup.isClosed()).toBe(true);
  await expect(card.getByRole('status')).toContainText('Bağlantı durumu kontrol ediliyor…');
  await expect(card.getByRole('button',{name:'Hesapla bağlan',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Hesabım',exact:true})).toBeDisabled();
  release();
  const warning=card.getByRole('alert').filter({hasText:'Bağlantı durumu yenilenemedi.'});
  await expect(warning).toBeVisible();
  await expect(page.getByRole('button',{name:'Hesabım',exact:true})).toBeEnabled();
  await warning.getByRole('button',{name:'Tekrar dene',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect(warning).toBeHidden();await expect.poll(()=>reads).toBe(2);
  await expect(card.getByRole('button',{name:'Hesapla bağlan',exact:true})).toBeEnabled();
  expect(starts).toBe(1);
});

test('unsaved platform settings require confirmation and survive background refresh',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/state')).json();
  const app={platform:'x',client_id:'original-client',redirect_uri:'https://example.com/original',mode:'web',has_secret:true};
  snapshot.settings.oauth_apps=[app];
  await page.route('**/api/state',route=>route.fulfill({json:snapshot}));
  await page.reload();
  await page.getByRole('button',{name:'Ayarlar',exact:true}).click();
  const form=page.getByRole('form',{name:'X / Twitter Uygulama ayarları',exact:true});
  await form.getByLabel('Uygulama / Client ID',{exact:true}).fill('my-unsaved-client');
  await form.getByLabel('Uygulama gizli anahtarı',{exact:true}).fill('test-only-secret');
  app.client_id='external-client';app.redirect_uri='https://example.com/refreshed';
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(form.getByLabel('Dönüş adresi',{exact:true})).toHaveValue(app.redirect_uri);
  await expect(form.getByLabel('Uygulama / Client ID',{exact:true})).toHaveValue('my-unsaved-client');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await expect(modal).toContainText('Kaydedilmemiş değişiklikler');
  await modal.getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await expect(form.getByLabel('Uygulama gizli anahtarı',{exact:true})).toHaveValue('test-only-secret');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await modal.getByRole('button',{name:'Değişiklikleri bırak',exact:true}).click();
  await expect(page.getByRole('button',{name:'Kurulumu başlat',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Ayarlar',exact:true}).click();
  await expect(modal).toBeHidden();
  await expect(form.getByLabel('Uygulama gizli anahtarı',{exact:true})).toHaveValue('');
  await expect(form.getByLabel('Uygulama / Client ID',{exact:true})).toHaveValue('external-client');
});

test('critical navigation preserves a pending invitation and warns before discarding its link',async({page})=>{
  await page.goto('/');
  let release!:()=>void,requests=0;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/company/members',async route=>{
    requests++;await held;
    return route.fulfill({json:{email:'navigation-test@example.com',invite_path:'/join?token=navigation-test-only',expires_at:Math.floor(Date.now()/1000)+3600}});
  });
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  const form=page.locator('form.member-add');
  await form.getByPlaceholder('E-posta',{exact:true}).fill('navigation-test@example.com');
  await form.getByRole('button',{name:'Davet et',exact:true}).click();
  await expect.poll(()=>requests).toBe(1);
  await expect(page.getByRole('button',{name:'Sistem yönetimi',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Çıkış yap',exact:true})).toBeDisabled();
  release();
  await expect(page.locator('.secret-card code')).toContainText('navigation-test-only');
  const target=page.getByRole('button',{name:'Sistem yönetimi',exact:true});
  await expect(target).toBeEnabled();
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})).toBe(true);
  await target.click();
  const modal=page.getByRole('alertdialog');
  await expect(modal).toContainText('Tek seferlik bilgiler açık');
  await modal.getByRole('button',{name:'Bu ekranda kal',exact:true}).click();
  await expect(page.locator('.secret-card code')).toContainText('navigation-test-only');
  await target.click();
  await modal.getByRole('button',{name:'Bilgileri kapat ve devam et',exact:true}).click();
  await expect(page.getByRole('form',{name:'Şirket oluştur',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.secret-card')).toHaveCount(0);
});

test('cancelling two-factor setup clears the sensitive navigation warning',async({page})=>{
  const secret='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  await page.route('**/api/me/2fa/setup',route=>route.fulfill({json:{secret,uri:`otpauth://totp/Akis:test@example.com?secret=${secret}&issuer=Akis&digits=6&period=30`}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await page.getByRole('button',{name:'Kurulumu başlat',exact:true}).click();
  const form=page.getByRole('form',{name:'Doğrula ve aç',exact:true});
  await expect(form).toBeVisible();
  await page.getByRole('button',{name:'Sistem yönetimi',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await expect(modal).toContainText('Tek seferlik bilgiler açık');
  await modal.getByRole('button',{name:'Bu ekranda kal',exact:true}).click();
  await expect(page.locator('.totp-secret')).toBeVisible();
  await form.getByRole('button',{name:'Vazgeç',exact:true}).click();
  await page.getByRole('button',{name:'Sistem yönetimi',exact:true}).click();
  await expect(page.getByRole('form',{name:'Şirket oluştur',exact:true})).toBeVisible();
  await expect(modal).toBeHidden();
});

test('system administration preserves failed forms and never starts backups automatically',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/system/overview')).json();
  delete snapshot.backup_policy;
  const company={...snapshot.companies[0],id:'test-system-company',name:'Test system company',disabled:false};
  snapshot.companies=[company];
  let creates=0,toggles=0,backups=0,failRefresh=false;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/system/overview',route=>failRefresh?route.fulfill({status:503,json:{error:'Overview temporarily unavailable'}}):route.fulfill({json:snapshot}));
  await page.route('**/api/system/backup',route=>{backups++;return route.fulfill({json:{verified:true,file:'test-only.backup'}})});
  await page.route('**/api/system/companies',async route=>{
    creates++;expect(route.request().postDataJSON()).toMatchObject({name:'New test company',admin_email:'system-test@example.com'});
    if(creates===1){await held;return route.fulfill({status:503,json:{error:'Company temporarily unavailable'}})}
    failRefresh=true;return route.fulfill({json:{id:'test-new-company',admin_email:'system-test@example.com',temporary_password:'test-only-password'}});
  });
  await page.route('**/api/system/companies/test-system-company',route=>{toggles++;company.disabled=true;return route.fulfill({json:{ok:true}})});
  await page.getByRole('button',{name:'Sistem yönetimi',exact:true}).click();
  await expect(page.getByText('Yedekleme politikası alınamadı. Otomatik yedekleme durumu bilinmiyor.',{exact:false})).toBeVisible();
  const form=page.getByRole('form',{name:'Şirket oluştur',exact:true});
  await form.getByPlaceholder('Şirket adı',{exact:true}).fill('New test company');
  await form.getByPlaceholder('Şirket yöneticisinin e-postası',{exact:true}).fill('system-test@example.com');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>creates).toBe(1);
  await expect(page.getByRole('button',{name:'Şimdi yedek al ve doğrula',exact:true})).toBeDisabled();release();
  await expect(form.getByPlaceholder('Şirket adı',{exact:true})).toBeEnabled();
  await expect(form.getByPlaceholder('Şirket adı',{exact:true})).toHaveValue('New test company');
  await form.getByRole('button',{name:'Şirket oluştur',exact:true}).click();
  await expect(page.locator('.secret-card code')).toHaveText('test-only-password');
  await expect(form.getByPlaceholder('Şirket adı',{exact:true})).toHaveValue('');
  await expect(page.getByRole('alert').filter({hasText:'Overview temporarily unavailable'})).toBeVisible();
  await expect(page.getByText('İşlem tamamlandı ancak sistem durumu yenilenemedi. Listeyi tekrar yenile.',{exact:true})).toBeVisible();
  failRefresh=false;await page.getByRole('button',{name:'Tekrar dene',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:'Test system company'});
  await row.getByRole('button',{name:'Askıya al',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await modal.getByRole('button',{name:'Vazgeç',exact:true}).click();expect(toggles).toBe(0);
  await row.getByRole('button',{name:'Askıya al',exact:true}).click();
  await modal.getByRole('button',{name:'Onayla',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect(modal).toBeHidden();await expect(row.getByRole('button',{name:'Yeniden aç',exact:true})).toBeVisible();
  expect(creates).toBe(2);expect(toggles).toBe(1);expect(backups).toBe(0);
});

test('failed sign-out preserves the draft and only an explicit retry sends another request',async({page})=>{
  let requests=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/logout',async route=>{
    requests++;
    if(requests===1){await held;return route.fulfill({status:503,json:{error:'Sign-out unavailable'}})}
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/');await page.locator('#content').fill('Keep this draft if sign-out fails');
  const exit=page.getByRole('button',{name:'Çıkış yap',exact:true});
  await exit.click();
  await page.getByRole('button',{name:'Değişiklikleri bırak',exact:true}).click();
  await expect.poll(()=>requests).toBe(1);await expect(exit).toBeDisabled();
  await expect(page.locator('#content').locator('xpath=ancestor::div[@inert]')).toHaveCount(1);
  release();
  await expect(page.getByText('Çıkış doğrulanamadı. Sunucudaki oturumun açık kalmış olabilir. Bağlantını kontrol edip çıkışı tekrar dene.',{exact:true})).toBeVisible();
  await expect(exit).toBeEnabled();await expect(page.locator('#content')).toHaveValue('Keep this draft if sign-out fails');
  expect(requests).toBe(1);
  await exit.click();await page.getByRole('button',{name:'Değişiklikleri bırak',exact:true}).click();
  await expect(page.getByRole('form',{name:'Şirket hesabına giriş',exact:true})).toBeVisible();
  expect(requests).toBe(2);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('akis-draft:')))).toEqual([]);
});

test('a delayed workspace poll cannot change the screen after sign-out',async({page})=>{
  await page.goto('/');await expect(page.locator('#content')).toBeVisible();
  let started=false,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/state',async route=>{started=true;await held;return route.fulfill({status:503,json:{error:'Old workspace failure'}})});
  await page.route('**/api/logout',route=>route.fulfill({json:{ok:true}}));
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect.poll(()=>started).toBe(true);
  await page.getByRole('button',{name:'Çıkış yap',exact:true}).click();
  await expect(page.getByRole('form',{name:'Şirket hesabına giriş',exact:true})).toBeVisible();
  release();
  await expect(page.getByRole('form',{name:'Şirket hesabına giriş',exact:true})).toBeVisible();
  await expect(page.getByText('Old workspace failure',{exact:true})).toHaveCount(0);
});

test('startup session failure offers a single-flight read-only retry',async({page})=>{
  let checks=0,logins=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/login',route=>{logins++;return route.fulfill({json:{ok:true}})});
  await page.route('**/api/session',async route=>{
    checks++;
    if(checks===1)return route.fulfill({status:503,json:{error:'Session temporarily unavailable'}});
    await held;return route.fulfill({json:{authenticated:false,user:null}});
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Session temporarily unavailable');
  await expect(page.getByLabel('Parola',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Oturumu yeniden kontrol et',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>checks).toBe(2);
  await expect(page.getByRole('heading',{name:'Stüdyon açılıyor…',exact:true})).toBeVisible();
  release();await expect(page.getByLabel('Parola',{exact:true})).toBeVisible();
  expect(checks).toBe(2);expect(logins).toBe(0);
});

test('a successful login is not resubmitted when the following session check fails',async({page})=>{
  await page.goto('/');
  const session=await (await page.request.get('/api/session')).json();
  let checks=0,logins=0;
  await page.route('**/api/session',route=>{
    checks++;
    if(checks===1)return route.fulfill({json:{authenticated:false,user:null}});
    if(checks===2)return route.fulfill({status:503,json:{error:'Session check interrupted'}});
    return route.fulfill({json:session});
  });
  await page.route('**/api/login',route=>{logins++;return route.fulfill({json:{ok:true}})});
  await page.reload();
  await page.getByLabel('E-posta',{exact:true}).fill('login-test@example.com');
  await page.getByLabel('Parola',{exact:true}).fill('test-only-password');
  await page.getByRole('button',{name:'Giriş yap',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Session check interrupted');
  await expect(page.getByLabel('Parola',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Oturumu yeniden kontrol et',exact:true}).click();
  await expect(page.locator('#content')).toBeVisible();
  expect(logins).toBe(1);expect(checks).toBe(3);
});

test('login preserves credentials after failure and locks the two-factor step',async({page})=>{
  await page.goto('/');
  const session=await (await page.request.get('/api/session')).json();
  let authenticated=false,requests=0;
  let release!:()=>void,releaseCode!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve}),codeHeld=new Promise<void>(resolve=>{releaseCode=resolve});
  await page.route('**/api/session',route=>route.fulfill({json:authenticated?session:{...session,authenticated:false,user:null}}));
  await page.route('**/api/login',async route=>{
    requests++;
    expect(route.request().postDataJSON()).toMatchObject({email:'login-test@example.com',password:'test-only-password'});
    if(requests===1){await held;return route.fulfill({status:503,json:{error:'Login temporarily unavailable'}})}
    if(requests===2)return route.fulfill({status:401,json:{error:'Code required',needs_code:true}});
    expect(route.request().postDataJSON().code).toBe('012345');
    if(requests===3){await codeHeld;return route.fulfill({status:401,json:{error:'Code temporarily rejected',needs_code:true}})}
    authenticated=true;return route.fulfill({json:{ok:true}});
  });
  await page.reload();
  const form=page.getByRole('form',{name:'Şirket hesabına giriş',exact:true});
  await form.getByLabel('E-posta',{exact:true}).fill('login-test@example.com');
  await form.getByLabel('Parola',{exact:true}).fill('test-only-password');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>requests).toBe(1);
  await expect(form.getByLabel('E-posta',{exact:true})).toBeDisabled();release();
  await expect(page.getByRole('alert')).toContainText('Login temporarily unavailable');
  await expect(form.getByLabel('Parola',{exact:true})).toHaveValue('test-only-password');
  await form.getByRole('button',{name:'Giriş yap',exact:true}).click();
  await form.getByLabel('Doğrulama kodu',{exact:true}).fill('012-345');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>requests).toBe(3);
  await expect(form.getByRole('button',{name:'Geri dön',exact:true})).toBeDisabled();releaseCode();
  await expect(page.getByRole('alert')).toContainText('Code temporarily rejected');
  await expect(form.getByLabel('Doğrulama kodu',{exact:true})).toHaveValue('012-345');
  await form.getByRole('button',{name:'Doğrula ve gir',exact:true}).click();
  await expect(page.locator('#content')).toBeVisible();expect(requests).toBe(4);
});

test('malformed invitation details can be retried without overlapping checks',async({page})=>{
  const token='c'.repeat(32);let reads=0,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/invites/'+token,async route=>{
    reads++;if(reads===1)return route.fulfill({json:null});
    await held;return route.fulfill({json:{company:'Test company',email:'test@example.com',role:'editor',expires_at:Math.floor(Date.now()/1000)+3600}});
  });
  await page.goto('/#davet='+token);
  await expect(page.getByRole('alert')).toContainText('Davet bilgileri alınamadı.');
  await expect(page.getByRole('form',{name:'Daveti kabul et',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Tekrar dene',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>reads).toBe(2);release();
  await expect(page.getByRole('form',{name:'Daveti kabul et',exact:true})).toBeVisible();expect(reads).toBe(2);
});

test('an unavailable invitation offers a new-link explanation rather than another lookup',async({page})=>{
  const token='d'.repeat(32);let reads=0;
  await page.route('**/api/invites/'+token,route=>{reads++;return route.fulfill({status:404,json:{error:'Invitation unavailable'}})});
  await page.goto('/#davet='+token);
  await expect(page.getByText('Bu davet artık kullanılamıyor. Şirket yöneticinden yeni bir davet bağlantısı iste.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Tekrar dene',exact:true})).toHaveCount(0);
  await expect(page.getByRole('form',{name:'Daveti kabul et',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Davet olmadan devam et',exact:true})).toBeEnabled();expect(reads).toBe(1);
});

test('an invitation revoked while filling the form cannot be submitted again',async({page})=>{
  const token='e'.repeat(32);let accepts=0;
  await page.route('**/api/invites/'+token,route=>route.fulfill({json:{company:'Test company',email:'test@example.com',role:'editor',expires_at:Math.floor(Date.now()/1000)+3600}}));
  await page.route('**/api/invites/'+token+'/accept',route=>{accepts++;return route.fulfill({status:404,json:{error:'Invitation revoked'}})});
  await page.goto('/#davet='+token);
  const form=page.getByRole('form',{name:'Daveti kabul et',exact:true});
  await form.getByLabel('Akış parolan',{exact:true}).fill('test-only-password');
  await form.getByRole('button',{name:'Daveti kabul et',exact:true}).click();
  await expect(form).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('Invitation revoked');
  await expect(page.getByRole('button',{name:'Tekrar dene',exact:true})).toHaveCount(0);expect(accepts).toBe(1);
});

test('a late invitation response cannot replace a new link and acceptance is single-flight',async({page})=>{
  const old='a'.repeat(32),fresh='b'.repeat(32);
  let releaseOld!:()=>void,releaseAccept!:()=>void;
  const oldHeld=new Promise<void>(resolve=>{releaseOld=resolve}),acceptHeld=new Promise<void>(resolve=>{releaseAccept=resolve});
  let lookups=0,accepts=0;
  const expires=Math.floor(Date.now()/1000)+3600;
  await page.route('**/api/invites/'+old,async route=>{lookups++;await oldHeld;return route.fulfill({json:{company:'Old company',role:'editor',email:'old@example.com',expires_at:expires}})});
  await page.route('**/api/invites/'+fresh,route=>route.fulfill({json:{company:'New company',role:'editor',email:'fresh@example.com',expires_at:expires}}));
  await page.goto('/#davet='+old);
  const snapshot=await (await page.request.get('/api/state')).json();
  await expect.poll(()=>lookups).toBe(1);
  await page.evaluate(value=>{location.hash='#davet='+value},fresh);
  const form=page.getByRole('form',{name:'Daveti kabul et',exact:true});
  await expect(form.getByLabel('E-posta',{exact:true})).toHaveValue('fresh@example.com');
  releaseOld();
  await form.getByRole('button',{name:'Yeni hesap',exact:true}).click();
  await form.getByLabel('Ad Soyad · isteğe bağlı',{exact:true}).fill('Invite Test');
  await form.getByLabel('Yeni parola · en az 10 karakter',{exact:true}).fill('test-only-password');
  await form.getByLabel('Yeni parola tekrar',{exact:true}).fill('test-only-password');
  await page.route('**/api/invites/'+fresh+'/accept',async route=>{
    accepts++;expect(route.request().postDataJSON()).toMatchObject({password:'test-only-password',name:'Invite Test'});
    if(accepts===1){await acceptHeld;return route.fulfill({status:503,json:{error:'Invitation temporarily unavailable'}})}
    return route.fulfill({json:{company_id:snapshot.company.id}});
  });
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>accepts).toBe(1);
  await expect(form.getByRole('button',{name:'Hesabım var',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Davet olmadan devam et',exact:true})).toBeDisabled();releaseAccept();
  await expect(page.getByRole('alert')).toContainText('Invitation temporarily unavailable');
  await expect(form.getByLabel('E-posta',{exact:true})).toHaveValue('fresh@example.com');
  await expect(form.getByLabel('Yeni parola tekrar',{exact:true})).toHaveValue('test-only-password');
  await form.getByRole('button',{name:'Daveti kabul et',exact:true}).click();
  await expect(page.locator('#content')).toBeVisible();expect(accepts).toBe(2);
});

test('a committed password change warns if session refresh fails without resending the password',async({page})=>{
  await page.goto('/');await expect(page.locator('#content')).toBeVisible();
  let passwords=0,checks=0;
  await page.route('**/api/session',route=>{checks++;return route.fulfill({status:503,json:{error:'Session temporarily unavailable'}})});
  await page.route('**/api/me/password',route=>{passwords++;return route.fulfill({json:{ok:true}})});
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  const form=page.getByRole('form',{name:'Parolayı değiştir',exact:true});
  await form.getByLabel('Mevcut parola',{exact:true}).fill('test-current-password');
  await form.getByLabel('Yeni parola · en az 10 karakter',{exact:true}).fill('test-new-password');
  await form.getByLabel('Yeni parola tekrar',{exact:true}).fill('test-new-password');
  await form.getByRole('button',{name:'Parolayı değiştir',exact:true}).click();
  await expect(page.getByText('Parolan değiştirildi.',{exact:true})).toBeVisible();
  await expect(page.getByText('İşlem tamamlandı ancak hesap durumu yenilenemedi. Sayfayı tekrar yenile.',{exact:true})).toBeVisible();
  await expect(form.getByLabel('Mevcut parola',{exact:true})).toHaveValue('');
  await expect(form.getByLabel('Yeni parola tekrar',{exact:true})).toHaveValue('');
  await expect(form.getByRole('button',{name:'Parolayı değiştir',exact:true})).toBeEnabled();
  await expect(form.getByRole('alert')).toHaveCount(0);
  expect(passwords).toBe(1);expect(checks).toBe(1);
});

test('account password changes preserve failed fields and session revocation requires confirmation',async({page})=>{
  let passwords=0,revocations=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/me/password',async route=>{
    passwords++;
    if(passwords===1){await held;return route.fulfill({status:503,json:{error:'Password temporarily unavailable'}})}
    return route.fulfill({json:{ok:true}});
  });
  await page.route('**/api/me/sessions/revoke',route=>{revocations++;return route.fulfill({json:{ok:true}})});
  await page.goto('/');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  const form=page.getByRole('form',{name:'Parolayı değiştir',exact:true});
  await form.getByLabel('Mevcut parola',{exact:true}).fill('test-current-password');
  await form.getByLabel('Yeni parola · en az 10 karakter',{exact:true}).fill('test-new-password');
  await form.getByLabel('Yeni parola tekrar',{exact:true}).fill('test-new-password');
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toContainText('Kaydedilmemiş değişiklikler');
  await page.getByRole('alertdialog').getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await expect(form.getByLabel('Yeni parola tekrar',{exact:true})).toHaveValue('test-new-password');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>passwords).toBe(1);
  await expect(form.getByLabel('Mevcut parola',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Kurulumu başlat',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Diğer cihazlardan çıkış yap',exact:true})).toBeDisabled();
  release();
  await expect(form.getByRole('alert')).toContainText('Password temporarily unavailable');
  await expect(form.getByLabel('Yeni parola tekrar',{exact:true})).toHaveValue('test-new-password');
  await form.getByRole('button',{name:'Parolayı değiştir',exact:true}).click();
  await expect(form.getByLabel('Mevcut parola',{exact:true})).toHaveValue('');
  await expect(form.getByLabel('Yeni parola tekrar',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Şirket yönetimi',exact:true}).click();
  await expect(page.getByRole('form',{name:'Şirket ayarları',exact:true})).toBeVisible();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await page.getByRole('button',{name:'Diğer cihazlardan çıkış yap',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await modal.getByRole('button',{name:'Vazgeç',exact:true}).click();expect(revocations).toBe(0);
  await page.getByRole('button',{name:'Diğer cihazlardan çıkış yap',exact:true}).click();
  await modal.getByRole('button',{name:'Onayla',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect(modal).toBeHidden();expect(revocations).toBe(1);expect(passwords).toBe(2);
});

test('two-factor setup cannot rotate twice and a failed enable preserves the setup',async({page})=>{
  const secret='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  let setups=0,enables=0;
  let releaseSetup!:()=>void,releaseEnable!:()=>void;
  const setupHeld=new Promise<void>(resolve=>{releaseSetup=resolve}),enableHeld=new Promise<void>(resolve=>{releaseEnable=resolve});
  await page.route('**/api/me/2fa/setup',async route=>{setups++;await setupHeld;return route.fulfill({json:{secret,uri:`otpauth://totp/Akis:test@example.com?secret=${secret}&issuer=Akis&digits=6&period=30`}})});
  await page.route('**/api/me/2fa/enable',async route=>{
    enables++;expect(route.request().postDataJSON()).toEqual({code:'123456'});
    if(enables===1){await enableHeld;return route.fulfill({status:503,json:{error:'Verification temporarily unavailable'}})}
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await page.getByRole('button',{name:'Kurulumu başlat',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>setups).toBe(1);releaseSetup();
  const form=page.getByRole('form',{name:'Doğrula ve aç',exact:true});
  await form.getByLabel('6 haneli kod',{exact:true}).fill('12345');
  await form.evaluate(node=>node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await expect(page.getByRole('alert').filter({hasText:'Doğrulama uygulamasındaki 6 haneli kodu gir.'})).toBeVisible();expect(enables).toBe(0);
  await form.getByLabel('6 haneli kod',{exact:true}).fill('123-456');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>enables).toBe(1);
  await expect(form.getByRole('button',{name:'Vazgeç',exact:true})).toBeDisabled();releaseEnable();
  await expect(form.getByLabel('6 haneli kod',{exact:true})).toBeEnabled();
  await expect(form.getByLabel('6 haneli kod',{exact:true})).toHaveValue('123-456');
  await expect(page.locator('.totp-secret')).toBeVisible();
  await form.getByRole('button',{name:'Doğrula ve aç',exact:true}).click();
  await expect(page.getByRole('button',{name:'İki aşamalı girişi kapat',exact:true})).toBeVisible();
  await expect(page.locator('.totp-secret')).toHaveCount(0);expect(setups).toBe(1);expect(enables).toBe(2);
});

test('connection edits survive background updates and conflicting actions are locked',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/state')).json();
  const connection={id:'test-connection',platform:'x',label:'Original label',account:'123',expires_at:1925035200,refresh_expires_at:null,token_kind:'manual',days_left:30,can_refresh:true,has_refresh:true};
  snapshot.connections=[connection];
  await page.route('**/api/state',route=>route.fulfill({json:snapshot}));
  let requests=0,deletes=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/connections',async route=>{
    if(route.request().method()==='DELETE'){deletes++;snapshot.connections=[];return route.fulfill({json:{ok:true}})}
    requests++;
    expect(route.request().postDataJSON()).toMatchObject({platform:'x',label:'Unsaved label',token:'test-only-token',refresh_token:'test-only-refresh'});
    if(requests===1){await held;return route.fulfill({status:503,json:{error:'Connection temporarily unavailable'}})}
    connection.label='Unsaved label';return route.fulfill({json:{ok:true}});
  });
  await page.reload();
  await page.getByRole('button',{name:'Bağlantılar',exact:true}).click();
  const form=page.getByRole('form',{name:'X / Twitter Bağlantı bilgileri',exact:true,includeHidden:true});
  const card=form.locator('xpath=../..');
  await card.locator('summary').click();
  await form.getByLabel('Hesap etiketi',{exact:true}).fill('Unsaved label');
  await form.getByLabel('OAuth 2.0 kullanıcı erişim anahtarı',{exact:true}).fill('test-only-token');
  await form.getByLabel('Yenileme anahtarı',{exact:true}).fill('test-only-refresh');
  const oldExpiry=await form.getByLabel('Erişim anahtarı bitiş tarihi',{exact:true}).inputValue();
  connection.expires_at+=86400;connection.label='Externally updated label';
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(form.getByLabel('Erişim anahtarı bitiş tarihi',{exact:true})).not.toHaveValue(oldExpiry);
  await expect(form.getByLabel('Hesap etiketi',{exact:true})).toHaveValue('Unsaved label');
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
  await expect.poll(()=>requests).toBe(1);
  await expect(form.getByRole('button',{name:'Bağlantıyı kaldır',exact:true})).toBeDisabled();
  await expect(card.getByRole('button',{name:'Yenile',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Hesabım',exact:true})).toBeDisabled();
  await expect(form.getByLabel('OAuth 2.0 kullanıcı erişim anahtarı',{exact:true})).toBeDisabled();
  release();
  await expect(form.getByLabel('OAuth 2.0 kullanıcı erişim anahtarı',{exact:true})).toBeEnabled();
  await expect(form.getByLabel('OAuth 2.0 kullanıcı erişim anahtarı',{exact:true})).toHaveValue('test-only-token');
  await expect(form.getByLabel('Yenileme anahtarı',{exact:true})).toHaveValue('test-only-refresh');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toContainText('Kaydedilmemiş değişiklikler');
  await page.getByRole('alertdialog').getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await form.getByRole('button',{name:'Bilgileri kaydet',exact:true}).click();
  await expect(form.getByLabel('OAuth 2.0 kullanıcı erişim anahtarı',{exact:true})).toHaveValue('');
  await expect(form.getByLabel('Yenileme anahtarı',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.getByRole('button',{name:'Bağlantılar',exact:true}).click();
  await card.locator('summary').click();
  await form.getByRole('button',{name:'Bağlantıyı kaldır',exact:true}).click();
  const modal=page.getByRole('alertdialog');
  await modal.getByRole('button',{name:'Vazgeç',exact:true}).click();
  expect(deletes).toBe(0);
  await form.getByRole('button',{name:'Bağlantıyı kaldır',exact:true}).click();
  await modal.getByRole('button',{name:'Bağlantıyı kaldır',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect(modal).toBeHidden();expect(deletes).toBe(1);expect(requests).toBe(2);
});

test('settings save waits for a fresh read behind a background poll and warns without resending secrets',async({page})=>{
  await page.goto('/');await expect(page.locator('#content')).toBeVisible();
  const snapshot=await (await page.request.get('/api/state')).json();
  let reads=0,writes=0,releasePoll!:()=>void,releaseFresh!:()=>void;
  const poll=new Promise<void>(resolve=>{releasePoll=resolve}),fresh=new Promise<void>(resolve=>{releaseFresh=resolve});
  await page.route('**/api/state',async route=>{
    reads++;
    if(reads===1){await poll;return route.fulfill({json:snapshot})}
    await fresh;return route.fulfill({status:503,json:{error:'Fresh state unavailable'}});
  });
  await page.route('**/api/settings/oauth',route=>{writes++;return route.fulfill({json:{ok:true}})});
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect.poll(()=>reads).toBe(1);
  await page.getByRole('button',{name:'Ayarlar',exact:true}).click();
  const form=page.getByRole('form',{name:'X / Twitter Uygulama ayarları',exact:true});
  await form.getByLabel('Uygulama / Client ID',{exact:true}).fill('test-client');
  await form.getByLabel('Uygulama gizli anahtarı',{exact:true}).fill('test-only-secret');
  await form.getByLabel('Dönüş adresi',{exact:true}).fill('https://example.com/api/oauth/x/callback');
  await form.getByRole('button',{name:'Ayarları kaydet',exact:true}).click();
  await expect.poll(()=>writes).toBe(1);
  await expect(form.getByLabel('Uygulama gizli anahtarı',{exact:true})).toHaveValue('');
  await expect(form.getByLabel('Uygulama / Client ID',{exact:true})).toBeDisabled();
  releasePoll();await expect.poll(()=>reads).toBe(2);
  await expect(form.getByLabel('Uygulama / Client ID',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Hesabım',exact:true})).toBeDisabled();
  releaseFresh();
  await expect(page.getByText('Ayarlar kaydedildi ancak güncel durum alınamadı. Listeyi yenileyebilirsin.',{exact:true})).toBeVisible();
  await expect(form.getByLabel('Uygulama / Client ID',{exact:true})).toBeEnabled();
  await expect(form.getByRole('alert')).toHaveCount(0);
  expect(writes).toBe(1);expect(reads).toBe(2);
});

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
  await expect(page.getByRole('button',{name:'Hesabım',exact:true})).toBeDisabled();
  await expect(page.getByRole('form',{name:'Instagram Uygulama ayarları',exact:true}).getByRole('button',{name:'Ayarları kaydet',exact:true})).toBeEnabled();
  release();
  await expect(form.getByRole('alert')).toContainText('Settings temporarily unavailable');
  await expect(form.getByLabel('Uygulama gizli anahtarı',{exact:true})).toHaveValue('test-only-secret');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toContainText('Kaydedilmemiş değişiklikler');
  await page.getByRole('alertdialog').getByRole('button',{name:'Düzenlemeye devam et',exact:true}).click();
  await form.getByRole('button',{name:'Ayarları kaydet',exact:true}).click();
  await expect(form.getByLabel('Uygulama gizli anahtarı',{exact:true})).toHaveValue('');
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(form.locator('..')).toContainText('Tanımlı');
  await page.getByRole('button',{name:'Hesabım',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByRole('button',{name:'Kurulumu başlat',exact:true})).toBeVisible();
  expect(requests).toBe(2);
});

test('team invitation locks repeated submits and preserves fields after failure',async({page})=>{
  await page.goto('/');
  const snapshot=await (await page.request.get('/api/company')).json();
  let requests=0,companyReads=0,recovered=false,releaseRetry!:()=>void;
  const retryHeld=new Promise<void>(resolve=>{releaseRetry=resolve});
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/company',async route=>{companyReads++;if(recovered)await retryHeld;return requests<2||recovered?route.fulfill({json:snapshot}):route.fulfill({status:503,json:{error:'Company refresh unavailable'}})});
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
  const warning=page.getByRole('alert').filter({hasText:'İşlem tamamlandı ancak ekip bilgileri yenilenemedi.'});
  await expect(warning).toBeVisible();
  const beforeRetry=companyReads;recovered=true;
  await warning.getByRole('button',{name:'Bilgileri yenile',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>companyReads).toBe(beforeRetry+1);
  await expect(form.getByRole('button',{name:'Davet et',exact:true})).toBeDisabled();
  await expect(page.locator('.secret-card code')).toContainText('/join?token=test-only');
  releaseRetry();await expect(warning).toBeHidden();
  await expect(form.getByRole('button',{name:'Davet et',exact:true})).toBeEnabled();
  await expect(page.locator('.secret-card code')).toContainText('/join?token=test-only');
  expect(companyReads).toBe(beforeRetry+1);
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
