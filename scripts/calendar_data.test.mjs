import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDraftTime,calendarPostTime} from '../app/studio/calendarData.ts';

test('future days and early today use the default company-local morning time',()=>{
  assert.equal(calendarDraftTime('2026-10-21','2026-10-20T18:42'),'2026-10-21T10:00');
  assert.equal(calendarDraftTime('2026-10-20','2026-10-20T09:59'),'2026-10-20T10:00');
});
test('today never starts with a default time already in the past',()=>{
  assert.equal(calendarDraftTime('2026-10-20','2026-10-20T10:00'),'2026-10-20T11:00');
  assert.equal(calendarDraftTime('2026-10-20','2026-10-20T18:42'),'2026-10-20T19:00');
});
test('late company-local hours roll across month, year and leap-day boundaries',()=>{
  for(const [day,next] of [['2026-10-31','2026-11-01'],['2026-12-31','2027-01-01'],['2028-02-28','2028-02-29']])assert.equal(calendarDraftTime(day,day+'T23:59'),next+'T00:00');
});
test('planned time takes precedence, otherwise use the earliest actual delivery',()=>{
  assert.equal(calendarPostTime({scheduled_at:200,deliveries:[{sent_at:100}]}),200);
  assert.equal(calendarPostTime({deliveries:[{sent_at:300},{sent_at:null},{sent_at:100}]}),100);
});
test('missing, nonfinite or invalid dates never create calendar entries',()=>{
  assert.equal(calendarPostTime({}),null);
  assert.equal(calendarPostTime({scheduled_at:NaN,deliveries:[{sent_at:Infinity},{sent_at:0},{sent_at:-1}]}),null);
  assert.equal(calendarPostTime({scheduled_at:Infinity,deliveries:[{sent_at:100}]}),100);
});
