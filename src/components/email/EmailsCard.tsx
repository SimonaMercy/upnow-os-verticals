'use client';

/**
 * The "Emails" section on a customer's, a lead's or a vendor's page: every
 * conversation with that one person, a button to write a new email, and a
 * slide-over to read and answer one.
 *
 * A manager without the landlord's "Email customers and leads" authority gets
 * nothing here (the API answers 403 and the card does not render).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, Plus } from 'lucide-react';
import { useSlideOver } from '@/lib/useSlideOver';
import { emailApi, type EmailThreadRow, type MailboxInfo, type Rp } from '@/lib/emailApi';
import { EmailComposer, type ComposeTo } from './EmailComposer';
import { EmailThreadView } from './EmailThreadView';
import { EmailPager } from './EmailPager';
import { EmailRow } from './EmailBits';

/** On a lease or customer page the emails are one section among many: the latest few, the rest on request. */
const PREVIEW = 5;
const PAGE_SIZE = 10;

function ThreadSlideOver({ rp, threadId, canSend, isManager, onClose, onChanged }: { rp: Rp; threadId: number; canSend: boolean; isManager: boolean; onClose: () => void; onChanged: () => void }) {
  const { closing, dismiss } = useSlideOver(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);
  return (
    <div className="fixed inset-0 z-50">
      <div className={`slideover-scrim${closing ? ' closing' : ''} absolute inset-0 bg-black/40`} onClick={dismiss} />
      <div className={`slideover-panel${closing ? ' closing' : ''} absolute right-0 top-0 h-full w-full max-w-[860px] bg-white shadow-2xl flex flex-col`}>
        <div className="px-3 pt-3"><button type="button" onClick={dismiss} aria-label="Back" className="p-1.5 rounded-lg hover:bg-[#f4f3ef] cursor-pointer text-[#6b6860]"><ArrowLeft size={18} /></button></div>
        <div className="flex-1 min-h-0"><EmailThreadView key={threadId} rp={rp} threadId={threadId} canSend={canSend} isManager={isManager} onChanged={onChanged} /></div>
      </div>
    </div>
  );
}

export function EmailsCard({ rp, tenantId, leadId, vendorId, to, isManager = false }: {
  rp: Rp;
  tenantId?: number | null;
  leadId?: number | null;
  vendorId?: number | null;
  /** Who a new email goes to. No usable address = the button explains why. */
  to: ComposeTo | null;
  isManager?: boolean;
}) {
  const [mailbox, setMailbox] = useState<MailboxInfo | null>(null);
  const [threads, setThreads] = useState<EmailThreadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [composing, setComposing] = useState(false);
  const [openThread, setOpenThread] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([emailApi.mailbox(rp), emailApi.threads(rp, { tenantId, leadId, vendorId, page: showAll ? page : 1, pageSize: showAll ? PAGE_SIZE : PREVIEW })]);
      setMailbox(m); setThreads(t.items); setTotal(t.total);
    } catch (e) {
      // 403: a manager without the authority. 400: a manager on "All landlords".
      if ([400, 403].includes((e as { status?: number }).status ?? 0)) setHidden(true);
    }
  }, [rp, tenantId, leadId, vendorId, page, showAll]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
      // A reply may be waiting in the mailbox: check it, then show what arrived.
      emailApi.sync(rp).then((r) => { if (r.imported > 0) void load(); }).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(t);
  }, [load, rp]);

  if (hidden || !mailbox) return null;
  const canSend = mailbox.connected && mailbox.enabled && mailbox.canSend;
  const settingsHref = '/rental-provider/dashboard/settings?tab=email';

  return (
    // min-w-0 / max-w-full: inside a flex or grid column the long one-line
    // preview would otherwise set the card's width and stretch the whole page.
    <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm p-5 min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-semibold text-[#1a1916] flex items-center gap-2 flex-1">
          <Mail size={16} className="text-[#2e9f82]" /> Emails <span className="font-normal text-[#9b9890]">({total.toLocaleString('en-GB')})</span>
        </h2>
        {canSend && to && (
          <button type="button" onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] cursor-pointer">
            <Plus size={14} /> New email
          </button>
        )}
      </div>

      {!mailbox.connected && (
        <p className="text-sm text-[#6b6860]">
          {isManager
            ? 'The landlord has not connected an email yet, so emails can’t be sent from here.'
            : <>Connect your email in <Link href={settingsHref} className="text-[#1a7a5a] font-semibold hover:underline">Settings → Email</Link> to write to this person from here and see their replies.</>}
        </p>
      )}
      {mailbox.connected && !to && <p className="text-sm text-[#6b6860] mb-2">No email address on file for this person.</p>}
      {mailbox.connected && threads.length === 0 && to && <p className="text-sm text-[#9b9890]">No emails yet.</p>}

      {threads.length > 0 && (
        <div className="divide-y divide-[#f0eee9] border border-[#f0eee9] rounded-xl overflow-hidden">
          {threads.map((t) => <EmailRow key={t.id} t={t} showWho={false} onOpen={() => setOpenThread(t.id)} />)}
          {showAll && <EmailPager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
          {total > PREVIEW && (
            <button type="button" onClick={() => { setShowAll((v) => !v); setPage(1); }}
              className="w-full px-4 py-2.5 text-xs font-medium text-[#1a7a5a] bg-[#fbfaf8] hover:bg-[#f4f3ef] cursor-pointer text-center">
              {showAll ? `Show only the latest ${PREVIEW}` : `Show all ${total.toLocaleString('en-GB')} conversations`}
            </button>
          )}
        </div>
      )}

      {composing && to && (
        <EmailComposer rp={rp} to={to} fromAddress={mailbox.emailAddress} mailboxes={mailbox.mailboxes ?? []} onClose={() => setComposing(false)} onSent={() => { void load(); }} />
      )}
      {openThread != null && (
        <ThreadSlideOver rp={rp} threadId={openThread} canSend={canSend} isManager={isManager} onClose={() => { setOpenThread(null); void load(); }} onChanged={() => { void load(); }} />
      )}
    </div>
  );
}

