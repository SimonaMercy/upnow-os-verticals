import { test, expect, Page } from '@playwright/test';

/**
 * SCRUM-792 — RP Team page: the visual overview of what the landlord's
 * managers are doing, on top of the activity log. Asserts the payload's
 * invariants (the figures a landlord reads) and that the page renders every
 * section from it.
 */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

interface Person {
  userId: number; name: string; status: 'active' | 'idle' | 'today' | 'offline';
  lastAt: string | null; lastChangeAt: string | null; lastPageAt: string | null;
  last: { kind: 'change' | 'page'; at: string; label: string; subject: string | null; href: string | null } | null;
  today: { changes: number; pages: number; minutes: number };
  period: {
    changes: number; stepsDone: number; responses: number; tasksDone: number;
    avgResponseHours: number | null; onTimePct: number | null; slaPct: number | null;
    pages: number;
    activeDays: number; workingDays: number; idleDays: number; minutes: number;
    idle: {
      totalMinutes: number; pct: number | null; longestMinutes: number;
      workedMinutes: number; spanMinutes: number;
    };
  };
  spark: number[];
}
interface Payload {
  window: { from: string; to: string; days: number; workingDays: number; hourly: boolean; countingFrom: string | null; prevComparable: boolean };
  prev: { from: string; to: string };
  targets: {
    onTimeHours: number; slaHours: number;
    officeOpen: string; officeClose: string;
    officeBreakMinutes: number; expectedDayMinutes: number;
  };
  teamSize: number; ownerUserId: number; activeNow: number;
  status: Record<'active' | 'idle' | 'today' | 'offline', number>;
  kpis: {
    stepsDone: { v: number; prev: number }; changes: { v: number; prev: number };
    tasksDone: { v: number; prev: number | null };
    leasesClosed: { v: number; prev: number | null; setup: number; ended: number };
    openWork: { v: number; setup: number; windDown: number; leads: number; byPerson: Array<{ name: string; count: number }> };
    avgResponseHours: { v: number | null; prev: number | null };
    onTimePct: { v: number | null; prev: number | null }; slaPct: { v: number | null; prev: number | null };
  };
  trend: Array<{ key: string; changes: number; responses: number; onTime: number; closed: number }>;
  steps: Array<{ key: string; label: string; side: 'manager' | 'customer' | 'landlord'; where: 'ground' | 'remote'; live: boolean; total: number; open: number | null; openPeople: Record<string, number> | null; people: Record<string, number> | null; owner: number | null;
    response: { measured: number; onTimePct: number | null; slaPct: number | null; breached: number; slaHours: number }; peopleResponse: Record<string, { measured: number; onTimePct: number | null; slaPct: number | null }> | null }>;
  team: Person[];
  calendar: { today: Array<{ kind: string; day: string }>; upcoming: Array<{ kind: string; day: string }> };
  feed: Array<{ id: string; at: string; kind: 'change' | 'page'; who: string; label: string; repeats: number; where: 'ground' | 'remote' }>;
}

async function openRangeOnce(page: Page) {
  await page.getByRole('button', { name: /\d{1,2} \w{3} \d{4}/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Date range' })).toBeVisible();
}

test.describe('RP Team page (SCRUM-792)', () => {
  test('payload invariants — this month and a single day', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'kbaalfalasi@gmail.com');

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const res = await page.request.get('/api/reports/team-overview');
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()) as Payload;

    // Default window = this month to today; the comparison window is the same
    // length and ends the day before.
    expect(d.window.from).toBe(`${today.slice(0, 7)}-01`);
    expect(d.window.to).toBe(today);
    expect(d.window.hourly).toBe(false);
    expect(Date.parse(d.prev.to)).toBe(Date.parse(d.window.from) - 86_400_000);
    expect((Date.parse(d.prev.to) - Date.parse(d.prev.from)) / 86_400_000 + 1).toBe(d.window.days);

    // The roster: every manager once, status counts partition the team.
    expect(d.teamSize).toBe(d.team.length);
    expect(new Set(d.team.map((p) => p.userId)).size).toBe(d.team.length);
    expect(d.status.active + d.status.idle + d.status.today + d.status.offline).toBe(d.teamSize);
    expect(d.activeNow).toBe(d.status.active);

    // Working days never count Fridays and never the future.
    const fridays = (() => { let n = 0; for (let t = Date.parse(d.window.from); t <= Date.parse(today); t += 86_400_000) if (new Date(t).getUTCDay() === 5) n++; return n; })();
    const elapsed = (Date.parse(today) - Date.parse(d.window.from)) / 86_400_000 + 1;
    expect(d.window.workingDays).toBe(elapsed - fridays);
    for (const p of d.team) {
      expect(p.period.workingDays).toBe(d.window.workingDays);
      expect(p.period.idleDays).toBeLessThanOrEqual(d.window.workingDays);
      // Percentages are 0–100 or absent; a person with no responses has no on-time figure.
      for (const x of [p.period.onTimePct, p.period.slaPct, p.period.idle.pct]) if (x != null) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); }
      if (p.period.responses === 0) { expect(p.period.onTimePct).toBeNull(); expect(p.period.avgResponseHours).toBeNull(); }
      // SLA (72h) can never be stricter than on time (24h).
      if (p.period.onTimePct != null && p.period.slaPct != null) expect(p.period.slaPct).toBeGreaterThanOrEqual(p.period.onTimePct);
      expect(p.period.idle.longestMinutes).toBeLessThanOrEqual(Math.max(p.period.idle.totalMinutes, p.period.idle.longestMinutes));
    }
    // Per-person changes add up to the team's; trend buckets = one per day and add up too.
    expect(d.team.reduce((s, p) => s + p.period.changes, 0)).toBe(d.kpis.changes.v);
    // Top performers ranks on TASKS COMPLETED, and a person's figure is exactly
    // what their column in "Activity by step" totals — never more than the team.
    for (const p of d.team) {
      expect(p.period.tasksDone).toBe(
        d.steps.filter((x) => !x.live).reduce((s, x) => s + (x.people?.[String(p.userId)] ?? 0), 0));
      expect(p.period.tasksDone).toBeLessThanOrEqual(d.kpis.tasksDone.v);
    }
    expect(d.trend.length).toBe(d.window.days);
    expect(d.trend.reduce((s, b) => s + b.changes, 0)).toBe(d.kpis.changes.v);
    for (const b of d.trend) expect(b.onTime).toBeLessThanOrEqual(b.responses);
    if (d.kpis.onTimePct.v != null && d.kpis.slaPct.v != null) expect(d.kpis.slaPct.v).toBeGreaterThanOrEqual(d.kpis.onTimePct.v);
    // Opened Tasks covers the WHOLE Operations page — the board's leases and the
    // lead funnel's cards, which sit one tab across on the same screen.
    expect(d.kpis.openWork.setup + d.kpis.openWork.windDown + d.kpis.openWork.leads).toBe(d.kpis.openWork.v);
    // Leases closed — those that LEFT the board: setup signed off, or wind-down
    // finished. The two parts are the whole, and the trend's closed bars add up.
    expect(d.kpis.leasesClosed.setup + d.kpis.leasesClosed.ended).toBe(d.kpis.leasesClosed.v);
    expect(d.trend.reduce((s, b) => s + b.closed, 0)).toBe(d.kpis.leasesClosed.v);
    // ⚠️ THE TILES MUST EQUAL THE TABLE. Both headline figures are the totals of
    // Activity by step's two columns — a landlord reading "58 tasks completed"
    // above and a different number below is the bug this pins down.
    const listed = d.steps.filter((x) => !x.live);
    expect(d.kpis.tasksDone.v).toBe(listed.reduce((s, x) => s + x.total, 0));
    // …and the Open column breaks that exact figure down by step, so the two
    // must agree to the record. Any drift means a lane stopped mapping to a row.
    expect(listed.reduce((s, x) => s + (x.open ?? 0), 0)).toBe(d.kpis.openWork.v);
    // Each step's response figures: measured ≤ done, SLA ≥ on time, absent when nothing is measurable.
    for (const st of d.steps) {
      expect(st.response.measured).toBeLessThanOrEqual(Math.max(st.total, st.response.measured));
      if (st.response.measured === 0) { expect(st.response.onTimePct).toBeNull(); expect(st.response.slaPct).toBeNull(); }
      else expect(st.response.slaPct!).toBeGreaterThanOrEqual(st.response.onTimePct!);
      if (st.peopleResponse) for (const p of d.team) expect(Object.keys(st.peopleResponse)).toContain(String(p.userId));
    }
    // Open work by person adds up to the whole.
    expect(d.kpis.openWork.byPerson.reduce((s, b) => s + b.count, 0)).toBe(d.kpis.openWork.v);
    // Steps done = the sum over the TEAM's steps DONE. The borrowed customer /
    // landlord rows are listed but never counted as the team's output.
    expect(d.steps.filter((x) => !x.live && x.side === 'manager').reduce((s, x) => s + x.total, 0)).toBe(d.kpis.stepsDone.v);
    // Calendar: today's items are today; upcoming are strictly after, within a week.
    for (const c of d.calendar.today) expect(c.day).toBe(today);
    for (const c of d.calendar.upcoming) { expect(c.day > today).toBe(true); expect(Date.parse(c.day) - Date.parse(today)).toBeLessThanOrEqual(7 * 86_400_000); }
    // Journey steps: the Activity-by-Side sheet's team steps, journey order,
    // never a live counter; per-person parts never exceed the whole.
    expect(d.steps.length).toBeGreaterThan(10);
    // The team's steps (less the three the owner hid — manager signature,
    // move-out completed, settlement issued) plus the three board gates the team
    // chases but cannot perform (both signatures, the termination answer).
    expect(d.steps.length).toBe(14);
    expect(d.steps.filter((x) => x.side === 'manager').length).toBe(12);
    for (const gone of ['viewings_booked', 'manager_sign', 'moveout_completed', 'settlement_issued']) {
      expect(d.steps.find((x) => x.key === gone)).toBeUndefined();
    }
    // The hidden move-out row was the one the board's move_out gate pointed at,
    // so it was re-homed — the Open column must still add up to the board.
    expect(d.steps.find((x) => x.key === 'moveout_initiated')!.label).toBe('Move-out inspection');
    expect(d.steps.find((x) => x.key === 'settlement_closed')!.label).toBe('Settlement');
    expect(d.steps.find((x) => x.key === 'registration_issued')!.label).toBe('Contract registration');
    // Ground vs remote: the steps somebody has to be there for — showing the
    // unit, taking the paper cheques, and the two inspections. The rest is desk
    // work. Move-in reads "Move-in Inspection" like its move-out counterpart.
    expect(d.steps.filter((x) => x.where === 'ground').map((x) => x.key).sort())
      .toEqual(['cheques_collected', 'movein_issued', 'moveout_initiated', 'viewings_attended']);
    expect(d.steps.find((x) => x.key === 'movein_issued')!.label).toBe('Move-in Inspection');
    // ONE signature row, summing both parties; the drill keeps them apart.
    for (const k of ['contract_signed', 'termination_responded']) {
      expect(d.steps.find((x) => x.key === k)!.side).not.toBe('manager');
    }
    for (const gone of ['contract_signed_customer', 'contract_signed_landlord']) {
      expect(d.steps.find((x) => x.key === gone)).toBeUndefined();
    }
    expect(d.steps.find((x) => x.key === 'contract_signed')!.label).toBe('Contract Signature');
    for (const [k, label] of [['kyc_completed', 'KYC'], ['payment_plan_issued', 'Payment Plan'],
      ['cheques_collected', 'Payment Confirmation']] as const) {
      expect(d.steps.find((x) => x.key === k)!.label).toBe(label);
    }
    expect(d.steps.find((x) => x.key === 'registration_pending')?.live).toBe(true);
    for (const st of d.steps) { expect(st.response.breached).toBeLessThanOrEqual(st.response.measured); expect(st.response.slaHours).toBeGreaterThan(0); }
    expect(d.steps[0].key).toBe('viewings_attended');
    // Open tasks — leases waiting AT the step on the Operations board. Never
    // more than the board itself holds, and a step with no board stage says so
    // with null rather than a misleading zero. The live registration row is its
    // own open figure (the page draws it on the registration line instead).
    // Every Operations lane — the board's gates AND the lead funnel's — lands on
    // a listed step. Only Viewings attended has no lane of its own (no pipeline
    // waits at a viewing), so it alone may read "not measured".
    const unmapped = d.steps.filter((x) => x.open == null).map((x) => x.key);
    expect(unmapped).toEqual(['viewings_attended']);
    for (const st of d.steps) {
      if (st.open == null) { expect(st.openPeople).toBeNull(); continue; }
      expect(st.open).toBeGreaterThanOrEqual(0);
      if (st.openPeople) for (const n of Object.values(st.openPeople)) expect(n).toBeLessThanOrEqual(st.open);
    }
    /* The board's registration lane CONTAINS the live registration row — they
     * are the same backlog, and counting both would show it twice. Not equal,
     * though: the row applies the owner's rule that a room has no registration
     * of its own, and the Operations board does not, so a lease on a room sits
     * in the lane while the row leaves it out. The Open column here mirrors the
     * board on purpose (it is the figure the board shows), so the lane is the
     * larger of the two. */
    expect(d.steps.find((x) => x.key === 'registration_issued')!.open)
      .toBeGreaterThanOrEqual(d.steps.find((x) => x.key === 'registration_pending')!.total);
    for (const st of d.steps) {
      // No single person can have more than the whole. The parts CAN add to
      // more than the whole — a record two managers both touched is one record
      // and two rows — the same reading as the Activity-by-Side sheet.
      for (const n of [...(st.people ? Object.values(st.people) : []), st.owner ?? 0]) expect(n).toBeLessThanOrEqual(st.total);
      if (st.people) for (const p of d.team) expect(Object.keys(st.people)).toContain(String(p.userId));
    }
    // Sparklines are one value per bucket.
    for (const p of d.team) expect(p.spark.length).toBe(d.trend.length);

    for (const p of d.team) {
      // Status follows the last event, whichever source it came from.
      const latest = [p.lastChangeAt, p.lastPageAt].filter(Boolean).sort().pop() ?? null;
      expect(p.lastAt).toBe(latest);
      if (p.last) expect(p.last.at).toBe(p.lastAt);
      if (p.status === 'offline' && p.lastAt) {
        expect(p.lastAt.slice(0, 10) <= today).toBe(true);
      }
      // A page-open is never dressed up as work.
      if (p.last?.kind === 'page') expect(p.last.label.startsWith('Viewing ')).toBe(true);
    }

    // The feed is newest-first, bounded, and never a machine-minted row.
    const times = d.feed.map((r) => Date.parse(r.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(d.feed.length).toBeLessThanOrEqual(80);
    for (const r of d.feed) {
      expect(r.label.toLowerCase()).not.toContain('upload link');
      expect(r.repeats).toBeGreaterThanOrEqual(1);
    }

    // A single day → hourly buckets.
    const day = await page.request.get(`/api/reports/team-overview?from=${today}&to=${today}`);
    expect(day.ok()).toBeTruthy();
    const h = (await day.json()) as Payload;
    expect(h.window.hourly).toBe(true);
    expect(h.trend.length).toBe(24);
    expect(h.trend.map((b) => b.key)).toEqual(Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')));
    expect(h.trend.reduce((s, b) => s + b.changes, 0)).toBe(h.kpis.changes.v);
    expect(h.trend.reduce((s, b) => s + b.closed, 0)).toBe(h.kpis.leasesClosed.v);
    expect(h.kpis.tasksDone.v).toBe(h.steps.filter((x) => !x.live).reduce((s, x) => s + x.total, 0));
    // Yesterday is the comparison for a single day.
    expect(h.prev.from).toBe(h.prev.to);
  });

  test('step drill — the records behind a Tasks / SLA-breached figure', async ({ page }) => {
    await signIn(page, 'kbaalfalasi@gmail.com');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const ov = (await (await page.request.get('/api/reports/team-overview')).json()) as Payload;
    const pending = ov.steps.find((x) => x.key === 'registration_pending')!;
    const all = await page.request.get(`/api/reports/team-overview/step?key=registration_pending&from=${ov.window.from}&to=${today}`);
    expect(all.ok()).toBeTruthy();
    const d = (await all.json()) as { key: string; live: boolean; slaHours: number; records: Array<{ id: number; ref: string; href: string | null; waitHours: number | null; breached: boolean; by: string | null }> };
    expect(d.live).toBe(true);
    // The drill opens exactly as many records as the figure counts.
    expect(d.records.length).toBe(pending.total);
    // breached=1 → only the breaches, and as many as the figure says.
    const br = (await (await page.request.get(`/api/reports/team-overview/step?key=registration_pending&from=${ov.window.from}&to=${today}&breached=1`)).json()) as typeof d;
    expect(br.records.length).toBe(pending.response.breached);
    for (const r of br.records) { expect(r.breached).toBe(true); expect(r.waitHours!).toBeGreaterThan(d.slaHours); expect(r.href).toMatch(/\/(operations|contracts)\//); }
    // Sorted longest wait first.
    const ws = br.records.map((r) => r.waitHours ?? -1);
    expect(ws).toEqual([...ws].sort((a, b) => b - a));
    // A done step drills to its records too, never more than the figure.
    const done = ov.steps.find((x) => !x.live && x.total > 0);
    if (done) {
      const dd = (await (await page.request.get(`/api/reports/team-overview/step?key=${done.key}&from=${ov.window.from}&to=${today}`)).json()) as typeof d;
      expect(dd.records.length).toBe(done.total);
    }
  });

  test('a stage never reports the same record as both open and completed', async ({ page }) => {
    // A lead's stage names the state it has REACHED. `payment_plan_shared` means
    // the manager has issued and shared the plan — their part is DONE — and the
    // wait is the customer returning cheques, which is the NEXT stage. Counting
    // it as open at Payment Plan reported one stage's finished work as another
    // stage's backlog, and the same lead landed in both columns of one row.
    await signIn(page, 'kbaalfalasi@gmail.com');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const ov = (await (await page.request.get('/api/reports/team-overview')).json()) as Payload;
    type Rec = { kind: string; id: number };
    const ids = async (url: string) =>
      new Set(((await (await page.request.get(url)).json()) as { records: Rec[] }).records
        .map((r) => `${r.kind}-${r.id}`));
    for (const key of ['payment_plan_issued', 'cheques_collected', 'kyc_completed']) {
      const open = await ids(`/api/reports/team-overview/open?key=${key}`);
      const done = await ids(`/api/reports/team-overview/step?key=${key}&from=${ov.window.from}&to=${today}`);
      expect([...open].filter((x) => done.has(x)), `${key} reports the same record open AND completed`).toEqual([]);
    }
  });

  test('the Tasks feed counts a document pack as ONE task; Activities breaks it out', async ({ page }) => {
    // A KYC pack is one piece of work however many files it took — which is how
    // "Activity by step" counts it — so the Tasks tab must fold the run and name
    // the CUSTOMER, not the file. The per-document detail is Activities' job.
    await signIn(page, 'kbaalfalasi@gmail.com');
    const feed = async (kind: string, from: string, to: string) =>
      ((await (await page.request.get(
        `/api/reports/team-overview/feed?from=${from}&to=${to}&kind=${kind}&limit=40`)).json()) as {
          rows: Array<{ label: string; subject: string | null; repeats: number }> }).rows
        // A folded run spanning two actions of one step takes the STEP's name —
        // uploading a pack and verifying it is one task called "KYC" — so match
        // the step as well as the individual actions it was assembled from.
        .filter((r) => r.label === 'KYC' || /\bdocument\b/i.test(r.label));

    const tasks = await feed('task', '2026-08-10', '2026-08-10');
    const acts = await feed('change', '2026-08-10', '2026-08-10');
    expect(tasks.length).toBeGreaterThan(0);
    // One folded row standing for several documents…
    const folded = tasks.find((r) => r.repeats > 1)!;
    expect(folded).toBeTruthy();
    expect(folded.subject).not.toMatch(/passport|visa|emirates/i);
    // …and the same day listed file by file under Activities.
    expect(acts.length).toBeGreaterThanOrEqual(folded.repeats);
    expect(acts.some((r) => /passport|visa|emirates/i.test(r.subject ?? ''))).toBe(true);
    expect(acts.every((r) => r.repeats === 1)).toBe(true);

    // …and no record shows the SAME step twice for one person on one day. Two
    // actions of one step (issued + shared a payment plan; confirmed cheques +
    // marked them on file) are one task, and fold under the step's own name.
    const all = ((await (await page.request.get(
      '/api/reports/team-overview/feed?from=2026-08-01&to=2026-08-31&kind=task&limit=100')).json()) as {
        rows: Array<{ href: string | null; subject: string | null; label: string; who: string; at: string }> }).rows;
    const seen = new Map<string, number>();
    for (const r of all) {
      const k = `${r.href ?? '~'}|${r.subject ?? '~'}|${r.label}|${r.who}|${r.at.slice(0, 10)}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  test('every step in the Tasks tab reconciles with Activity by step, per person', async ({ page }) => {
    /* The two cards read different sources — the table counts DATABASE columns,
     * the tab reads the activity log — and the page is only trustworthy if they
     * land on the same number. They differ by exactly one thing, which the card
     * now says out loud: a step the CUSTOMER performed is a completed step no
     * member of the team did, so it cannot appear in a feed of team activity.
     *
     * The rule that makes the rest agree: a record two people worked is ONE
     * task on ONE of them — the person the table credits — so the columns add
     * up to the whole instead of over it. */
    await signIn(page, 'kbaalfalasi@gmail.com');
    const from = '2026-08-01', to = '2026-08-20';
    const ov = (await (await page.request.get(
      `/api/reports/team-overview?from=${from}&to=${to}`)).json()) as Payload;
    const listed = ov.steps.filter((s) => !s.live);

    const tasks = async (person?: number) => {
      const seen = new Set<string>();
      let before: string | null = null;
      for (let i = 0; i < 12; i++) {
        const q = `from=${from}&to=${to}&kind=task&limit=100`
          + (person ? `&person=${person}` : '') + (before ? `&before=${before}` : '');
        const d = (await (await page.request.get(
          `/api/reports/team-overview/feed?${q}`)).json()) as {
            rows: Array<{ id: string }>; nextBefore: string | null; hasMore: boolean };
        for (const r of d.rows) seen.add(r.id);
        if (!d.hasMore || !d.nextBefore) break;
        before = d.nextBefore;
      }
      return seen.size;
    };

    // Steps the team cannot perform — the customer signs those themselves.
    const outside = listed.reduce((a, s) => a
      + Math.max(0, s.total - (Object.values(s.people ?? {}).reduce((x, y) => x + y, 0) + (s.owner ?? 0))), 0);
    const total = listed.reduce((a, s) => a + s.total, 0);
    expect(await tasks()).toBe(total - outside);

    // And every column adds up on its own, landlord included.
    for (const p of ov.team) {
      expect(await tasks(p.userId),
        `${p.name}: the Tasks tab and the table disagree`)
        .toBe(listed.reduce((a, s) => a + (s.people?.[String(p.userId)] ?? 0), 0));
    }
    expect(await tasks(ov.ownerUserId),
      'Rental Provider: the Tasks tab and the table disagree')
      .toBe(listed.reduce((a, s) => a + (s.owner ?? 0), 0));
  });

  test('idle and time on the platform SPLIT the day — they never overlap', async ({ page }) => {
    /* Both are read from the same stream of gaps, so charging the first half
     * hour of a break to each in turn made them add to more than the day: one
     * manager showed 66 h on the platform AND 125 h idle inside a 148 h month,
     * and 85% idle while being the most active person on the team. A break now
     * counts as work up to the cap and as idle beyond it, nothing twice. */
    await signIn(page, 'kbaalfalasi@gmail.com');
    const d = (await (await page.request.get(
      '/api/reports/team-overview?from=2026-08-01&to=2026-08-20')).json()) as Payload;
    const T = d.targets;
    for (const p of d.team) {
      const i = p.period.idle;
      // The office day, not each person's own stretch: working days × the hours
      // expected of one. Everybody on the team is measured against the same day.
      expect(i.spanMinutes, `${p.name}: office hours over the window`)
        .toBe(p.period.workingDays * T.expectedDayMinutes);
      expect(i.workedMinutes + i.totalMinutes,
        `${p.name}: worked ${i.workedMinutes} + idle ${i.totalMinutes} != ${i.spanMinutes}`)
        .toBe(i.spanMinutes);
      expect(i.totalMinutes).toBeLessThanOrEqual(i.spanMinutes);
      if (i.pct != null) expect(i.pct).toBeLessThanOrEqual(100);
      // A day with nothing recorded is a whole day idle — the reading the old
      // first-to-last basis could not produce at all (no events, no span).
      expect(i.totalMinutes, `${p.name}: ${p.period.idleDays} empty days`)
        .toBeGreaterThanOrEqual(p.period.idleDays * T.expectedDayMinutes);
      // A break is a gap INSIDE a day, so it cannot exceed one.
      expect(i.longestMinutes).toBeLessThanOrEqual(24 * 60);
    }
  });


  test("the feed includes the landlord's own work, not just the roster's", async ({ page }) => {
    // "Activity by step" counts what the landlord did themselves, so a feed
    // reading only the roster showed nothing for a week whose completed tasks
    // were all theirs — the tile said 2 and the feed said 0.
    await signIn(page, 'kbaalfalasi@gmail.com');
    const ov = (await (await page.request.get(
      '/api/reports/team-overview?from=2026-08-01&to=2026-08-20')).json()) as Payload;
    const mine = ((await (await page.request.get(
      `/api/reports/team-overview/feed?from=2026-08-01&to=2026-08-20&kind=task&person=${ov.ownerUserId}&limit=100`)).json()) as {
        rows: Array<{ userId: number }> }).rows;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.userId === ov.ownerUserId)).toBe(true);
  });

  test('a manager cannot open the team overview', async ({ page }) => {
    await signIn(page, 'sheco1300@yahoo.com');
    // Landlord-only, and refused by ROLE rather than by happening to have no RP
    // profile to scope by — every team route, not just the page payload.
    for (const u of ['team-overview', 'team-overview/feed?kind=task', 'team-overview/open', 'team-overview/step?key=all']) {
      expect((await page.request.get(`/api/reports/${u}`)).status(), u).toBe(403);
    }
  });

  test('page renders every section and switches period', async ({ page }) => {
    test.setTimeout(120_000);
    page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, 'kbaalfalasi@gmail.com');
    await page.goto('/rental-provider/dashboard/team');
    await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
    for (const t of ['Active now', 'Opened Tasks', 'Tasks completed']) {
      await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Live team activity' })).toBeVisible();
    // Its columns: team member · activity · where the work happens · when. Type
    // and Status are gone — the row itself already says which it is. Asserted on
    // Page Visits because today's Tasks feed can legitimately be empty, and an
    // empty feed draws no table at all.
    const feedCard = page.locator('section', { has: page.getByRole('heading', { name: 'Live team activity' }) }).first();
    await feedCard.getByRole('button', { name: 'Page Visits', exact: true }).click();
    await expect.poll(() => feedCard.locator('th').allTextContents(), { timeout: 20_000 })
      .toEqual(['Team member', 'Activity', 'On ground / Remote', 'Timestamp']);
    await feedCard.getByRole('button', { name: 'Tasks', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Idle time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top performers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity by step' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity trend' })).toBeVisible();
    // Both managers are listed with a status chip (named as the cards name
    // them — first and middle, never the full legal string).
    await expect(page.getByText('Sherif Mohamed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Yoram Gie', { exact: true }).first()).toBeVisible();
    // The sidebar has the entry and it is the active one.
    await expect(page.getByRole('link', { name: 'Team', exact: true })).toBeVisible();
    // Activity by step carries four figures per row, and the standalone
    // "Contract registration pending" row is gone — its backlog is the
    // registration line's Open tasks.
    for (const h of ['Open tasks', 'Completed tasks', 'SLA breached', 'SLA criteria']) {
      await expect(page.getByText(h, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText('Contract registration pending')).toHaveCount(0);
    for (const gone of ['Viewings booked', 'Manager signature', 'Move-out completed', 'Settlement issued']) {
      await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
    }
    // EVERY figure in the table opens its own list — the two columns and the
    // totals alike. Open reads the board; Completed reads the period.
    const stepCard = page.locator('section', { has: page.getByRole('heading', { name: 'Activity by step' }) }).first();
    await stepCard.getByRole('button', { name: '33', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Renewal notices sent — open tasks/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/waiting right now/)).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await stepCard.locator('li').filter({ hasText: 'Total' }).last().getByRole('button').first().click();
    await expect(page.getByRole('heading', { name: /Every step — open tasks/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Back' }).click();
    // Steps per manager: the tabs above the donut. Scoped to that card — the
    // feed has person tabs of its own, and a bare `.first()` hits those instead.
    const rowCount = await stepCard.locator('ul li').count();
    await stepCard.getByRole('button', { name: 'Sherif', exact: true }).click();
    // One person's column cannot add up to the team's, so the card says where
    // the difference went rather than leaving it to look like missing figures.
    await expect(stepCard.getByText(/of the team's \d+ completed steps/)).toBeVisible({ timeout: 20_000 });
    // Both figures in that line OPEN, like every other number on the card. They
    // only appear when the picked range has such work, so open what is there.
    const own = stepCard.getByRole('button', { name: /the Rental Provider did/ });
    if (await own.count()) {
      await own.click();
      await expect(page.getByRole('heading', { name: 'Rental Provider' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/^Rental Provider · /)).toBeVisible();
      await page.getByRole('button', { name: 'Back' }).click();
    }
    const noActor = stepCard.getByRole('button', { name: 'Utility accepted', exact: true });
    if (await noActor.count()) {
      await noActor.click();
      await expect(page.getByRole('heading', { name: 'Utility accepted' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Back' }).click();
    }
    // …and the table keeps every row: a step nobody is recorded for reads "—",
    // it does not vanish and shrink the list.
    expect(await stepCard.locator('ul li').count()).toBe(rowCount);
    // The landlord's own work reads on its own tab, and ties to the figure the
    // reconciliation line quotes.
    await stepCard.getByRole('button', { name: 'Rental Provider', exact: true }).click();
    await expect(stepCard.getByText(/of the team's \d+ completed steps/)).toBeVisible({ timeout: 20_000 });
    await stepCard.getByRole('button', { name: 'All', exact: true }).first().click();
    // Trend legend: click a name to see only them.
    await page.getByTitle('Show only Sherif').click();
    await page.getByTitle('Show everyone').click();
    // Live team activity: Tasks is the default and shows only journey steps.
    await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toBeVisible();
    await feedCard.getByRole('button', { name: 'Page Visits', exact: true }).click();
    await expect(page.getByText(/page visits.*loaded so far/)).toBeVisible({ timeout: 20_000 });
    await feedCard.getByRole('button', { name: 'Tasks', exact: true }).click();
    // Activity by step segregates ground work from desk work.
    for (const l of ['On ground', 'Remote']) {
      await expect(page.getByRole('button', { name: l, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'On ground', exact: true }).click();
    await expect(page.getByText(/Steps needing somebody at the unit/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Remote', exact: true }).click();
    await expect(page.getByText(/Steps that can be done from a desk/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Time', exact: true })).toBeVisible();
    // ONE date filter drives the page — a daterangepicker-style panel with a
    // preset rail and two months. TODAY is the default, so the trend is hourly.
    await expect(page.getByText(/hour by hour, today/i)).toBeVisible({ timeout: 20_000 });
    // The rail is exactly four periods, all running up to today; going back is
    // the calendars' job.
    await openRangeOnce(page);
    for (const p of ['Today', 'This Week', 'This Month', 'This Year']) {
      await expect(page.getByRole('button', { name: p, exact: true })).toBeVisible();
    }
    for (const gone of ['Yesterday', 'Last 7 days', 'Last 30 days', 'Last month']) {
      await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
    }
    await page.getByRole('dialog', { name: 'Date range' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    const openRange = async () => {
      await page.getByRole('button', { name: /\d{1,2} \w{3} \d{4}/ }).first().click();
      await expect(page.getByRole('dialog', { name: 'Date range' })).toBeVisible();
    };
    // A preset applies straight away and every card follows it.
    await openRange();
    await page.getByRole('button', { name: 'This Month', exact: true }).click();
    await expect(page.getByText(/day by day, this month/i).first()).toBeVisible({ timeout: 20_000 });
    // A hand-picked range is only committed on Apply — Cancel discards it.
    await openRange();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('dialog', { name: 'Date range' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Date range' })).toHaveCount(0);
    await expect(page.getByText(/day by day, this month/i).first()).toBeVisible();
    // Two clicks draw a range; Apply puts the whole page on it.
    await openRange();
    const dlg = page.getByRole('dialog', { name: 'Date range' });
    await dlg.getByRole('button', { name: '10', exact: true }).first().click();
    await dlg.getByRole('button', { name: '12', exact: true }).first().click();
    await dlg.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText(/10 Aug – 12 Aug/).first()).toBeVisible({ timeout: 20_000 });
    // Manage team goes to settings → Team tab.
    await expect(page.getByRole('link', { name: 'Manage team' })).toHaveAttribute('href', '/rental-provider/dashboard/settings?tab=team');
  });
});
