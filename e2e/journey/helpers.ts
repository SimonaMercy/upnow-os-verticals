/**
 * Shared helpers for the end-to-end lease-journey suite.
 *
 * Everything is driven through the real UI. The only non-UI escapes stand in
 * for opening an email — the dev OTP (EXPOSE_DEV_OTP=true returns the code in
 * the API response) and reading a portal magic-link token out of the DB. No
 * auth bypass, no direct API writes, no DB mutations.
 *
 * ACTIVITY TRACKING is the primary output. Two independent records are kept
 * per step and reconciled at the end:
 *   observed — what the test did through the UI, attributed to an actor
 *   recorded — what the app wrote to `audit_logs` while that step ran
 * The gap between them is the answer to "what activity is missing".
 */
import { Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export const DB = process.env.JOURNEY_DB ?? 'upnow_prod_clone';
export const SHOTS = process.env.JOURNEY_SHOTS ?? '/tmp/upnow-journey/screens';
export const STATE_FILE = path.join(__dirname, '.state.json');

export const CUSTOMER = 'dev@upnow.ae';
export const RP = 'kbaalfalasi@gmail.com';
export const MANAGER = 'sheco1300@yahoo.com';

/* ─── cross-spec state ──────────────────────────────────────────────────── */
export type State = Record<string, any>;

export function readState(): State {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
export function writeState(patch: State): State {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

/* ─── read-only DB peeks (assertions + locating records, never mutations) ── */
export function q(sql: string): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return execSync(`psql -h localhost -p 5432 -d ${DB} -tA -c ${JSON.stringify(oneLine)}`, {
    encoding: 'utf8',
  }).trim();
}

/** Multi-column query → array of string cells. */
export const SEP = '~|~';
export function qRows(sql: string): string[][] {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  const out = execSync(
    `psql -h localhost -p 5432 -d ${DB} -tA -F ${JSON.stringify(SEP)} -c ${JSON.stringify(oneLine)}`,
    { encoding: 'utf8' },
  ).trim();
  return out ? out.split('\n').filter(Boolean).map((l) => l.split(SEP)) : [];
}

/* ─── screenshots ───────────────────────────────────────────────────────── */
let shotSeq = 0;
export async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  shotSeq += 1;
  const seq = String(readState().shotSeq ?? 0).padStart(2, '0');
  const file = path.join(SHOTS, `${seq}-${String(shotSeq).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.basename(file)}`);
  return file;
}

/** Bump the per-spec screenshot prefix so files sort in journey order. */
export function shotPrefix(n: number) {
  writeState({ shotSeq: n });
  shotSeq = 0;
}

/** Dump every interactive element on the page — what the actor can do here. */
export async function surface(page: Page, label: string): Promise<string[]> {
  const items = await page.evaluate(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    document.querySelectorAll('button, a[href], [role="button"], input, select, textarea').forEach((el) => {
      if (!vis(el)) return;
      const tag = el.tagName.toLowerCase();
      let text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!text) {
        text = (el.getAttribute('aria-label') ?? el.getAttribute('placeholder')
             ?? el.getAttribute('name') ?? el.getAttribute('type') ?? '').slice(0, 60);
      }
      const dis = (el as HTMLButtonElement).disabled ? ' [disabled]' : '';
      const key = `${tag}|${text}|${dis}`;
      if (!text || seen.has(key)) return;
      seen.add(key);
      out.push(`${tag}: ${text}${dis}`);
    });
    return out;
  });
  console.log(`\n──── SURFACE @ ${label} — ${page.url()}`);
  items.forEach((i) => console.log(`   · ${i}`));
  console.log('──── end surface\n');
  return items;
}

/* ─── OTP mechanics (dev code stands in for the email) ──────────────────── */
export async function fillOtpBoxes(page: Page, code: string) {
  const boxes = page.locator('input[inputmode="numeric"]:visible');
  await boxes.first().waitFor({ state: 'visible', timeout: 15_000 });
  const n = await boxes.count();
  if (n >= 6) {
    for (let i = 0; i < 6; i++) {
      const b = boxes.nth(i);
      await b.fill('');
      await b.click();
      await page.keyboard.type(code[i]);
    }
  } else {
    await boxes.first().fill(code);
  }
}

/** Log in through the real /login screen: identifier → OTP → dashboard. */
export async function login(page: Page, identifier: string, expectUrl?: RegExp) {
  await page.context().clearCookies();
  await page.goto('/login');

  const idField = page.locator('input[type="email"], input[type="text"], input[type="tel"]').first();
  await idField.waitFor({ state: 'visible', timeout: 15_000 });
  await idField.fill(identifier);

  const respP = page
    .waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 25_000 })
    .catch(() => null);
  await page.locator('button[type="submit"]:visible').first().click();
  const resp = await respP;

  let otp: string | null = null;
  if (resp) {
    const body = await resp.json().catch(() => ({} as any));
    if (body?.devOtp) otp = String(body.devOtp);
  }
  if (!otp) {
    const box = page.locator('p.font-mono, [class*="devOtp"] b, text=/Dev code:/').first();
    await box.waitFor({ state: 'visible', timeout: 12_000 });
    otp = ((await box.innerText()) ?? '').replace(/\D/g, '').slice(0, 6);
  }
  expect(otp, `dev OTP for ${identifier}`).toMatch(/^\d{6}$/);

  await fillOtpBoxes(page, otp!);
  const verify = page.locator('button[type="submit"]:visible').first();
  if (await verify.isEnabled().catch(() => false)) {
    await verify.click().catch(() => {});
  }
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30_000 });
  if (expectUrl) await page.waitForURL(expectUrl, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

export async function logout(page: Page) {
  await page.request.post('/api/auth/logout').catch(() => {});
  await page.context().clearCookies();
}

/**
 * Draw on the signature pad.
 *
 * The pad is a plain canvas driven by React pointer handlers, and some pages
 * (the portal contract binder) render several other canvases above it — so the
 * pad is located by walking up from its own "Clear" control rather than by
 * index.
 */
export async function drawSignature(page: Page) {
  const n = await page.locator('canvas').count();
  await page.evaluate(() => {
    document.querySelectorAll('[data-journey-pad]').forEach((e) => e.removeAttribute('data-journey-pad'));
    const clear = [...document.querySelectorAll('button, a, span')]
      .filter((e) => (e.textContent ?? '').trim() === 'Clear')
      .pop();
    let pad: HTMLCanvasElement | null = null;
    let node: Element | null = clear ?? null;
    for (let i = 0; i < 8 && node; i++) {
      const c = node.querySelector('canvas');
      if (c) { pad = c as HTMLCanvasElement; break; }
      node = node.parentElement;
    }
    if (!pad) {
      const all = [...document.querySelectorAll('canvas')] as HTMLCanvasElement[];
      pad = all[all.length - 1] ?? null;
    }
    if (pad) pad.setAttribute('data-journey-pad', '1');
  });

  const canvas = page.locator('canvas[data-journey-pad="1"]').first();
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const box = await canvas.boundingBox();
  if (!box) throw new Error('signature canvas has no bounding box');
  console.log(`  → signing pad: ${Math.round(box.width)}×${Math.round(box.height)} (of ${n} canvases)`);

  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 25, y, { steps: 4 });
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + 25 + (i * (box.width - 50)) / 12, y + (i % 2 ? -18 : 18), { steps: 3 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);

  // On some layouts the real mouse gesture never reaches the pad's React
  // handlers (an overlay swallows it), leaving `drawn` false and the Sign
  // button disabled even though the pad looks blank-but-clicked. Synthesise
  // the pointer sequence directly on the canvas as a fallback.
  const inked = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d');
    if (!ctx) return false;
    const d = ctx.getImageData(0, 0, el.width, el.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  }).catch(() => false);

  if (!inked) {
    console.log('  → pad still blank after mouse gesture; dispatching pointer events');
    await canvas.evaluate((el: HTMLCanvasElement) => {
      const r = el.getBoundingClientRect();
      const fire = (x: number, yy: number, type: string) =>
        el.dispatchEvent(new PointerEvent(type, {
          clientX: x, clientY: yy, bubbles: true, cancelable: true,
          pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1,
        }));
      const mid = r.top + r.height / 2;
      fire(r.left + 25, mid, 'pointerdown');
      for (let i = 1; i <= 12; i++) {
        fire(r.left + 25 + (i * (r.width - 50)) / 12, mid + (i % 2 ? -18 : 18), 'pointermove');
      }
      fire(r.right - 25, mid, 'pointerup');
    });
    await page.waitForTimeout(700);
  }
}

/**
 * Fill in a whole signature block: draw, name, consent, submit.
 * Returns true if the submit actually fired.
 */
export async function signBlock(page: Page, submitLabel: RegExp, name: string): Promise<boolean> {
  await drawSignature(page);

  // Scope the name field and consent box to the block that owns the pad —
  // several of these pages render more than one form.
  await page.evaluate(() => {
    const pad = document.querySelector('canvas[data-journey-pad="1"]');
    document.querySelectorAll('[data-journey-block]').forEach((e) => e.removeAttribute('data-journey-block'));
    let node: Element | null = pad;
    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement;
      if (node?.querySelector('input[type="checkbox"]')) {
        node.setAttribute('data-journey-block', '1');
        return;
      }
    }
    document.body.setAttribute('data-journey-block', '1');
  });
  const block = page.locator('[data-journey-block="1"]').first();

  const nameField = block.getByPlaceholder(/Full name/i).first();
  if (await nameField.isVisible().catch(() => false)) {
    await nameField.scrollIntoViewIfNeeded().catch(() => {});
    const current = await nameField.inputValue().catch(() => '');
    if (!current.trim()) {
      await nameField.fill(name);
      await nameField.dispatchEvent('input').catch(() => {});
    }
    console.log(`  → signatory name: "${(await nameField.inputValue().catch(() => '')) || '(empty)'}"`);
  } else {
    console.log('  ⚠ no "Full name" field inside the signature block');
  }

  const consent = block.locator('input[type="checkbox"]').first();
  await consent.check().catch(() => {});
  console.log(`  → consent checked: ${await consent.isChecked().catch(() => false)}`);
  await page.waitForTimeout(500);

  const btn = block.locator('button').filter({ hasText: submitLabel }).first();
  const target = (await btn.count()) ? btn : page.locator('button').filter({ hasText: submitLabel }).first();
  if (!(await target.isEnabled().catch(() => false))) {
    console.log(`  ⚠ "${submitLabel}" still disabled — signature block not satisfied`);
    return false;
  }
  await target.click();
  await page.waitForTimeout(4000);
  return true;
}

/** Click the first visible element matching any of the given texts. */
export async function clickAny(page: Page, texts: (string | RegExp)[], timeout = 10_000): Promise<string | null> {
  for (const t of texts) {
    const el = page.locator('button:visible, a:visible, [role="button"]:visible').filter({ hasText: t }).first();
    if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
      const label = (await el.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout }).catch(() => {});
      return label || String(t);
    }
  }
  return null;
}

/** In-memory file fixtures so uploads need no disk assets. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export function png(name = 'photo.png') {
  return { name, mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') };
}
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
BT /F1 12 Tf 20 100 Td (UpNow journey) Tj ET
endstream
endobj
trailer<</Size 5/Root 1 0 R>>
%%EOF`;
export function pdf(name = 'doc.pdf') {
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(PDF) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ACTIVITY TRACKING
 * ══════════════════════════════════════════════════════════════════════════ */

export type Actor = 'customer' | 'landlord' | 'manager' | 'system';

export type Observed = { step: string; actor: Actor; action: string; detail?: string };
export type Recorded = {
  step: string; id: number; actionKey: string; entity: string; entityId: number;
  actorRole: string | null; actorUserId: number | null; actorEmail: string | null; at: string;
};

/** Mark the start of a step: remembers the audit-log high-water mark. */
export function beginStep(step: string) {
  const maxId = Number(q('SELECT COALESCE(MAX(id),0) FROM audit_logs')) || 0;
  writeState({ currentStep: step, auditMark: maxId });
  console.log(`\n▶ STEP "${step}" — audit high-water mark ${maxId}`);
}

/** Record a UI action the test performed, attributed to an actor. */
export function act(actor: Actor, action: string, detail?: string) {
  const s = readState();
  const step = s.currentStep ?? 'unknown';
  const obs: Observed[] = s.observed ?? [];
  obs.push({ step, actor, action, detail });
  writeState({ observed: obs });
  console.log(`   ✎ [${actor}] ${action}${detail ? ` — ${detail}` : ''}`);
}

/** Close a step: file every audit row written since beginStep under this step. */
export function endStep(): Recorded[] {
  const s = readState();
  const step = s.currentStep ?? 'unknown';
  const mark = s.auditMark ?? 0;
  const rows: Recorded[] = qRows(`
    SELECT a.id, a.action_key, a.entity_type, a.entity_id,
           COALESCE(a.actor_role,''), COALESCE(a.actor_user_id::text,''),
           COALESCE(u.email,''), a.created_at
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.id > ${mark} ORDER BY a.id`
  ).map(([id, actionKey, entity, entityId, actorRole, actorUserId, actorEmail, at]) => ({
    step, id: Number(id), actionKey, entity, entityId: Number(entityId),
    actorRole: actorRole || null,
    actorUserId: actorUserId ? Number(actorUserId) : null,
    actorEmail: actorEmail || null,
    at,
  }));
  const all: Recorded[] = readState().recorded ?? [];
  all.push(...rows);
  writeState({ recorded: all });

  console.log(`◀ STEP "${step}" — ${rows.length} audit row(s) recorded by the app:`);
  if (!rows.length) console.log('     ⚠ NONE — nothing in this step produced an audit trail');
  rows.forEach((r) =>
    console.log(`     · ${r.actionKey} [${r.entity}#${r.entityId}] actor_role=${r.actorRole ?? '∅ UNATTRIBUTED'} ${r.actorEmail ?? ''}`),
  );
  return rows;
}

/** Note a gap found at a stage — feeds the final report. */
export function gap(stage: string, text: string) {
  const s = readState();
  const gaps: { stage: string; text: string }[] = s.gaps ?? [];
  gaps.push({ stage, text });
  writeState({ gaps });
  console.log(`   ⚠ GAP [${stage}] ${text}`);
}
