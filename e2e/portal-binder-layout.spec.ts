/**
 * The landlord's no-login binder must be readable at whatever width the emailed
 * link is opened at.
 *
 * The two panes used to split from 769px up, which halves what each can hold —
 * and the rental pane's payment plan is a table. At 820px each pane was ~410px,
 * the plan card ran past its edge and the AMOUNT column was cut off the page:
 * a payment schedule with no amounts. The split now starts at 1100, measured
 * from where that table stops losing pixels (it still loses 6px at 1024).
 *
 * NOTE 390px is deliberately not asserted: the plan table carries a 380px
 * min-width and a phone's content box is narrower, so it scrolls inside its own
 * card. That is pre-existing behaviour of the shared plan component, not the
 * binder's layout, and wants its own change.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect } from '@playwright/test';

const TOKEN = '293cd3a03d82d03e530e217eb8d95b3ac618a2129c99ba80';
const URL = `/portal/${TOKEN}/contract/360`;

/** Widths a landlord actually opens this at: tablet, half a laptop screen, and up. */
const CASES: Array<{ width: number; columns: 1 | 2 }> = [
  { width: 820, columns: 1 },
  { width: 1024, columns: 1 },
  { width: 1100, columns: 2 },
  { width: 1440, columns: 2 },
];

for (const { width, columns } of CASES) {
  test(`portal binder at ${width}px reads in ${columns} column(s) with nothing cut off`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await expect(page.getByText('All documents')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30000 });

    const seen = await page.evaluate(() => {
      const panes = [...document.querySelectorAll('section')].filter(s => s.className.includes('pane'));
      const sideBySide = panes.length >= 2
        && Math.abs(panes[0].getBoundingClientRect().top - panes[1].getBoundingClientRect().top) < 2;
      // A table wider than the box it sits in is money behind a scrollbar.
      const clipped = [...document.querySelectorAll('table')]
        .map(t => ({ by: t.parentElement!.scrollWidth - t.parentElement!.clientWidth }))
        .filter(x => x.by > 1).map(x => `${x.by}px`);
      // …and nothing may run off the page itself.
      const vw = document.documentElement.clientWidth;
      const overflowing = [...document.querySelectorAll('section *')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; })
        .map(el => (el.textContent ?? '').trim().slice(0, 40));
      return { columns: sideBySide ? 2 : 1, clipped, overflowing: overflowing.slice(0, 3) };
    });

    expect(seen.columns, `pane count at ${width}px`).toBe(columns);
    expect(seen.clipped, `table clipped at ${width}px`).toEqual([]);
    expect(seen.overflowing, `content past the right edge at ${width}px`).toEqual([]);
  });
}
