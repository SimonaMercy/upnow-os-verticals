/**
 * E2E — the Operations board names the COMPANY, on lead cards as well as leases.
 *
 * A company lease is held by the entity; the person on the user record is only
 * its authorised signatory. The board already applied that rule to contract
 * cards, but a LEAD card read the signatory's name off the customer record the
 * moment the lead was converted — so API Energy's lead sat in Payment plan under
 * the name of the man who signs for it, while the same customer appeared as the
 * company one lane to the right.
 *
 * Data-led: it finds a lead whose customer is a company and checks that one. If
 * the landlord has none, there is nothing to assert and the test says so rather
 * than inventing a fixture.
 */
import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const devOtp = ((await s.json()) as { devOtp?: string }).devOtp ?? '123456';
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok(), `sign-in for ${email}`).toBeTruthy();
}

interface Lead {
  id: number; stage: string; customerName: string | null;
  convertedTenant?: {
    entityType?: string | null; companyName?: string | null;
    user?: { name?: string | null } | null;
  } | null;
}

test('a company lead is shown by its company name, not its signatory', async ({ page }) => {
  await signIn(page, 'kbaalfalasi@gmail.com');

  const leads = (await (await page.request.get('/api/leads')).json()) as Lead[] | { data?: Lead[] };
  const rows = Array.isArray(leads) ? leads : (leads.data ?? []);
  // Only the funnel stages reach the board; a converted or dead lead has left it.
  const ON_BOARD = ['interested', 'documents_collection', 'payment_plan_shared', 'cheques_submitted'];
  const company = rows.find((l) => ON_BOARD.includes(l.stage)
    && l.convertedTenant?.entityType === 'company'
    && !!l.convertedTenant?.companyName?.trim());

  test.skip(!company, 'no company lead on the board for this landlord');
  const name = company!.convertedTenant!.companyName!.trim();
  const signatory = company!.convertedTenant?.user?.name?.trim();

  await page.goto('/rental-provider/dashboard/operations');
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  // …and the signatory's own name is not standing in for the company. (Skipped
  // when the two are the same string — a company trading under its owner's name
  // would make the check meaningless rather than failing.)
  if (signatory && signatory !== name) {
    await expect(page.getByText(signatory, { exact: true })).toHaveCount(0);
  }
});
