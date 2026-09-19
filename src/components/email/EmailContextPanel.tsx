'use client';

/**
 * "About this conversation" — who it is with as the platform knows them (their
 * units and leases, the lead's stage, the vendor), everyone on the trail by the
 * side they are on, and every file in it in one place. A conversation nobody
 * owns yet can be filed under the right person by hand — every other email from
 * that address follows, now and later.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, ExternalLink, Link2, Loader2, Search, Unlink, X } from 'lucide-react';
import { emailApi, errorText, type EmailPerson, type EmailRecipient, type EmailSide, type EmailThreadDetail, type Rp } from '@/lib/emailApi';
import { Avatar, FileCard, KindChip } from './EmailBits';

const STATUS_TONE: Record<string, string> = {
  active: 'text-[#1a7a5a] bg-[#eef9f4]', expired: 'text-[#6b6860] bg-[#f4f3ef]', terminated: 'text-[#b42318] bg-red-50',
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const words = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const SIDE_TITLE: Record<EmailSide, string> = { theirs: 'Their side', team: 'Your team', copied: 'Kept in copy' };
const H3 = 'text-[11px] font-semibold uppercase tracking-wide text-[#9b9890] mb-2';

function PersonLine({ p, total }: { p: EmailPerson; total: number }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar name={p.name} tone={p.side === 'theirs' ? 'record' : 'other'} size={30} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-[#1a1916] truncate">{p.name ?? p.email}</div>
        <div className="text-[11px] text-[#9b9890] truncate">{p.name ? `${p.email} · ` : ''}{p.wrote > 0 ? `wrote ${p.wrote}` : `on ${p.emails} of ${total}`}</div>
      </div>
    </div>
  );
}

export function EmailContextPanel({ rp, isManager, thread, onClose, onLinked }: {
  rp: Rp; isManager: boolean; thread: EmailThreadDetail; onClose: () => void; onLinked: (next: EmailThreadDetail) => void;
}) {
  const base = isManager ? '/dashboard/manager' : '/rental-provider/dashboard';
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<EmailRecipient[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linking) return;
    const t = window.setTimeout(() => { emailApi.recipients(rp, q).then(setHits).catch(() => setHits([])); }, 200);
    return () => window.clearTimeout(t);
  }, [linking, q, rp]);

  const link = async (to: { kind: 'customer' | 'lead' | 'vendor' | 'none'; id?: number }) => {
    setBusy(true); setError(null);
    try { onLinked(await emailApi.link(rp, thread.id, to)); setLinking(false); setQ(''); }
    catch (e) { setError(errorText(e, 'Could not file this conversation')); } finally { setBusy(false); }
  };

  const recordHref = thread.tenantId ? `${base}/tenants/${thread.tenantId}` : thread.leadId ? `${base}/leads/${thread.leadId}` : thread.vendorId ? `${base}/vendors/${thread.vendorId}` : null;
  const sides = (['theirs', 'team', 'copied'] as EmailSide[]).map((s) => ({ side: s, people: thread.people.filter((p) => p.side === s) })).filter((g) => g.people.length);

  return (
    <aside className="h-full flex flex-col bg-white w-full" aria-label="About this conversation">
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-[#e8e6e0] shrink-0">
        <span className="text-sm font-semibold text-[#1a1916] flex-1">About this conversation</span>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-full text-[#6b6860] hover:bg-[#f4f3ef] cursor-pointer"><X size={15} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5 text-sm">
        <section>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-[#1a1916] break-words">{thread.recordName ?? thread.counterpartName ?? thread.counterpartEmail}</span>
            <KindChip kind={thread.kind} />
          </div>
          <div className="text-xs text-[#6b6860] mt-1 break-all">{thread.counterpartEmail}</div>
          {recordHref && <Link href={recordHref} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#1a7a5a] hover:underline">Open the {thread.kind} <ExternalLink size={13} /></Link>}
        </section>

        {thread.kind === 'customer' && (
          <section>
            <h3 className={H3}>Units and leases</h3>
            {thread.contracts.length === 0 && <p className="text-xs text-[#9b9890]">No lease on record.</p>}
            <div className="space-y-2">
              {thread.contracts.map((k) => (
                <Link key={k.id} href={`${base}/operations/${k.id}`} className="block rounded-xl border border-[#e8e6e0] hover:border-[#2e9f82] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Building2 size={14} className="text-[#6b6860] shrink-0" />
                    <span className="font-semibold text-[#1a1916] truncate flex-1">{k.unitNumber}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-px ${STATUS_TONE[k.status] ?? 'text-[#8a6d1d] bg-[#fdf3e3]'}`}>{words(k.status)}</span>
                  </div>
                  <div className="text-xs text-[#6b6860] mt-0.5 truncate">{k.buildingName}</div>
                  <div className="text-xs text-[#6b6860] tabular-nums">{day(k.startDate)} → {day(k.endDate)}</div>
                </Link>
              ))}
            </div>
          </section>
        )}
        {thread.lead && (
          <section>
            <h3 className={H3}>Lead</h3>
            <div className="rounded-xl border border-[#e8e6e0] px-3 py-2.5 text-xs text-[#6b6860]">
              <div className="text-sm font-semibold text-[#1a1916]">{words(thread.lead.stage || 'new')}</div>
              {thread.lead.unitNumber && <div className="mt-0.5">{thread.lead.unitNumber}{thread.lead.buildingName ? ` · ${thread.lead.buildingName}` : ''}</div>}
            </div>
          </section>
        )}

        {sides.length > 0 && (
          <section>
            <h3 className={H3}>People on this trail</h3>
            <div className="space-y-3">
              {sides.map((g) => (
                <div key={g.side}>
                  <div className="text-[11px] font-medium text-[#6b6860] mb-1.5">{SIDE_TITLE[g.side]}</div>
                  <div className="space-y-2">{g.people.map((p) => <PersonLine key={p.email} p={p} total={thread.totalMessages} />)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {thread.files.length > 0 && (
          <section>
            <h3 className={H3}>Files on this trail · {thread.files.length}</h3>
            <div className="space-y-1.5">
              {thread.files.map((f) => <FileCard key={f.id} rp={rp} file={f} compact sub={`${f.direction === 'out' ? 'sent' : 'received'} ${new Date(f.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`} />)}
            </div>
          </section>
        )}

        {!isManager && (
          <section>
            <h3 className={H3}>Filed under</h3>
            {!linking ? (
              <div className="space-y-2">
                <p className="text-xs text-[#6b6860]">
                  {thread.kind === 'other'
                    ? 'Nobody yet — this address is on no customer, lead or vendor. File it under the right one and every email from this address follows.'
                    : `${thread.recordName ?? 'A record'}. If this address belongs to someone else, file it under them instead.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setLinking(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#e8e6e0] text-[#1a1916] hover:border-[#2e9f82] cursor-pointer"><Link2 size={13} /> {thread.kind === 'other' ? 'File under…' : 'File under someone else…'}</button>
                  {thread.kind !== 'other' && <button type="button" disabled={busy} onClick={() => void link({ kind: 'none' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[#e8e6e0] text-[#6b6860] hover:border-[#b42318] hover:text-[#b42318] cursor-pointer disabled:opacity-60"><Unlink size={13} /> Move to Other</button>}
                </div>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a customer, lead or vendor" className="w-full border border-[#e8e6e0] rounded-lg pl-8 pr-8 py-2 text-xs focus:outline-none focus:border-[#2e9f82]" />
                  <button type="button" aria-label="Cancel" onClick={() => { setLinking(false); setQ(''); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-[#6b6860] hover:bg-[#f4f3ef] cursor-pointer"><X size={13} /></button>
                </div>
                <div className="mt-1.5 border border-[#e8e6e0] rounded-lg divide-y divide-[#f0eee9] max-h-60 overflow-y-auto">
                  {hits.length === 0 && <div className="px-3 py-3 text-xs text-[#9b9890]">Nobody matches.</div>}
                  {hits.map((h) => (
                    <button key={`${h.kind}-${h.tenantId ?? h.leadId ?? h.vendorId}`} type="button" disabled={busy}
                      onClick={() => void link({ kind: h.kind, id: (h.tenantId ?? h.leadId ?? h.vendorId)! })}
                      className="w-full text-left px-3 py-2 hover:bg-[#f4f3ef] cursor-pointer flex items-center gap-2 disabled:opacity-60">
                      <span className="min-w-0 flex-1"><span className="block text-xs text-[#1a1916] truncate">{h.name}</span><span className="block text-[11px] text-[#9b9890] truncate">{h.email}</span></span>
                      <KindChip kind={h.kind} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {busy && <div className="mt-2 text-xs text-[#6b6860] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Filing…</div>}
            {error && <div className="mt-2 text-xs text-[#b42318]">{error}</div>}
          </section>
        )}
      </div>
    </aside>
  );
}
