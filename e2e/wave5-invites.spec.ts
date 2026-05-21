/**
 * Wave 5 — Invite System: Technician by SP · Manager by RP
 * SCRUM-T-501 through T-507
 *
 * Covers the full invite lifecycle:
 *   1. API validation (send invite — roles, limits, duplicates)
 *   2. Token validation — valid, invalid, expired/used
 *   3. Accept invite — creates user, returns JWT, correct role/profile
 *   4. Cancel & Resend
 *   5. Manager permissions — get and PATCH
 *   6. Team list endpoints
 *   7. Frontend — SP Team page (render + invite modal)
 *   8. Frontend — RP Team page (render + invite modal with permissions)
 *   9. Frontend — Accept Invite page (/invite/[token])
 *
 * Prerequisites:
 *   - Backend running on http://localhost:3001
 *   - Frontend running on http://localhost:3000
 *   - superadmin@upnow.ae / ChangeMe2026! exists in DB
 *
 * Run: npm run test:e2e -- wave5-invites
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return Date.now() + Math.floor(Math.random() * 10_000);
}

async function loginViaApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BACKEND}/auth/login`, {
    data: { email, password },
  });
  const body = await res.json();
  return body.access_token as string;
}

async function registerSp(request: APIRequestContext): Promise<{ email: string; token: string }> {
  const email = `sp.invite.${uid()}@upnow.ae`;
  const res = await request.post(`${BACKEND}/auth/register/service-provider`, {
    data: { email, password: 'Invite2026!' },
  });
  expect([200, 201]).toContain(res.status());
  const body = await res.json();
  return { email, token: body.access_token as string };
}

async function registerRp(request: APIRequestContext): Promise<{ email: string; token: string }> {
  const email = `rp.invite.${uid()}@upnow.ae`;
  const res = await request.post(`${BACKEND}/auth/register/rental-provider`, {
    data: { email, password: 'Invite2026!' },
  });
  expect([200, 201]).toContain(res.status());
  const body = await res.json();
  return { email, token: body.access_token as string };
}

async function loginFrontend(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // wait until redirected away from /login
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 8_000 });
}

// ─── GROUP 1: API — Send invite (SP → Technician) ────────────────────────────

test.describe('Wave 5 — API: SP invites technician', () => {
  test('T5-1: SP can invite a technician — returns 201 with token', async ({ request }) => {
    const sp = await registerSp(request);
    const res = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: {
        email: `tech.${uid()}@upnow.ae`,
        firstName: 'Ali',
        role: 'technician',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.token).toHaveLength(96);
    expect(body.status).toBe('pending');
    expect(body.role).toBe('technician');
  });

  test('T5-2: Sending same email twice returns existing invite (idempotent)', async ({ request }) => {
    const sp = await registerSp(request);
    const techEmail = `tech.idem.${uid()}@upnow.ae`;
    const payload = { email: techEmail, firstName: 'Idem', role: 'technician' };

    const r1 = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: payload,
    });
    const r2 = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: payload,
    });
    expect([200, 201]).toContain(r1.status());
    expect([200, 201]).toContain(r2.status());
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.id).toBe(b2.id);
  });

  test('T5-3: RP cannot invite a technician — 403', async ({ request }) => {
    const rp = await registerRp(request);
    const res = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${rp.token}` },
      data: {
        email: `tech.${uid()}@upnow.ae`,
        firstName: 'BadRole',
        role: 'technician',
      },
    });
    expect(res.status()).toBe(403);
  });

  test('T5-4: Missing email returns 400', async ({ request }) => {
    const sp = await registerSp(request);
    const res = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { firstName: 'NoEmail', role: 'technician' },
    });
    expect(res.status()).toBe(400);
  });

  test('T5-5: Unauthenticated invite returns 401', async ({ request }) => {
    const res = await request.post(`${BACKEND}/invitations`, {
      data: { email: `any.${uid()}@upnow.ae`, firstName: 'Anon', role: 'technician' },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── GROUP 2: API — Send invite (RP → Manager) ────────────────────────────────

test.describe('Wave 5 — API: RP invites manager', () => {
  test('T5-6: RP can invite a manager with permissions — returns 201', async ({ request }) => {
    const rp = await registerRp(request);
    const res = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${rp.token}` },
      data: {
        email: `mgr.${uid()}@upnow.ae`,
        firstName: 'Mariam',
        role: 'manager',
        metadata: {
          can_list_properties: true,
          can_manage_viewings: true,
          can_view_financials: false,
        },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.role).toBe('manager');
    expect(body.metadata).toBeTruthy();
    expect(body.metadata.can_list_properties).toBe(true);
    expect(body.metadata.can_manage_viewings).toBe(true);
  });

  test('T5-7: SP cannot invite a manager — 403', async ({ request }) => {
    const sp = await registerSp(request);
    const res = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: {
        email: `mgr.${uid()}@upnow.ae`,
        firstName: 'Bad',
        role: 'manager',
      },
    });
    expect(res.status()).toBe(403);
  });
});

// ─── GROUP 3: API — Token validation (public endpoint) ────────────────────────

test.describe('Wave 5 — API: Token validation', () => {
  test('T5-8: GET /invitations/:token returns invite details for valid token', async ({ request }) => {
    const sp = await registerSp(request);
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: `tech.tok.${uid()}@upnow.ae`, firstName: 'Faisal', role: 'technician' },
    });
    const { token } = await inviteRes.json();

    const res = await request.get(`${BACKEND}/invitations/${token}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.role).toBe('technician');
    expect(body.firstName).toBe('Faisal');
  });

  test('T5-9: GET /invitations/:token with fake token returns 404', async ({ request }) => {
    const fakeToken = 'a'.repeat(96);
    const res = await request.get(`${BACKEND}/invitations/${fakeToken}`);
    expect([400, 404]).toContain(res.status());
  });
});

// ─── GROUP 4: API — Accept invite ─────────────────────────────────────────────

test.describe('Wave 5 — API: Accept invite', () => {
  test('T5-10: Accepting technician invite creates user and returns JWT', async ({ request }) => {
    const sp = await registerSp(request);
    const techEmail = `tech.accept.${uid()}@upnow.ae`;

    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: techEmail, firstName: 'Omar', role: 'technician' },
    });
    const { token } = await inviteRes.json();

    const acceptRes = await request.post(`${BACKEND}/invitations/${token}/accept`, {
      data: { firstName: 'Omar', phone: '+971501112233', password: 'Welcome2026!' },
    });
    expect(acceptRes.status()).toBe(201);
    const body = await acceptRes.json();
    expect(body.access_token).toBeTruthy();
    expect(body.user.role).toBe('technician');
    expect(body.user.status).toBe('active');
    expect(body.user.email).toBe(techEmail);
  });

  test('T5-11: Accepting manager invite creates user with manager role', async ({ request }) => {
    const rp = await registerRp(request);
    const mgrEmail = `mgr.accept.${uid()}@upnow.ae`;

    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${rp.token}` },
      data: {
        email: mgrEmail,
        firstName: 'Nour',
        role: 'manager',
        metadata: { can_list_properties: true, can_view_financials: true },
      },
    });
    const { token } = await inviteRes.json();

    const acceptRes = await request.post(`${BACKEND}/invitations/${token}/accept`, {
      data: { firstName: 'Nour', phone: '+971504445566', password: 'Welcome2026!' },
    });
    expect(acceptRes.status()).toBe(201);
    const body = await acceptRes.json();
    expect(body.user.role).toBe('manager');
    expect(body.user.status).toBe('active');
  });

  test('T5-12: Accepting an already-accepted invite returns 400', async ({ request }) => {
    const sp = await registerSp(request);
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: `tech.reuse.${uid()}@upnow.ae`, firstName: 'Reuse', role: 'technician' },
    });
    const { token } = await inviteRes.json();

    await request.post(`${BACKEND}/invitations/${token}/accept`, {
      data: { firstName: 'Reuse', phone: '+971507778899', password: 'Welcome2026!' },
    });

    const secondAccept = await request.post(`${BACKEND}/invitations/${token}/accept`, {
      data: { firstName: 'Reuse', phone: '+971507778899', password: 'Welcome2026!' },
    });
    expect([400, 409]).toContain(secondAccept.status());
  });

  test('T5-13: Accept with missing password returns 400', async ({ request }) => {
    const sp = await registerSp(request);
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: `tech.nopw.${uid()}@upnow.ae`, firstName: 'NoPw', role: 'technician' },
    });
    const { token } = await inviteRes.json();

    const res = await request.post(`${BACKEND}/invitations/${token}/accept`, {
      data: { firstName: 'NoPw', phone: '+971501234567' }, // password missing
    });
    expect(res.status()).toBe(400);
  });
});

// ─── GROUP 5: API — Cancel & Resend ───────────────────────────────────────────

test.describe('Wave 5 — API: Cancel & Resend', () => {
  test('T5-14: Inviter can cancel a pending invite', async ({ request }) => {
    const sp = await registerSp(request);
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: `tech.cancel.${uid()}@upnow.ae`, firstName: 'Cancel', role: 'technician' },
    });
    const invite = await inviteRes.json();

    const cancelRes = await request.delete(`${BACKEND}/invitations/${invite.id}`, {
      headers: { Authorization: `Bearer ${sp.token}` },
    });
    expect([200, 204]).toContain(cancelRes.status());

    // Token should now be invalid
    const tokenRes = await request.get(`${BACKEND}/invitations/${invite.token}`);
    expect([400, 404]).toContain(tokenRes.status());
  });

  test('T5-15: Inviter can resend a pending invite', async ({ request }) => {
    const sp = await registerSp(request);
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: `tech.resend.${uid()}@upnow.ae`, firstName: 'Resend', role: 'technician' },
    });
    const { id } = await inviteRes.json();

    const resendRes = await request.post(`${BACKEND}/invitations/${id}/resend`, {
      headers: { Authorization: `Bearer ${sp.token}` },
    });
    expect([200, 201]).toContain(resendRes.status());
  });

  test('T5-16: Another user cannot cancel someone else\'s invite — 403', async ({ request }) => {
    const sp1 = await registerSp(request);
    const sp2 = await registerSp(request);

    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp1.token}` },
      data: { email: `tech.other.${uid()}@upnow.ae`, firstName: 'Other', role: 'technician' },
    });
    const { id } = await inviteRes.json();

    const cancelRes = await request.delete(`${BACKEND}/invitations/${id}`, {
      headers: { Authorization: `Bearer ${sp2.token}` },
    });
    expect(cancelRes.status()).toBe(403);
  });
});

// ─── GROUP 6: API — Manager permissions ───────────────────────────────────────

test.describe('Wave 5 — API: Manager permissions', () => {
  let rpToken: string;
  let managerUserId: number;

  test.beforeAll(async ({ request }) => {
    const rp = await registerRp(request);
    rpToken = rp.token;

    const mgrEmail = `mgr.perms.${uid()}@upnow.ae`;
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${rpToken}` },
      data: {
        email: mgrEmail,
        firstName: 'Perms',
        role: 'manager',
        metadata: { can_list_properties: true, can_manage_viewings: false },
      },
    });
    const { token } = await inviteRes.json();

    const acceptRes = await request.post(`${BACKEND}/invitations/${token}/accept`, {
      data: { firstName: 'Perms', phone: '+971506667788', password: 'Perms2026!' },
    });
    const body = await acceptRes.json();
    managerUserId = body.user.id;
  });

  test('T5-17: RP can GET manager permissions', async ({ request }) => {
    const res = await request.get(`${BACKEND}/managers/${managerUserId}/permissions`, {
      headers: { Authorization: `Bearer ${rpToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.canListProperties).toBe('boolean');
    expect(body.canListProperties).toBe(true);
    expect(body.canManageViewings).toBe(false);
  });

  test('T5-18: RP can PATCH manager permissions', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/managers/${managerUserId}/permissions`, {
      headers: { Authorization: `Bearer ${rpToken}` },
      data: { canManageViewings: true, canViewFinancials: true },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.canManageViewings).toBe(true);
    expect(body.canViewFinancials).toBe(true);
  });

  test('T5-19: Unauthenticated GET manager permissions returns 401', async ({ request }) => {
    const res = await request.get(`${BACKEND}/managers/${managerUserId}/permissions`);
    expect(res.status()).toBe(401);
  });
});

// ─── GROUP 7: API — Team list endpoints ───────────────────────────────────────

test.describe('Wave 5 — API: Team list endpoints', () => {
  test('T5-20: GET /team/technicians returns array for SP', async ({ request }) => {
    const sp = await registerSp(request);
    const res = await request.get(`${BACKEND}/team/technicians`, {
      headers: { Authorization: `Bearer ${sp.token}` },
    });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('T5-21: GET /team/managers returns array for RP', async ({ request }) => {
    const rp = await registerRp(request);
    const res = await request.get(`${BACKEND}/team/managers`, {
      headers: { Authorization: `Bearer ${rp.token}` },
    });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('T5-22: SP cannot access /team/managers — 403', async ({ request }) => {
    const sp = await registerSp(request);
    const res = await request.get(`${BACKEND}/team/managers`, {
      headers: { Authorization: `Bearer ${sp.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('T5-23: RP cannot access /team/technicians — 403', async ({ request }) => {
    const rp = await registerRp(request);
    const res = await request.get(`${BACKEND}/team/technicians`, {
      headers: { Authorization: `Bearer ${rp.token}` },
    });
    expect(res.status()).toBe(403);
  });
});

// ─── GROUP 8: Frontend — SP Team page ─────────────────────────────────────────

test.describe('Wave 5 — Frontend: SP Team page', () => {
  let spEmail: string;
  let spPassword = 'Invite2026!';

  test.beforeAll(async ({ request }) => {
    const sp = await registerSp(request);
    spEmail = sp.email;
  });

  test('T5-24: SP Team page renders heading and Invite button', async ({ page }) => {
    await loginFrontend(page, spEmail, spPassword);
    await page.goto('/dashboard/service-provider/team');

    await expect(page.getByRole('heading', { name: 'My Team' })).toBeVisible();
    await expect(page.getByRole('button', { name: /invite technician/i })).toBeVisible();
  });

  test('T5-25: Invite Technician modal opens on button click', async ({ page }) => {
    await loginFrontend(page, spEmail, spPassword);
    await page.goto('/dashboard/service-provider/team');

    await page.getByRole('button', { name: /invite technician/i }).click();
    await expect(page.getByRole('heading', { name: /invite technician/i })).toBeVisible();
    await expect(page.getByLabel(/first name/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('T5-26: Modal shows validation error on empty submit', async ({ page }) => {
    await loginFrontend(page, spEmail, spPassword);
    await page.goto('/dashboard/service-provider/team');

    await page.getByRole('button', { name: /invite technician/i }).click();
    await page.getByRole('button', { name: /send invite/i }).click();

    // Should show at least one validation error
    await expect(page.locator('text=required', { hasText: /required/i }).first()).toBeVisible();
  });

  test('T5-27: Modal closes on Cancel click', async ({ page }) => {
    await loginFrontend(page, spEmail, spPassword);
    await page.goto('/dashboard/service-provider/team');

    await page.getByRole('button', { name: /invite technician/i }).click();
    await expect(page.getByRole('heading', { name: /invite technician/i })).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('heading', { name: /invite technician/i })).not.toBeVisible();
  });

  test('T5-28: Successful invite submission closes modal', async ({ page }) => {
    await loginFrontend(page, spEmail, spPassword);
    await page.goto('/dashboard/service-provider/team');

    await page.getByRole('button', { name: /invite technician/i }).click();

    await page.getByLabel(/first name/i).fill('TestTech');
    // Fill email after the first-name label in the form
    await page.locator('input[type="email"]').fill(`tech.ui.${uid()}@upnow.ae`);
    await page.getByRole('button', { name: /send invite/i }).click();

    // Modal should disappear after success
    await expect(page.getByRole('heading', { name: /invite technician/i })).not.toBeVisible({
      timeout: 6_000,
    });
  });
});

// ─── GROUP 9: Frontend — RP Team page ─────────────────────────────────────────

test.describe('Wave 5 — Frontend: RP Team page', () => {
  let rpEmail: string;
  const rpPassword = 'Invite2026!';

  test.beforeAll(async ({ request }) => {
    const rp = await registerRp(request);
    rpEmail = rp.email;
  });

  test('T5-29: RP Team page renders heading and Invite Manager button', async ({ page }) => {
    await loginFrontend(page, rpEmail, rpPassword);
    await page.goto('/dashboard/rental-provider/team');

    await expect(page.getByRole('heading', { name: 'My Team' })).toBeVisible();
    await expect(page.getByRole('button', { name: /invite manager/i })).toBeVisible();
  });

  test('T5-30: Invite Manager modal shows permission toggles', async ({ page }) => {
    await loginFrontend(page, rpEmail, rpPassword);
    await page.goto('/dashboard/rental-provider/team');

    await page.getByRole('button', { name: /invite manager/i }).click();
    await expect(page.getByRole('heading', { name: /invite manager/i })).toBeVisible();

    // Permission group labels — scope to dialog to avoid nav sidebar matches
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Properties', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Agreements', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Finance', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Admin', { exact: true })).toBeVisible();

    // At least one permission toggle button present
    await expect(page.getByRole('switch').first()).toBeVisible();
  });

  test('T5-31: Invite Manager modal validation requires at least one permission', async ({ page }) => {
    await loginFrontend(page, rpEmail, rpPassword);
    await page.goto('/dashboard/rental-provider/team');

    await page.getByRole('button', { name: /invite manager/i }).click();
    await page.getByLabel(/first name/i).fill('NoPerms');
    await page.locator('input[type="email"]').fill(`mgr.noperms.${uid()}@upnow.ae`);
    await page.getByRole('button', { name: /send invite/i }).click();

    await expect(page.getByText(/at least one permission/i)).toBeVisible();
  });
});

// ─── GROUP 10: Frontend — Accept Invite page ──────────────────────────────────

test.describe('Wave 5 — Frontend: Accept Invite page', () => {
  test('T5-32: Invalid token shows error state', async ({ page }) => {
    const fakeToken = 'z'.repeat(96);
    await page.goto(`/invite/${fakeToken}`);

    await expect(page.getByRole('heading', { name: /invite link invalid/i })).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByText(/contact your inviter/i)).toBeVisible();
  });

  test('T5-33: Valid token renders invite details and form', async ({ request, page }) => {
    const sp = await registerSp(request);
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: `tech.form.${uid()}@upnow.ae`, firstName: 'Kareem', role: 'technician' },
    });
    const { token } = await inviteRes.json();

    await page.goto(`/invite/${token}`);

    await expect(page.getByRole('heading', { name: /you're invited/i })).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByText(/Technician/i)).toBeVisible();
    await expect(page.getByLabel(/phone/i)).toBeVisible();
    await expect(page.getByLabel(/^password/i)).toBeVisible();
  });

  test('T5-34: Manager invite shows permission summary', async ({ request, page }) => {
    const rp = await registerRp(request);
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${rp.token}` },
      data: {
        email: `mgr.view.${uid()}@upnow.ae`,
        firstName: 'Sara',
        role: 'manager',
        metadata: { can_list_properties: true, can_view_financials: true },
      },
    });
    const { token } = await inviteRes.json();

    await page.goto(`/invite/${token}`);

    await expect(page.getByText(/Asset Manager/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Your permissions')).toBeVisible();
    await expect(page.getByText('List properties')).toBeVisible();
    await expect(page.getByText('View financials')).toBeVisible();
  });

  test('T5-35: Form validation — password too short', async ({ request, page }) => {
    const sp = await registerSp(request);
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: `tech.val.${uid()}@upnow.ae`, firstName: 'ValTest', role: 'technician' },
    });
    const { token } = await inviteRes.json();

    await page.goto(`/invite/${token}`);
    await expect(page.getByLabel(/^password/i)).toBeVisible({ timeout: 6_000 });

    await page.getByLabel(/first name/i).fill('ValTest');
    await page.getByLabel(/phone/i).fill('+971500000001');
    await page.getByLabel(/^password/i).fill('short');
    await page.getByLabel(/confirm password/i).fill('short');
    await page.getByRole('button', { name: /accept invite/i }).click();

    await expect(page.getByText(/at least 8/i)).toBeVisible();
  });

  test('T5-36: Accepting technician invite redirects to dashboard', async ({ request, page }) => {
    const sp = await registerSp(request);
    const techEmail = `tech.e2e.${uid()}@upnow.ae`;
    const inviteRes = await request.post(`${BACKEND}/invitations`, {
      headers: { Authorization: `Bearer ${sp.token}` },
      data: { email: techEmail, firstName: 'E2E', role: 'technician' },
    });
    const { token } = await inviteRes.json();

    await page.goto(`/invite/${token}`);
    await expect(page.getByLabel(/^password/i)).toBeVisible({ timeout: 6_000 });

    await page.getByLabel(/first name/i).fill('E2E');
    await page.getByLabel(/phone/i).fill('+971509999000');
    await page.getByLabel(/^password/i).fill('Welcome2026!');
    await page.getByLabel(/confirm password/i).fill('Welcome2026!');
    await page.getByRole('button', { name: /accept invite/i }).click();

    // Should show success state
    await expect(page.getByRole('heading', { name: /welcome to upnow/i })).toBeVisible({
      timeout: 8_000,
    });
  });
});
