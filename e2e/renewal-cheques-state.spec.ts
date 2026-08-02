/**
 * Pure state-machine check (no browser): the renewal Cheques step splits into
 * "do this" and "we're on it", mirroring how the new-lease flow splits
 * payment_review from awaiting_rp_confirm.
 *
 * Verified here rather than against a live space because the renewal fixture
 * advances as the RP works it — the rule is what matters, not one snapshot.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect } from '@playwright/test';
import { deriveStateKey, CUSTOMER_STATE_DEFS, type JourneyInput } from '../src/lib/customerJourney';

/** A renewal child mid-flight, with the running parent lease underneath. */
function input(renewalOverrides: Record<string, unknown>): JourneyInput {
  return {
    contract: { status: 'active', contractType: 'new', contractActive: true },
    renewalContract: {
      status: 'issued', contractType: 'renewal', contractActive: true,
      renewalAccepted: 'accepted', pdcConfirmed: false,
      ...renewalOverrides,
    },
    viewing: null, stage: null, paymentPlan: null,
    allRequiredDocsUploaded: true, docsSubmitted: true, myDocs: [],
  } as unknown as JourneyInput;
}

test('renewal cheques step splits on submission', () => {
  // Nothing handed over yet → the actionable step.
  expect(deriveStateKey(input({ tenantChequesSubmittedAt: null }))).toBe('renewal_cheques');

  // Handed over, RP hasn't collected → the waiting step.
  expect(deriveStateKey(input({ tenantChequesSubmittedAt: '2026-08-01T13:21:28.827Z' })))
    .toBe('renewal_cheques_review');

  // RP confirmed collection → the step is done either way, so submission must
  // NOT hold the journey back once pdcConfirmed is set.
  for (const submittedAt of [null, '2026-08-01T13:21:28.827Z']) {
    expect(deriveStateKey(input({ tenantChequesSubmittedAt: submittedAt, pdcConfirmed: true })))
      .not.toBe('renewal_cheques');
    expect(deriveStateKey(input({ tenantChequesSubmittedAt: submittedAt, pdcConfirmed: true })))
      .not.toBe('renewal_cheques_review');
  }
});

test('the waiting step reads as waiting, on the same stop of the rail', () => {
  const doing = CUSTOMER_STATE_DEFS.renewal_cheques;
  const waiting = CUSTOMER_STATE_DEFS.renewal_cheques_review;

  // Same stop — the split must not move the customer along the rail.
  expect(waiting.currentIndex).toBe(doing.currentIndex);
  expect(waiting.sub).toBe(doing.sub);
  expect(waiting.mode).toBe('renewal');

  // ...but it must stop telling them to act.
  expect(doing.tone).toBe('action');
  expect(waiting.tone).toBe('waiting');
  // The old copy pointed at a schedule that the submitted screen no longer shows.
  expect(waiting.body).not.toMatch(/schedule below/i);
  expect(waiting.timing).not.toMatch(/confirm/i);
});
