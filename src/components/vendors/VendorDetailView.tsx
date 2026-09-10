'use client';
/**
 * One vendor — shared by the landlord page and the manager mirror.
 */

/**
 * RP → one vendor: a profile page in the same shape as the customer detail —
 * identity card with the record grid, a headline stat bar, then the vendor's
 * real records: AMC contracts, maintenance history, rates, technicians.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, ExternalLink, FileSignature, FileText, Pencil, TrendingUp, Wallet, Wrench, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
const url = (base: string, rp: number | null | undefined, path: string) => rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;

import { openDocViewer } from '@/lib/docViewer';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { KIND_META, chip, type VendorRow } from '@/components/vendors/VendorsListView';
import { VendorForm } from '@/components/vendors/VendorForm';

interface Tech { id: number; name: string; phone: string | null; status: string; isLeadCapable: boolean }
interface Cat { id: number; name: string; parentId: number | null }
interface AmcDoc { id: number; documentKey: string; displayName: string | null; fileUrl: string }
interface AmcRow {
  id: number; vendorId: number; contractType: string | null; startDate: string | null; endDate: string | null;
  status: string; propertyName: string | null; frequency: string | null;
  modeOfPayment: string | null; numberOfPayments: number | null;
  renewalOfId?: number | null; renewedById?: number | null; annualValueAed?: number | null;
  documents: AmcDoc[]; tasks: { total: number; done: number; pending: number };
}
interface MaintRow { id: number; ref: string; title: string; stage: string; closedAt: string | null; updatedAt: string; invoiceTotalAed: number | null; provider: { id: number } | null; unit: { unitNumber: string | null } | null; property: { buildingName: string | null } | null }

const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const aed = (n?: number | null) => n != null ? `AED ${Number(n).toLocaleString('en-AE')}` : '—';
const AMC_STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: '#dcfce7', fg: '#15803d', label: 'Active' },
  expiring: { bg: '#fef3c7', fg: '#b45309', label: 'Expiring soon' },
  expired: { bg: '#fee2e2', fg: '#b91c1c', label: 'Expired' },
  unknown: { bg: '#f4f3ef', fg: '#6b6860', label: 'No expiry' },
};
const STAGE_LABEL: Record<string, string> = {
  requested: 'Requested', awaiting_approval: 'Awaiting approval', in_progress: 'In progress',
  sign_off: 'Sign-off', close_out: 'Close-out', closed: 'Closed', declined: 'Declined', cancelled: 'Cancelled',
};

export function VendorDetailView({ spId, base = '/maintenance', amcBase = '/amc', rp = null, listHref, amcHref, amcDetailHrefOf, requestHrefOf }: {
  spId: number; base?: string; amcBase?: string; rp?: number | null;
  listHref: string; amcHref: string; amcDetailHrefOf: (id: number) => string; requestHrefOf: (id: number) => string;
}) {
  const router = useRouter();
  const id = spId;
  const [v, setV] = useState<VendorRow | null>(null);
  const [techs, setTechs] = useState<Tech[] | null>(null);
  const [groups, setGroups] = useState<Cat[]>([]);
  const [contracts, setContracts] = useState<AmcRow[]>([]);
  const [jobs, setJobs] = useState<MaintRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<{ url: string; emailSent: boolean; emailReason: string | null; vendorEmail: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiGet<VendorRow[]>(url(base, rp, '/vendors')),
      apiGet<Cat[]>(url(base, rp, '/categories')),
      apiGet<Tech[]>(url(base, rp, `/vendors/${id}/technicians`)).catch(() => []),
      apiGet<AmcRow[]>(url(amcBase, rp, '/contracts')).catch(() => []),
      apiGet<MaintRow[]>(url(base, rp, '/requests?scope=all')).catch(() => []),
    ]).then(([rows, cats, t, amc, reqs]) => {
      const mine = (Array.isArray(rows) ? rows : []).find(r => r.serviceProviderId === id) ?? null;
      setV(mine);
      if (!mine) setErr('Vendor not found.');
      setGroups((Array.isArray(cats) ? cats : []).filter(c => c.parentId == null));
      setTechs(Array.isArray(t) ? t : []);
      setContracts((Array.isArray(amc) ? amc : []).filter(c => c.vendorId === id));
      setJobs((Array.isArray(reqs) ? reqs : []).filter(r => r.provider?.id === id));
    }).catch(() => setErr('Could not load this vendor.'));
  }, [id, base, amcBase, rp]);
  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ inviteUrl: string; emailSent: boolean; emailReason?: string | null; vendorEmail?: string | null }>(url(base, rp, `/vendors/${id}/invite`));
      setInviteUrl({ url: r.inviteUrl, emailSent: r.emailSent, emailReason: r.emailReason ?? null, vendorEmail: r.vendorEmail ?? null }); load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send the invitation.'); }
    finally { setBusy(false); }
  };

  if (!v) return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href={listHref} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860]"><ArrowLeft size={14} /> Vendors</Link>
      <p className="text-sm text-[#9b9890] mt-6">{err ?? 'Loading…'}</p>
    </div>
  );

  const km = KIND_META[v.kind] ?? KIND_META.service;
  const participating = v.kind === 'service';
  const own = v.relationship === 'internal_team';
  const card = 'bg-white rounded-2xl border border-[#e8e6e0] p-5';
  const missing = (val: string | null) => val
    ? <span className="text-[#1a1916] font-medium break-words">{val}</span>
    : participating ? <span className="text-[#b91c1c] font-semibold">Missing</span> : <span className="text-[#9b9890]">—</span>;

  const profile: { label: string; node: React.ReactNode }[] = [
    { label: 'Email', node: missing(v.email) },
    { label: 'Phone', node: missing(v.phone) },
    { label: 'Entity', node: <span className="text-[#1a1916] font-medium">{v.entityType === 'individual' ? 'Individual / solo' : 'Company'}</span> },
    { label: 'Contact person', node: <span className="text-[#1a1916] font-medium">{v.contactName ?? '—'}</span> },
    { label: 'Address', node: <span className="text-[#1a1916] font-medium break-words">{v.address ?? '—'}</span> },
    { label: 'Trade licence', node: (() => {
      const lic = v.tradeLicence; const today = new Date().toISOString().slice(0, 10);
      if (!lic || (!lic.number && !lic.expiry && !lic.doc)) return <span className="text-[#9b9890]">Not on file</span>;
      const expired = lic.expiry != null && lic.expiry < today;
      return (
        <span className="text-[#1a1916] font-medium">
          {lic.number ?? 'No number'}
          {lic.expiry && <> · <span className={expired ? 'text-[#b91c1c] font-semibold' : 'text-[#1a7a5a]'}>{expired ? `expired ${fmtD(lic.expiry)}` : `valid until ${fmtD(lic.expiry)}`}</span></>}
          {lic.doc && <> · <button type="button" onClick={() => openDocViewer({ fileUrl: lic.doc!.fileUrl, caption: lic.doc!.displayName ?? 'Trade licence', documentKey: 'trade_license' })} className="text-[#1a7a5a] font-semibold underline cursor-pointer">View copy</button></>}
          {!lic.doc && <> · <span className="text-[#b45309]">no copy attached</span></>}
        </span>
      );
    })() },
    { label: "What they're for", node: <span className="text-[#1a1916] font-medium">{v.category ?? '—'}</span> },
    ...(participating ? [
      { label: 'Relationship', node: <span className="text-[#1a1916] font-medium">{own ? 'Our own team' : 'Contracted vendor'}</span> },
      { label: 'Trades', node: <span className="text-[#1a1916] font-medium">{v.trades.length ? v.trades.map(t => t.name).join(' · ') : 'Not set'}</span> },
      { label: 'On UpNow', node: <span className="text-[#1a1916] font-medium">{v.inviteStatus === 'accepted' ? `Yes — accepted ${fmtD(v.acceptedAt)}` : v.inviteStatus === 'invited' ? `Invited ${fmtD(v.invitedAt)} — awaiting acceptance` : 'Not yet — your record only'}</span> },
    ] : [{ label: 'Platform', node: <span className="text-[#9b9890]">Record only — never invited, never assigned work</span> }]),
  ];

  const STATS = [
    { label: 'AMC contracts', value: String(contracts.length), sub: contracts.length ? `${contracts.filter(c => c.status === 'active' || c.status === 'expiring').length} running · ${contracts.filter(c => c.status === 'expired').length} expired` : 'none on record', onClick: () => router.push(amcHref) },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 grid gap-5">
      {/* Identity card — same skeleton as the customer page */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-start gap-3.5 flex-wrap">
          <button onClick={() => router.push(listHref)} aria-label="Back to Vendors"
            className="w-9 h-9 mt-0.5 rounded-full border border-[#e8e6e0] flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef] shrink-0 cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div className="w-12 h-12 rounded-2xl grid place-items-center font-bold text-[17px] shrink-0" style={{ background: km.bg, color: km.fg }}>{v.name.charAt(0)}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[#9b9890] flex items-center gap-1.5 flex-wrap">
              <Link href={listHref} className="hover:underline">Vendors</Link>
              <span className="text-[#c4c1b8]">›</span>
              <span className="truncate max-w-[240px]">{v.name}</span>
            </p>
            <h1 className="text-[22px] leading-tight font-bold text-[#1a1916] mt-0.5">{v.name}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {own && chip('Own team', '#e0f2fe', '#0369a1')}
              {chip(km.label, km.bg, km.fg)}
              {participating && chip(v.inviteStatus === 'accepted' ? 'On UpNow' : v.inviteStatus === 'invited' ? 'Invited' : 'Not invited',
                v.inviteStatus === 'accepted' ? '#d8f2e8' : v.inviteStatus === 'invited' ? '#fef3c7' : '#f4f3ef',
                v.inviteStatus === 'accepted' ? '#1a7a5a' : v.inviteStatus === 'invited' ? '#92400e' : '#6b6860')}
              {v.isDefault && chip('Default', '#f4f3ef', '#6b6860')}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] cursor-pointer">
              <Pencil size={14} /> Edit
            </button>
            {participating && v.inviteStatus !== 'accepted' && (
              <button type="button" disabled={busy} onClick={invite}
                className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-full text-white cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
                {v.inviteStatus === 'invited' ? 'Resend invite' : 'Invite to UpNow'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 pt-4 border-t border-[#eeece6]">
          {profile.map((f, i) => (
            <div key={i} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{f.label}</div>
              <div className="text-sm mt-1">{f.node}</div>
            </div>
          ))}
        </div>

        {inviteUrl && (
          <div className="mt-4 rounded-xl border border-[#bae6fd] bg-[#f0f9ff] px-4 py-3 text-[13px] text-[#0c4a6e] flex items-center gap-3 flex-wrap">
            <span className="font-semibold">{inviteUrl.emailSent
              ? `Invitation emailed to ${inviteUrl.vendorEmail ?? 'the vendor'}.`
              : inviteUrl.emailReason === 'no_email' ? 'No email on file —'
              : inviteUrl.emailReason === 'otp_only_mode' ? `Email not enabled on this environment — nothing was sent to ${inviteUrl.vendorEmail ?? 'the vendor'};`
              : 'The email could not be sent —'} share the link:</span>
            <code className="text-[12px] bg-white border border-[#bae6fd] rounded-lg px-2 py-1 break-all flex-1 min-w-[240px]">{inviteUrl.url}</code>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(inviteUrl.url); }} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#0369a1] cursor-pointer"><Copy size={12} /> Copy</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(inviteUrl.url)}`} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold underline">WhatsApp</a>
            <button type="button" onClick={() => setInviteUrl(null)} className="text-[#9b9890] cursor-pointer" aria-label="Dismiss"><X size={14} /></button>
          </div>
        )}
      </div>

      {err && <p className="text-sm text-red-700 bg-[#fef2f2] border border-[#fecaca] rounded-xl px-4 py-2.5">{err}</p>}

      {/* Headline bar — the customer page's gold-accent segmented card */}
      <div className="rounded-2xl bg-white shadow-sm border-t-[3px] border-[#e3b542] overflow-hidden">
        <div className="grid grid-cols-1 divide-x divide-[#eeece6]">
          {STATS.map((st, i) => (
            <div key={i} className={`px-5 py-4 ${st.onClick ? 'cursor-pointer hover:bg-[#faf9f7] transition-colors' : ''}`} onClick={st.onClick} role={st.onClick ? 'button' : undefined}>
              <div className="text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1 text-[#9b9890]">
                {st.label}{st.onClick && <ExternalLink size={11} className="text-[#2e9f82]" />}
              </div>
              <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                <span className="font-bold text-xl text-[#1a1916]">{st.value}</span>
                <span className="text-xs text-[#9b9890]">{st.sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Active AMC — the customer page's lease-table pattern ── */}
      {(() => {
        const active = contracts.filter(c => c.status !== 'expired');
        const past = contracts.filter(c => c.status === 'expired');
        const th = 'text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold';
        const td = 'px-4 py-3 text-sm text-[#1a1916]';
        const payLabel = (c: AmcRow) => {
          const partial = (c.numberOfPayments != null && c.numberOfPayments > 1) || (c.frequency != null && c.frequency !== 'annually');
          return partial ? `Partial${c.numberOfPayments ? ` · ${c.numberOfPayments} payments` : c.frequency ? ` · ${c.frequency}` : ''}` : 'Paid together';
        };
        const rowOf = (c: AmcRow, pastRow: boolean) => (
          <tr key={c.id} className="border-b border-[#f4f2ec] last:border-0">
            <td className={td + ' font-mono text-xs text-[#9b9890]'}>AMC-{c.id}</td>
            <td className={td + ' font-medium'}>{c.propertyName ?? 'All properties'}</td>
            <td className={td}>{fmtD(c.startDate)} → {fmtD(c.endDate)}</td>
            <td className={td}>{payLabel(c)}{c.modeOfPayment ? <span className="block text-[11.5px] text-[#9b9890] capitalize">{c.modeOfPayment.replace(/_/g, ' ')}</span> : null}</td>
            <td className={td}>
              {pastRow
                ? (c.renewedById != null
                  ? <span className="inline-flex rounded-full text-[11px] font-semibold px-2.5 py-0.5 bg-[#d8f2e8] text-[#1a7a5a]">Renewed</span>
                  : <span className="inline-flex rounded-full text-[11px] font-semibold px-2.5 py-0.5 bg-[#fee2e2] text-[#b91c1c]">Not renewed</span>)
                : (() => { const st = AMC_STATUS[c.status] ?? AMC_STATUS.unknown; return <span className="inline-flex rounded-full text-[11px] font-semibold px-2.5 py-0.5" style={{ background: st.bg, color: st.fg }}>{st.label}</span>; })()}
              {c.renewalOfId != null && !pastRow && <span className="ml-1.5 inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 bg-[#eef2ff] text-[#4338ca]">Renewal</span>}
            </td>
            <td className={td}>
              <Link href={amcDetailHrefOf(c.id)} className="text-[#1a7a5a] font-semibold inline-flex items-center gap-1">View <ExternalLink size={12} /></Link>
            </td>
          </tr>
        );
        return (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
            <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[#eef9f4] text-[#1a7a5a] grid place-items-center"><FileSignature size={14} /></span>
              Active AMC ({active.length}) <span className="text-xs text-[#9b9890] font-normal">· {contracts.length} contracts total</span>
            </h2>
            {past.length > 0 && (
              <button type="button" onClick={() => setShowPast(o => !o)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full border border-[#e8e6e0] bg-white text-[#4a4842] hover:bg-[#f4f3ef] cursor-pointer">
                History ({past.length})
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-[#faf9f6] border-y border-[#f0eee8]">
                <th className={th}>Ref</th><th className={th}>Property</th><th className={th}>Period</th><th className={th}>Payment</th><th className={th}>Status</th><th className={th}></th>
              </tr></thead>
              <tbody>
                {active.map(c => rowOf(c, false))}
                {active.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-sm text-[#9b9890]">No running contract — renew from History, or add one on the AMC page.</td></tr>}
              </tbody>
            </table>
          </div>
          {showPast && past.length > 0 && (
            <div className="border-t border-[#f0eee8]">
              <p className="px-5 pt-3 text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">Past AMC</p>
              <div className="overflow-x-auto">
                <table className="w-full"><tbody>{past.map(c => rowOf(c, true))}</tbody></table>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* ── Payments — per contract, references numbered the way they were filed ── */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#eef9f4] text-[#1a7a5a] grid place-items-center"><Wallet size={14} /></span>
            Payments
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-[#faf9f6] border-y border-[#f0eee8]">
              {['Contract', 'Schedule', 'Mode', 'Payment references'].map(h => <th key={h} className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {contracts.map(c => {
                const proofs = c.documents.filter(d => /payment/i.test(`${d.documentKey} ${d.displayName ?? ''}`));
                const partial = (c.numberOfPayments != null && c.numberOfPayments > 1) || (c.frequency != null && c.frequency !== 'annually');
                return (
                  <tr key={c.id} className="border-b border-[#f4f2ec] last:border-0">
                    <td className="px-4 py-3 text-sm font-medium text-[#1a1916]">{c.propertyName ?? 'All properties'}<span className="block text-[11.5px] text-[#9b9890]">{fmtD(c.startDate)} → {fmtD(c.endDate)}</span></td>
                    <td className="px-4 py-3 text-sm">{partial
                      ? <span className="inline-flex rounded-full text-[11px] font-semibold px-2.5 py-0.5 bg-[#fef3c7] text-[#92400e]">Partial{c.numberOfPayments ? ` · ${c.numberOfPayments}` : ''}</span>
                      : <span className="inline-flex rounded-full text-[11px] font-semibold px-2.5 py-0.5 bg-[#d8f2e8] text-[#1a7a5a]">Paid together</span>}</td>
                    <td className="px-4 py-3 text-sm text-[#1a1916] capitalize">{c.modeOfPayment?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      {proofs.length > 0
                        ? <span className="flex items-center gap-2 flex-wrap">{proofs.map((d, i) => {
                            const ref = d.displayName?.includes('·') ? d.displayName.split('·').pop()!.trim() : null;
                            return (
                            <button key={d.id} type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? 'Proof of Payment', documentKey: d.documentKey })}
                              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1a7a5a] border border-[#cfe9df] bg-[#eef9f4] rounded-full px-2.5 py-1 hover:bg-[#d8f2e8] cursor-pointer">
                              {ref ?? `Proof ${i + 1}`}
                            </button>
                            );
                          })}</span>
                        : <span className="text-[12px] font-semibold text-[#b45309]">None on file</span>}
                    </td>
                  </tr>
                );
              })}
              {contracts.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-sm text-[#9b9890]">Payments follow the contracts — none on record yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Documents (left) + AMC progression (right) — the KYC / Rent-progression zone ── */}
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#eef9f4] text-[#1a7a5a] grid place-items-center"><FileText size={14} /></span>
            Vendor documents <span className="text-xs text-[#9b9890] font-normal">({contracts.reduce((n, c) => n + c.documents.length, 0)})</span>
          </h2>
          <div className="mt-3 grid gap-2">
            {contracts.flatMap(c => {
              let proofN = 0, contractN = 0;
              const nProofs = c.documents.filter(d => /payment/i.test(d.documentKey)).length;
              const nContracts = c.documents.filter(d => !/payment/i.test(d.documentKey)).length;
              return c.documents.map(d => {
                const isProof = /payment/i.test(d.documentKey);
                const idx = isProof ? ++proofN : ++contractN;
                const label = `${d.displayName ?? d.documentKey.replace(/_/g, ' ')}${(isProof ? nProofs : nContracts) > 1 ? ` ${idx}` : ''}`;
                return (
                  <div key={d.id} className="flex items-center gap-3 border border-[#f0eee8] rounded-xl px-3.5 py-2.5">
                    <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${isProof ? 'bg-[#fef8ec] text-[#b45309]' : 'bg-[#eef9f4] text-[#1a7a5a]'}`}><FileText size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#1a1916] truncate">{label}</p>
                      <p className="text-[11.5px] text-[#9b9890]">{c.propertyName ?? 'All properties'} · {fmtD(c.startDate)} – {fmtD(c.endDate)}</p>
                    </div>
                    <button type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: label, documentKey: d.documentKey })}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] shrink-0 cursor-pointer">
                      View
                    </button>
                  </div>
                );
              });
            })}
            {contracts.every(c => c.documents.length === 0) && <p className="text-[13px] text-[#9b9890]">No documents filed yet — attach them on the AMC page.</p>}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#eef9f4] text-[#1a7a5a] grid place-items-center"><TrendingUp size={14} /></span>
            AMC progression
          </h2>
          <p className="text-[11.5px] text-[#9b9890] mt-0.5">What the contract costs, term over term — like rent progression.</p>
          <div className="mt-3 grid gap-4">
            {Object.entries(
              contracts.reduce<Record<string, AmcRow[]>>((acc, c) => {
                const k = c.propertyName ?? 'All properties';
                (acc[k] = acc[k] ?? []).push(c);
                return acc;
              }, {}),
            ).map(([prop, rows]) => {
              const chron = [...rows].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
              return (
                <div key={prop}>
                  <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">{prop}</p>
                  <div className="grid gap-1.5 mt-1.5">
                    {chron.map((c, i) => {
                      const prevVal = i > 0 ? chron[i - 1].annualValueAed ?? null : null;
                      const val = c.annualValueAed ?? null;
                      const delta = val != null && prevVal != null && prevVal !== 0 ? val - prevVal : null;
                      return (
                        <div key={c.id} className="border border-[#f0eee8] rounded-xl px-3.5 py-2.5">
                          <p className="text-[11.5px] text-[#9b9890]">{fmtD(c.startDate)}{c.status === 'expired' ? ' · expired' : ''}</p>
                          <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
                            <span className="text-sm font-bold text-[#1a1916]">{val != null ? aed(val) : 'Value not recorded'}</span>
                            {delta != null && delta !== 0 && (
                              <span className={`text-[11.5px] font-semibold ${delta > 0 ? 'text-[#b45309]' : 'text-[#15803d]'}`}>
                                {delta > 0 ? '▲' : '▼'} {aed(Math.abs(delta))} ({Math.round(Math.abs(delta) / prevVal! * 100)}%)
                              </span>
                            )}
                          </div>
                          {val == null && <p className="text-[11px] text-[#9b9890] mt-0.5">Add it when renewing, or edit the contract on the AMC page.</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {contracts.length === 0 && <p className="text-[13px] text-[#9b9890]">No contracts on record yet.</p>}
          </div>
        </div>
      </div>

      {/* ── Maintenance history ── */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#eef9f4] text-[#1a7a5a] grid place-items-center"><Wrench size={14} /></span>
          Maintenance history <span className="text-xs text-[#9b9890] font-normal">({jobs.length})</span>
        </h2>
        <div className="grid gap-1.5 mt-3">
          {jobs.slice(0, 6).map(j => (
            <Link key={j.id} href={requestHrefOf(j.id)} className="flex items-center gap-3 py-2 border-b border-[#f9f8f6] last:border-0 flex-wrap hover:bg-[#faf9f7] rounded-lg px-1 -mx-1">
              <span className="font-mono text-[11px] text-[#9b9890]">{j.ref}</span>
              <span className="text-[13.5px] font-semibold text-[#1a1916] truncate max-w-[280px]">{j.title}</span>
              <span className="text-[12px] text-[#6b6860]">{j.unit?.unitNumber ? `Unit ${j.unit.unitNumber}` : ''}{j.property?.buildingName ? ` · ${j.property.buildingName}` : ''}</span>
              <span className="ml-auto text-[12px] text-[#6b6860]">{j.stage === 'closed' ? `Closed ${fmtD(j.closedAt)}${j.invoiceTotalAed != null ? ` · ${aed(j.invoiceTotalAed)}` : ''}` : (STAGE_LABEL[j.stage] ?? j.stage)}</span>
            </Link>
          ))}
          {jobs.length === 0 && <p className="text-[13px] text-[#9b9890]">{participating ? 'No maintenance requests routed to this vendor yet.' : 'Records take no maintenance work.'}</p>}
        </div>
      </div>

      {participating && (
        <div className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-[#1a1916]">How they charge</h2>
            <span className="text-[11.5px] text-[#9b9890]">Set by the vendor in their own account — you decide if and who pays; they decide how much.</span>
          </div>
          <div className="grid gap-1.5 mt-3">
            {v.pricing.filter(x => x.mode !== 'none').map(x => (
              <div key={x.categoryGroupId} className="flex items-center gap-3 py-1.5 border-b border-[#f9f8f6] last:border-0">
                <span className="text-[13.5px] font-semibold text-[#1a1916] flex-1">{x.group}</span>
                <span className="text-[13px] text-[#1a1916]">{x.mode === 'hourly' ? <>Hourly · <b>AED {x.hourlyRateAed}/h</b></> : 'Quote per job'}</span>
              </div>
            ))}
            {v.pricing.filter(x => x.mode !== 'none').length === 0 && (
              <p className="text-[13px] text-[#9b9890]">{own ? 'Own team — work runs at cost; no rates to set.' : v.inviteStatus === 'accepted' ? 'No rates set yet — jobs engage at cost until they pick hourly or quote on their profile.' : 'Rates appear once the vendor accepts and sets them in their account.'}</p>
            )}
          </div>
        </div>
      )}

      {participating && v.inviteStatus === 'accepted' && (
        <div className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-[#1a1916]">Technicians · {techs?.length ?? 0}</h2>
            <span className="text-[11.5px] text-[#9b9890]">{own ? 'Your crew — they manage their roster in the team account.' : 'Managed by the vendor in their own account.'}</span>
          </div>
          <div className="grid gap-1.5 mt-3">
            {(techs ?? []).map(t => (
              <div key={t.id} className="flex items-center gap-3 py-1.5 border-b border-[#f9f8f6] last:border-0">
                <div className="flex flex-col flex-1">
                  <span className="text-[13.5px] font-semibold text-[#1a1916]">{t.name}</span>
                  <span className="text-[11.5px] text-[#9b9890]">{t.phone ?? 'no phone'}</span>
                </div>
                {chip(t.status === 'active' ? 'Active' : t.status, t.status === 'active' ? '#d8f2e8' : '#f4f3ef', t.status === 'active' ? '#1a7a5a' : '#6b6860')}
              </div>
            ))}
            {(techs ?? []).length === 0 && <p className="text-[13px] text-[#9b9890]">None yet — the vendor adds them from their account.</p>}
          </div>
        </div>
      )}

      {editing && <VendorForm mode="edit" initial={v} groups={groups} base={base} rp={rp} onClose={() => setEditing(false)} onDone={() => { setEditing(false); load(); }} />}
    </div>
  );
}
