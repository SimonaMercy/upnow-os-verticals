/**
 * "Inspection Team" on the v2 inspection report.
 *
 *  • A report still being filled (no rpSubmittedAt) defaults "Inspected By" to
 *    whoever OPENS it — the acting manager when a manager, the landlord when the
 *    RP owner — so the card is never blank.
 *  • A SUBMITTED report is a record of an inspection that already happened: the
 *    stored inspector always wins, and a viewer's name is never written onto it.
 *
 * Contract 394: move_in is submitted (stored inspector), move_out is unsaved.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, APIRequestContext } from '@playwright/test';

const MANAGER  = 'sheco1300@yahoo.com';        // Sherif Mohamed Atef, manager for RP 2
const LANDLORD = 'kbaalfalasi@gmail.com';      // Ahmad Rashed Buti Alfalasi, owns RP 2

async function payloadAs(request: APIRequestContext, email: string, type: 'move_in' | 'move_out') {
  const start = await request.post('http://localhost:3000/api/auth/login', { data: { email } });
  const { devOtp } = await start.json() as { devOtp?: string };
  const v = await request.post('http://localhost:3000/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok(), `signed in ${email}`).toBeTruthy();
  const r = await request.get(`http://localhost:3000/api/contracts/394/inspection/v2?type=${type}`);
  expect(r.ok()).toBeTruthy();
  return await r.json();
}

test('unsubmitted report: the manager opening it is the inspector', async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  const j = await payloadAs(ctx, MANAGER, 'move_out');
  console.log('MANAGER  move_out :', j.inspectorName, '|', j.inspectorRole, '|', j.inspectorCompany);
  expect(j.rpSubmittedAt ?? null).toBeNull();
  expect(j.inspectorName).toBe('Sherif Mohamed Atef');            // the manager, NOT the landlord
  expect(j.inspectorRole).toBe('Property Manager');
  expect(j.inspectorCompany).toBe('Ahmad Rashed Buti Alfalasi');  // inspects on the landlord's behalf
  await ctx.dispose();
});

test('unsubmitted report: the landlord opening it is the inspector', async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  const j = await payloadAs(ctx, LANDLORD, 'move_out');
  console.log('LANDLORD move_out :', j.inspectorName, '|', j.inspectorRole, '|', j.inspectorCompany);
  expect(j.inspectorName).toBe('Ahmad Rashed Buti Alfalasi');
  expect(j.inspectorRole).toBe('Property Representative');
  await ctx.dispose();
});

test('submitted report keeps its stored inspector for every viewer', async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  const asMgr  = await payloadAs(ctx, MANAGER, 'move_in');
  const asLord = await payloadAs(ctx, LANDLORD, 'move_in');
  console.log('submitted move_in :', asMgr.inspectorName, '/', asLord.inspectorName);
  expect(asMgr.rpSubmittedAt).toBeTruthy();
  // The landlord viewing a submitted report must NOT see their own name swapped in.
  expect(asLord.inspectorName).toBe(asMgr.inspectorName);
  await ctx.dispose();
});
