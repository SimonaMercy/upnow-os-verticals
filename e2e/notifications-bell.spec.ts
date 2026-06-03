/**
 * Notifications bell smoke test
 *
 * Verifies the full in-app notification flow end-to-end:
 *
 *  1. POST /leads/viewings  — triggers a viewingConfirmed notification
 *  2. GET  /notifications/unread-count  — returns count ≥ 1
 *  3. GET  /notifications              — items list contains the notification
 *  4. PATCH /notifications/mark-read   — marked > 0, subsequent unread-count = 0
 *
 * Backend on :3001. NODE_ENV must not be "production" so devOtp is exposed.
 * Run: npm run test:e2e -- notifications-bell
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';

const RP_EMAIL = 'rp.test@upnow.ae';
const RP_PROPERTY_ID = 3;

const TS = Date.now();
const CUSTOMER_EMAIL = `notif.smoke.${TS}@upnow.ae`;

async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(r1.ok(), `OTP step-1 for ${email}: ${r1.status()}`).toBeTruthy();
  const b1 = await r1.json() as { devOtp?: string };
  expect(b1.devOtp, 'devOtp missing — NODE_ENV must not be production').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: b1.devOtp },
  });
  expect(r2.ok(), `OTP step-2 for ${email}: ${r2.status()}`).toBeTruthy();
  return ((await r2.json()) as { access_token: string }).access_token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test.describe.serial('Notifications bell — unread count + mark-read', () => {
  let rpToken = '';
  let customerToken = '';
  let unitId = 0;

  // ─── 1. Bootstrap ──────────────────────────────────────────────────────────

  test('1. set up fixture RP, fresh customer, and a published unit', async ({ request }) => {
    rpToken = await loginOtp(request, RP_EMAIL);

    // Register fresh customer — the DTO accepts email (or phone) only;
    // firstName/lastName/password were removed when the flow moved to OTP.
    const reg = await request.post(`${BACKEND}/auth/register/customer`, {
      data: { email: CUSTOMER_EMAIL },
    });
    expect(reg.ok(), `customer register: ${reg.status()} ${await reg.text()}`).toBeTruthy();
    customerToken = await loginOtp(request, CUSTOMER_EMAIL);

    // Create a published unit under the fixture RP's property
    const unitRes = await request.post(`${BACKEND}/properties/${RP_PROPERTY_ID}/units`, {
      headers: auth(rpToken),
      data: {
        unitNumber: `N-BELL-${TS}`,
        floor: 4,
        bedroomCount: 1,
        bathroomCount: 1,
        areaSqm: 65,
        annualRentFils: 8500000,
        securityDepositFils: 850000,
        status: 'available',
        isPublished: true,
        mandatoryFees: [],
      },
    });
    expect(unitRes.ok(), `unit create: ${unitRes.status()} ${await unitRes.text()}`).toBeTruthy();
    unitId = ((await unitRes.json()) as { id: number }).id;
    expect(unitId).toBeGreaterThan(0);
  });

  // ─── 2. Trigger notification via booking a viewing ─────────────────────────

  test('2. book a viewing — fires viewingConfirmed notification', async ({ request }) => {
    const res = await request.post(`${BACKEND}/leads/viewings`, {
      headers: auth(customerToken),
      data: {
        unitId,
        preferredDate: new Date(Date.now() + 2 * 86400_000).toISOString().split('T')[0],
        preferredTime: '10:00',
        notes: 'Notification smoke test',
      },
    });
    expect(res.ok(), `book viewing: ${res.status()} ${await res.text()}`).toBeTruthy();
  });

  // ─── 3. Unread count ≥ 1 ───────────────────────────────────────────────────

  test('3. GET /notifications/unread-count returns ≥ 1', async ({ request }) => {
    const res = await request.get(`${BACKEND}/notifications/unread-count`, {
      headers: auth(customerToken),
    });
    expect(res.ok(), `unread-count: ${res.status()}`).toBeTruthy();
    const body = await res.json() as { count: number };
    expect(typeof body.count).toBe('number');
    expect(body.count).toBeGreaterThanOrEqual(1);
  });

  // ─── 4. List contains the notification ────────────────────────────────────

  test('4. GET /notifications returns items with isRead=false', async ({ request }) => {
    const res = await request.get(`${BACKEND}/notifications?page=1&limit=20`, {
      headers: auth(customerToken),
    });
    expect(res.ok(), `list: ${res.status()}`).toBeTruthy();
    const body = await res.json() as {
      items: Array<{ id: number; isRead: boolean; title: string }>;
      unreadCount: number;
      total: number;
    };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.unreadCount).toBeGreaterThanOrEqual(1);
    const unreadItem = body.items.find((n) => !n.isRead);
    expect(unreadItem, 'at least one unread notification expected').toBeTruthy();
  });

  // ─── 5. Mark all read ─────────────────────────────────────────────────────

  test('5. PATCH /notifications/mark-read — marked > 0', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/notifications/mark-read`, {
      headers: auth(customerToken),
      data: {},
    });
    expect(res.ok(), `mark-read: ${res.status()}`).toBeTruthy();
    const body = await res.json() as { marked: number };
    expect(body.marked).toBeGreaterThan(0);
  });

  // ─── 6. Unread count is now 0 ─────────────────────────────────────────────

  test('6. unread-count is 0 after mark-read', async ({ request }) => {
    const res = await request.get(`${BACKEND}/notifications/unread-count`, {
      headers: auth(customerToken),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { count: number };
    expect(body.count).toBe(0);
  });

  // ─── 7. Items now all show isRead=true ───────────────────────────────────

  test('7. GET /notifications — all items isRead=true', async ({ request }) => {
    const res = await request.get(`${BACKEND}/notifications?page=1&limit=20`, {
      headers: auth(customerToken),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as {
      items: Array<{ isRead: boolean }>;
      unreadCount: number;
    };
    expect(body.unreadCount).toBe(0);
    for (const n of body.items) {
      expect(n.isRead).toBe(true);
    }
  });
});
