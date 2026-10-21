import {test as base,expect} from '@playwright/test';

// Bootstrap the disposable local account before setup requests. Browser navigation
// is still performed by each scenario, so startup/login failures can be mocked normally.
export const test=base.extend<{localSession:void}>({
  localSession:[async({page},use)=>{
    const session=await page.request.get('/api/session');
    expect(session.ok()).toBeTruthy();
    await use();
  },{auto:true}],
});
export {expect};
