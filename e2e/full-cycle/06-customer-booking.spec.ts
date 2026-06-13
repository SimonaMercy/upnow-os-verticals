import { test, expect, Page, Locator } from '@playwright/test';
import { q, readState, safeLoginViaUi, writeState } from './helpers';

/**
 * 06 — customer books a viewing on the published listing; RP sees and
 * advances the lead.
 *
 *   1. customer (state.customerPhone) → /listings/units/<publishedUnitId>
 *      → Schedule Viewing modal → pick date + slot → Confirm Viewing
 *      → lands on /dashboard/customer/spaces/v2/v-<leadId> ("Your viewing is
 *      confirmed.") → row shows up in /dashboard/customer/viewings
 *   2. RP → /rental-provider/dashboard/leads → lead row visible (stage chip
 *      "Viewing") → Mark Visited → Confirm Visit → viewing completed in DB
 *   3. RP express stage move (Reject Lead → chip "Rejected" → Reopen → chip
 *      "Viewing") — proves the stage chip updates live
 *   4. operator block: RP on the public listing sees the operator notice and
 *      no Book Now / Schedule Viewing CTAs
 *
 * Writes state: leadId, viewingId.
 */

// mute external embeds on the public listing page for determinism
async function muteExternals(page: Page) {
  await page.route('https://www.openstreetmap.org/**', (r) => r.abort());
  await page.route('https://images.unsplash.com/**', (r) => r.abort());
}

/** Click a day in a BookModal MiniCalendar (handles month rollover). */
async function pickCalendarDay(cal: Locator, target: Date) {
  const now = new Date();
  // header layout: [prev][month label][next]; advance if target is next month
  const monthsAhead =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  for (let i = 0; i < monthsAhead; i++) {
    await cal.locator('button').nth(1).click(); // next-month chevron
  }
  await cal.getByRole('button', { name: String(target.getDate()), exact: true }).click();
}

test.describe.serial('06 customer books viewing → RP lead pipeline', () => {
  test('customer schedules a viewing on the published listing and sees it in My Viewings', async ({
    page,
  }) => {
    const st = readState();
    await muteExternals(page);
    await safeLoginViaUi(page, st.customerPhone);

    // ── public listing detail page (logged in as customer → CTAs visible) ──
    await page.goto(`/listings/units/${st.publishedUnitId}`);
    await expect(page.getByRole('heading', { name: st.unitNames[0] })).toBeVisible({
      timeout: 60_000,
    });

    // desktop sidebar CTA (the mobile bottom-bar duplicate is CSS-hidden at lg)
    await page
      .getByRole('button', { name: 'Schedule Viewing' })
      .filter({ visible: true })
      .first()
      .click();

    // ── Book a Viewing modal ──
    const modal = page.locator('div.relative.bg-white.rounded-2xl');
    await expect(modal.getByRole('heading', { name: 'Book a Viewing' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(modal).toContainText(st.unitNames[0]);
    await expect(modal).toContainText(st.propertyName);

    // confirm is gated on a date being picked
    const confirmBtn = modal.getByRole('button', { name: 'Confirm Viewing' });
    await expect(confirmBtn).toBeDisabled();

    // pick a date one week out in the FIRST calendar (viewing date — the
    // second, compact calendar is the optional move-in date).
    // Re-run safety: each invocation books a LATER date than any prior
    // viewing on this unit, so the new scheduled viewing is always the
    // "primary" one on the My Viewings journey card (sorted scheduledAt DESC).
    const priorViewings = Number(
      q(`SELECT count(*) FROM viewings WHERE unit_id=${st.publishedUnitId}`),
    );
    const target = new Date(Date.now() + (7 + priorViewings) * 86_400_000);
    const dateCal = modal.locator('div.rounded-2xl.border').first();
    await pickCalendarDay(dateCal, target);

    // pick the 10:00 AM slot + add a note
    await modal.getByRole('button', { name: '10:00 AM', exact: true }).click();
    await modal
      .getByPlaceholder('Any questions or special requests…')
      .fill('E2E booking — please have keys ready.');

    // ── confirm → POST /leads/viewings → hard-nav to the journey page ──
    const booked = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/leads/viewings' &&
        r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    const resp = await booked;
    expect(resp.ok(), `POST /leads/viewings → ${resp.status()}`).toBe(true);

    // confirmation UI: the v2 journey page at step 1 (Booked)
    await page.waitForURL(/\/dashboard\/customer\/spaces\/v2\/v-\d+/, { timeout: 60_000 });
    const leadId = Number(page.url().match(/\/v2\/v-(\d+)/)![1]);
    await expect(page.getByText('Your viewing is confirmed.')).toBeVisible({ timeout: 60_000 });

    // ── DB: lead + viewing rows are correct ──
    expect(
      q(`SELECT stage || '|' || unit_id || '|' || converted_tenant_id FROM leads WHERE id=${leadId}`),
    ).toBe(`viewing_scheduled|${st.publishedUnitId}|${st.customerTenantId}`);
    const viewingId = Number(
      q(`SELECT id FROM viewings WHERE lead_id=${leadId} ORDER BY id DESC LIMIT 1`),
    );
    expect(viewingId).toBeGreaterThan(0);
    expect(q(`SELECT status FROM viewings WHERE id=${viewingId}`)).toBe('scheduled');
    expect(q(`SELECT notes FROM viewings WHERE id=${viewingId}`)).toContain(
      'E2E booking — please have keys ready.',
    );
    writeState({ leadId, viewingId });

    // ── My Viewings page shows the journey card ──
    const viewingsLoaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/leads/my-viewings' && r.ok(),
      { timeout: 60_000 },
    );
    await page.goto('/dashboard/customer/viewings');
    await viewingsLoaded;

    await expect(page.getByText(st.unitNames[0]).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(st.propertyName).first()).toBeVisible();
    await expect(page.getByText('Scheduled', { exact: true })).toBeVisible(); // status badge
    // 2-step journey timeline labels
    await expect(page.getByText('Booked', { exact: true })).toBeVisible();
    await expect(page.getByText('Visited', { exact: true })).toBeVisible();
    // >1h away → customer can still reschedule/cancel
    await expect(page.getByRole('button', { name: 'Reschedule' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel viewing' })).toBeVisible();
  });

  test('RP sees the new lead and marks the viewing visited', async ({ page }) => {
    const st = readState();
    await safeLoginViaUi(page, st.rpEmail, /\/rental-provider\/dashboard/);

    const leadsLoaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/leads' && r.ok(),
      { timeout: 60_000 },
    );
    await page.goto('/rental-provider/dashboard/leads');
    await leadsLoaded;

    // each lead row wrapper carries id="lead-<id>"
    const row = page.locator(`#lead-${st.leadId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(`${st.customerFirstName} ${st.customerLastName}`);
    await expect(row).toContainText(st.unitNames[0]);
    await expect(row).toContainText(st.propertyName);
    // stage chip
    await expect(row.getByText('Viewing', { exact: true })).toBeVisible();

    // ── Mark Visited → confirm panel ──
    await row.getByRole('button', { name: 'Mark Visited' }).click();
    await expect(row.getByText('Mark viewing as completed')).toBeVisible({ timeout: 15_000 });
    await row
      .getByPlaceholder('e.g. Very interested, wants to negotiate rent…')
      .fill('Attended on time, liked the unit.');

    const statusPatched = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/leads/viewings/${st.viewingId}/status`) &&
        r.request().method() === 'PATCH' &&
        r.ok(),
      { timeout: 30_000 },
    );
    await row.getByRole('button', { name: 'Confirm Visit' }).click();
    await statusPatched;

    // primary action disappears once no pending viewing remains
    await expect(row.getByRole('button', { name: 'Mark Visited' })).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(q(`SELECT status FROM viewings WHERE id=${st.viewingId}`)).toBe('completed');
    expect(q(`SELECT outcome FROM viewings WHERE id=${st.viewingId}`)).toBe(
      'Attended on time, liked the unit.',
    );
    // by design the lead stage stays viewing_scheduled until the customer
    // expresses interest (no auto-advance on visit completion)
    expect(q(`SELECT stage FROM leads WHERE id=${st.leadId}`)).toBe('viewing_scheduled');
  });

  test('RP express stage move updates the stage chip (Reject → Reopen)', async ({ page }) => {
    const st = readState();
    await safeLoginViaUi(page, st.rpEmail, /\/rental-provider\/dashboard/);

    const leadsLoaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/leads' && r.ok(),
      { timeout: 60_000 },
    );
    await page.goto('/rental-provider/dashboard/leads');
    await leadsLoaded;

    const row = page.locator(`#lead-${st.leadId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText('Viewing', { exact: true })).toBeVisible();

    // ··· menu → Reject Lead → confirm panel
    await row.locator('button.w-8.h-8').click();
    await row.getByRole('button', { name: 'Reject Lead' }).click();
    await expect(row.getByText('Reject this lead?')).toBeVisible({ timeout: 15_000 });

    const rejected = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/leads/${st.leadId}/stage`) &&
        r.request().method() === 'PATCH' &&
        r.ok(),
      { timeout: 30_000 },
    );
    await row.getByRole('button', { name: 'Yes, reject' }).click();
    await rejected;

    // stage chip flips to Rejected
    await expect(row.getByText('Rejected', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Viewing', { exact: true })).toHaveCount(0);
    expect(q(`SELECT stage FROM leads WHERE id=${st.leadId}`)).toBe('rejected');

    // rejected leads expose a one-click Reopen primary → chip flips back
    const reopened = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/leads/${st.leadId}/stage`) &&
        r.request().method() === 'PATCH' &&
        r.ok(),
      { timeout: 30_000 },
    );
    await row.getByRole('button', { name: 'Reopen' }).click();
    await reopened;

    await expect(row.getByText('Viewing', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Rejected', { exact: true })).toHaveCount(0);
    expect(q(`SELECT stage FROM leads WHERE id=${st.leadId}`)).toBe('viewing_scheduled');
  });

  test('operator accounts see a notice instead of booking CTAs on the public listing', async ({
    page,
  }) => {
    const st = readState();
    await muteExternals(page);
    await safeLoginViaUi(page, st.rpEmail, /\/rental-provider\/dashboard/);

    // the operator notice only renders once AuthContext resolves the user
    // (before /api/auth/me responds, canBook defaults to true) — wait for it
    const meLoaded = page
      .waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/me', { timeout: 60_000 })
      .catch(() => null);
    await page.goto(`/listings/units/${st.publishedUnitId}`);
    await expect(page.getByRole('heading', { name: st.unitNames[0] })).toBeVisible({
      timeout: 60_000,
    });
    await meLoaded;

    // operator notice replaces the CTAs
    await expect(page.getByText(/sign in with a customer account/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: 'Book Now', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Schedule Viewing', exact: true })).toHaveCount(
      0,
    );
  });
});
