'use client';

/**
 * Email is checked when somebody is in the portal — and only then.
 *
 * Owner, 19 Sep 2026: "Keep it offline; when someone logs in then sync all the
 * emails." There is no server timer reading mailboxes while nobody is there.
 * The moment a landlord, or a team member allowed to read that landlord's
 * emails, arrives in the dashboard (a fresh login, or coming back the next
 * morning on the same session), every connected mailbox is read until nothing
 * is left — days of mail, however long that takes, in the background while they
 * work. After that it is looked at again every few minutes for as long as the
 * tab is open and visible.
 *
 * The server does the protecting: one reader per mailbox at a time, not more
 * often than once a minute, a bounded wait per call. A second tab, or a second
 * person, simply gets "nothing to do".
 */
import { useEffect } from 'react';
import { apiGet, apiPost } from '@/lib/api';

type Sync = { ran: boolean; imported: number; remaining: number; error?: string };
type MyRp = { rentalProviderId: number; permissions?: { canReadEmails?: boolean } };

/** Said out loud when mail came in, so the sidebar badge and an open Emails page can catch up. */
export const EMAILS_SYNCED_EVENT = 'upnow:emails-synced';

const WHILE_OPEN_MS = 5 * 60_000;
const MAX_ROUNDS = 80;

async function scopesOf(role: string): Promise<Array<number | null>> {
  if (role === 'rental_provider') return [null];
  if (role !== 'manager') return [];
  const rps = await apiGet<MyRp[]>('/manager/my-rps').catch(() => [] as MyRp[]);
  return (Array.isArray(rps) ? rps : []).filter((r) => r.permissions?.canReadEmails).map((r) => r.rentalProviderId);
}

async function readEverything(scopes: Array<number | null>, untilEmpty: boolean): Promise<number> {
  let brought = 0;
  for (const rp of scopes) {
    for (let round = 0; round < (untilEmpty ? MAX_ROUNDS : 1); round++) {
      const r = await apiPost<Sync>(`/email/sync${rp == null ? '' : `?rp=${rp}`}`, {}).catch(() => null);
      if (!r) break; // no mailbox, no authority, or the module is off: nothing to read
      brought += r.imported || 0;
      if (!r.ran || r.error || !r.remaining) break;
    }
  }
  return brought;
}

export function useEmailSyncOnLogin(role: string | null | undefined): void {
  useEffect(() => {
    if (role !== 'rental_provider' && role !== 'manager') return;
    let alive = true;
    let busy = false;
    const pass = async (untilEmpty: boolean) => {
      if (busy || !alive) return;
      busy = true;
      try {
        const brought = await readEverything(await scopesOf(role), untilEmpty);
        if (alive && brought > 0) window.dispatchEvent(new CustomEvent(EMAILS_SYNCED_EVENT, { detail: { brought } }));
      } finally { busy = false; }
    };
    // Arriving in the portal: everything that was missed while nobody was here.
    const first = window.setTimeout(() => { void pass(true); }, 1500);
    // Staying in it: a look every few minutes, only while the tab is being looked at.
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void pass(false); }, WHILE_OPEN_MS);
    return () => { alive = false; window.clearTimeout(first); window.clearInterval(timer); };
  }, [role]);
}
