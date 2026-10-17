'use client';

import { useCallback, useEffect, useState } from 'react';
import { isVideoUrl } from '@/lib/media';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { ReschedulePanel } from '@/components/upnow/ReschedulePanel';
import { DisputeThreadPanel } from '@/components/upnow/DisputeThreadPanel';
import { uploadBookingPhoto, EMPTY_EVIDENCE, type EvidenceGroups, type EvidenceKind, type EvidencePhoto } from '@/lib/bookingEvidence';
import { ServiceStatusStepper } from '@/components/upnow/ServiceStatusStepper';
import { serviceStatusView, isQuoteMode, TONE_COLORS } from '@/lib/homeServices/statusView';

/* Tokens shared with the SP dashboard (design 2a). */
const GREEN = '#0B7A4E';
const INK = '#182420';
const MUTE = '#4A544D';
const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2';
const HAIRLINE = '1px solid #EEF1EE';
const TINT_GREEN = '#E9F4EE';
const TINT_AMBER = '#FEF6E7';
const AMBER = '#C77D0A';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });
const aed = (n: number | string) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface TimelineStep { key: string; label: string; at: string | null; done: boolean }
interface Booking {
  id: number; status: string; pricingMode: string | null; serviceName: string | null; packageName: string | null;
  totalAmount: number | string | null; scheduledAt: string; hours: number | null; addressText: string | null;
  tenant?: { user?: { name?: string | null } | null } | null; timeline?: TimelineStep[];
  /** Company-aware customer name from the API (a company by its company name). */
  customerName?: string | null;
  /** Landlord-routed maintenance job (src/maintenance): who pays and the request it serves. */
  source?: 'marketplace' | 'rp_maintenance' | null;
  payer?: 'customer' | 'rental_provider' | null;
  maintenanceRequestId?: number | null;
  customerSignedOff?: boolean;
}
interface Technician { id: number; name: string; jobStatus: string }
interface TeamMember { id: number; name: string; isLeadCapable: boolean }
interface QuoteItem { itemName: string; quantity: number | string; unitPrice: number | string; lineTotal: number | string }
interface Quote { id: number; status: string; totalAmount: number | string; laborAmount?: number | string | null; materialsAmount?: number | string | null; summary?: string | null; validUntil?: string | null; rejectionReason?: string | null; items: QuoteItem[] }
interface JobDetail { booking: Booking; technician: Technician | null; team: TeamMember[]; quote: Quote | null; accepted?: boolean; media?: EvidenceGroups }
interface Dispute {
  id: number; status: string; title: string; description: string | null;
  resolutionSummary: string | null; providerResponse: string | null; bookingId: number;
}
const DISPUTE_OPEN = ['open', 'under_review', 'awaiting_evidence'];

/* Status labels: serviceStatusView (src/lib/homeServices/statusView.ts) —
   status × pricing mode × quote state, shared with the customer's page. */
const NEXT: Record<string, { label: string; to: string }> = {
  assigned: { label: "I'm on my way", to: 'en_route' },
  en_route: { label: 'Start the job', to: 'in_progress' },
  in_progress: { label: 'Mark complete', to: 'completed' },
};
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
  new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

const emptyRow = () => ({ itemName: '', quantity: '1', unitPrice: '', itemType: 'labor' as 'labor' | 'materials' });

/** One evidence gallery row: thumbnails + (optionally) an add tile (SP-258). */
function EvidenceBlock({ title, photos, onUpload, busy }: {
  title: string; photos: EvidencePhoto[]; onUpload?: (f: File) => void; busy?: boolean;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: FAINT }}>
        {title}{photos.length > 0 ? ` · ${photos.length}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {photos.map((p) => (
          <a key={p.id} href={p.viewUrl} target="_blank" rel="noreferrer" title={p.caption ?? (isVideoUrl(p.viewUrl) ? 'Play video' : title)} style={{ position: 'relative', display: 'block' }}>
            {isVideoUrl(p.viewUrl) ? (
              <>
                <video src={p.viewUrl} muted playsInline preload="metadata" style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 10, border: BORDER, display: 'block', background: '#000' }} />
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>▶</span>
              </>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={p.viewUrl} alt={p.caption ?? title} style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 10, border: BORDER, display: 'block' }} />
            )}
          </a>
        ))}
        {photos.length === 0 && !onUpload && <span style={{ fontSize: 12.5, color: FAINT }}>None yet</span>}
        {onUpload && (
          <label style={{ width: 74, height: 74, borderRadius: 10, border: '1.5px dashed #C9D2CB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: FAINT, cursor: busy ? 'default' : 'pointer', background: '#FAFBFA' }}>
            {busy ? '…' : '+'}
            <input type="file" accept="image/*,video/*" style={{ display: 'none' }} disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ''; }} />
          </label>
        )}
      </div>
    </div>
  );
}

export default function ProviderJobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([emptyRow()]);
  const [summary, setSummary] = useState('');
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [respondText, setRespondText] = useState('');
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [media, setMedia] = useState<EvidenceGroups>(EMPTY_EVIDENCE);
  const [mediaBusy, setMediaBusy] = useState<EvidenceKind | null>(null);
  const [mediaErr, setMediaErr] = useState<string | null>(null);
  /** Quote jobs: the provider confirms the inspection happened before pricing (UI gate only). */
  const [inspected, setInspected] = useState(false);

  const load = useCallback(async () => {
    try {
      const [job, disputes] = await Promise.all([
        apiGet<JobDetail>(`/bookings/${id}/job`),
        apiGet<Dispute[]>('/disputes/provider').catch(() => [] as Dispute[]),
      ]);
      setData(job);
      setMedia(job.media ?? EMPTY_EVIDENCE);
      const d = disputes.find((x) => x.bookingId === Number(id)) ?? null;
      setDispute(d);
      setRespondText(d?.providerResponse ?? '');
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this job'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Evidence photos (SP-258): before = condition on arrival, after = proof of
  // the finished work ('after' stays open on a completed job so proof can land
  // with completion; the completion gate reads it server-side).
  const addPhoto = async (kind: EvidenceKind, file: File) => {
    setMediaBusy(kind); setMediaErr(null);
    try {
      const saved = await uploadBookingPhoto(Number(id), kind, file);
      setMedia((m) => ({ ...m, [kind]: [...m[kind], saved] }));
    } catch (e) {
      setMediaErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setMediaBusy(null);
    }
  };

  const submitResponse = async () => {
    if (!dispute || !respondText.trim()) return;
    setBusy(true);
    try { await apiPatch(`/disputes/${dispute.id}/respond`, { response: respondText.trim() }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not submit your response'); }
    finally { setBusy(false); }
  };

  const reassign = async (technicianId: number) => {
    setBusy(true);
    try { await apiPatch(`/bookings/${id}/technician`, { technicianId }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not reassign'); }
    finally { setBusy(false); }
  };
  const advance = async (to: string) => {
    setBusy(true);
    try { await apiPatch(`/bookings/${id}/status`, { status: to }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update status'); }
    finally { setBusy(false); }
  };
  /**
   * SP-138: the customer wasn't there. Only once EN ROUTE and past the
   * slot + grace (the server enforces both and says how long to wait).
   */
  const customerNoShow = async () => {
    if (!window.confirm('Record a customer no-show? The booking will be closed under the no-show policy and the fee released to you per the platform terms.')) return;
    const note = window.prompt('What happened? (optional — goes on the job trail)') ?? '';
    setBusy(true);
    try { await apiPost(`/bookings/${id}/no-show/customer`, note.trim() ? { note: note.trim() } : {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not record the no-show'); }
    finally { setBusy(false); }
  };
  const accept = async () => {
    setBusy(true);
    try { await apiPost(`/bookings/${id}/accept`, {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not accept'); }
    finally { setBusy(false); }
  };
  const decline = async () => {
    setBusy(true);
    try {
      await apiPost(`/bookings/${id}/decline`, { reason: declineReason.trim() || undefined });
      // Declining hands the job to another provider (or Ops) — it is no longer ours.
      router.push('/dashboard/service-provider/operations');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not decline');
      setBusy(false);
    }
  };
  const submitQuote = async () => {
    const items = rows
      .filter((r) => r.itemName.trim() && Number(r.unitPrice) > 0)
      .map((r) => ({ itemName: r.itemName.trim(), quantity: Number(r.quantity) || 1, unitPrice: Number(r.unitPrice), itemType: r.itemType }));
    if (!items.length) { setError('Add at least one priced line.'); return; }
    setBusy(true);
    try { await apiPost(`/bookings/${id}/quote`, { items, summary: summary.trim() || undefined }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not submit quote'); }
    finally { setBusy(false); }
  };

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading job…</div>;
  if (error && !data) return <div style={{ padding: 24, color: '#B42318' }}>{error}</div>;
  if (!data) return null;

  const { booking: b, technician, team, quote, accepted } = data;
  // A landlord-routed maintenance job: the landlord (not the customer) owns the
  // approval when they pay, and there is no marketplace payment step at all.
  const isMaint = b.source === 'rp_maintenance';
  const landlordPays = isMaint && b.payer === 'rental_provider';
  const approver = landlordPays ? 'landlord' : 'customer';
  const isQuote = isQuoteMode(b.pricingMode);
  const view = serviceStatusView({
    status: b.status,
    pricingMode: b.pricingMode,
    quoteStatus: quote?.status ?? null,
    customerSignedOff: b.customerSignedOff,
    providerAttached: true, // this provider holds the job
    approver,
  });
  const st = b.status === 'booked' && landlordPays && !isQuote
    ? { label: 'Awaiting landlord approval', bg: TINT_AMBER, fg: AMBER }
    : { label: view.spLabel, ...TONE_COLORS[view.tone] };
  // A quote booking with no quote yet is an INSPECTION callout: the backend
  // keeps it `booked` with no technician and no visit statuses (the callout
  // attaches the provider only), so the visit is a checklist here and the
  // quote builder opens once the provider says the inspection is done.
  const isInspection = isQuote && b.status === 'booked' && !quote;
  const next = NEXT[b.status];
  const lineAmt = (r: { quantity: string; unitPrice: string }) => (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0);
  const draftTotal = rows.reduce((s, r) => s + lineAmt(r), 0);
  const draftMaterials = rows.filter((r) => r.itemType === 'materials').reduce((s, r) => s + lineAmt(r), 0);
  const draftLabor = draftTotal - draftMaterials;
  const label = `${b.serviceName ?? 'Service'}${b.packageName ? ` — ${b.packageName}` : ''}`;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '4px 2px 48px' }}>
      <Link href="/dashboard/service-provider/operations" style={{ fontSize: 13, color: FAINT, textDecoration: 'none' }}>← Operations</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: INK, letterSpacing: '-.01em' }}>{label}</h1>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '4px 10px', background: st.bg, color: st.fg }}>{st.label}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: FAINT }}>BK-{b.id}</span>
        {isMaint && (
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '4px 10px', background: landlordPays ? TINT_GREEN : '#E0F2FE', color: landlordPays ? GREEN : '#0369A1' }}>
            Landlord maintenance{b.maintenanceRequestId ? ` · MR-${b.maintenanceRequestId}` : ''} · {landlordPays ? 'landlord pays' : 'customer pays'}
          </span>
        )}
      </div>

      {error && <div style={{ marginTop: 12, background: '#FEF2F2', color: '#B42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      {/* Dispute panel — a customer reported an issue on this job */}
      {dispute && (() => {
        const dOpen = DISPUTE_OPEN.includes(dispute.status);
        return (
          <div style={card({ marginTop: 16, padding: '16px 18px', border: '1px solid #FECDCA', background: '#FFFBFA' })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#B42318' }}>⚠ Customer reported an issue</span>
              <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: dOpen ? '#FEF2F2' : TINT_GREEN, color: dOpen ? '#B42318' : GREEN }}>
                {dOpen ? 'Open — under review by UpNow' : dispute.status === 'resolved' ? 'Resolved — refunded' : 'Closed — in your favour'}
              </span>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{dispute.title}</div>
              {dispute.description && <p style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>{dispute.description}</p>}
            </div>
            {dispute.resolutionSummary && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#fff', border: BORDER, borderRadius: 10 }}>
                <div style={lbl}>Resolution</div>
                <p style={{ fontSize: 13, color: INK, marginTop: 4 }}>{dispute.resolutionSummary}</p>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <div style={lbl}>Your response{!dispute.providerResponse && dOpen ? ' — tell the team your side' : ''}</div>
              {dOpen ? (
                <>
                  <textarea value={respondText} onChange={(e) => setRespondText(e.target.value)} rows={3}
                    placeholder="Explain what happened on the job — this goes to the UpNow team reviewing the dispute."
                    style={{ width: '100%', marginTop: 6, border: BORDER, borderRadius: 10, padding: '9px 11px', fontSize: 13, color: INK, resize: 'vertical', fontFamily: 'inherit' }} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button disabled={busy || !respondText.trim()} onClick={submitResponse}
                      style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, opacity: busy || !respondText.trim() ? 0.5 : 1, cursor: 'pointer' }}>
                      {busy ? 'Saving…' : dispute.providerResponse ? 'Update response' : 'Submit response'}
                    </button>
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 13, color: dispute.providerResponse ? INK : FAINT, marginTop: 4 }}>
                  {dispute.providerResponse || 'No response was added.'}
                </p>
              )}
              {/* SP-265 · UpNow's questions to me + my answers */}
              <DisputeThreadPanel disputeId={dispute.id} compact />
            </div>
          </div>
        );
      })()}

      {/* Job facts */}
      <div style={card({ marginTop: 16, padding: '16px 18px' })}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
          <div><div style={lbl}>Customer</div><div style={val}>{b.customerName ?? b.tenant?.user?.name ?? 'Customer'}</div></div>
          <div><div style={lbl}>When</div><div style={val}>{fmtWhen(b.scheduledAt)}{b.hours ? ` · ${b.hours}h` : ''}</div></div>
          <div><div style={lbl}>Address</div><div style={val}>{b.addressText ?? '—'}</div></div>
          <div><div style={lbl}>{landlordPays ? 'Cost' : 'Price'}</div><div style={val}>{b.totalAmount != null ? aed(b.totalAmount) : (landlordPays ? 'Covered by the landlord — record at close-out' : isQuote ? 'To be quoted' : '—')}</div></div>
        </div>
        {/* SP-190 · propose / answer a new time (confirmed | assigned only) */}
        <ReschedulePanel bookingId={b.id} bookingStatus={b.status} onChanged={load} />
      </div>

      {/* Technician */}
      <div style={card({ marginTop: 14, padding: '16px 18px' })}>
        <div style={lbl}>Assigned technician</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: TINT_GREEN, color: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
            {(technician?.name ?? '?').slice(0, 1)}
          </div>
          <span style={{ fontWeight: 600, color: INK, fontSize: 15 }}>{technician?.name ?? 'No one assigned yet'}</span>
          <select
            value={technician?.id ?? ''}
            disabled={busy}
            onChange={(e) => reassign(Number(e.target.value))}
            style={{ marginLeft: 'auto', border: BORDER, borderRadius: 9, padding: '7px 10px', fontSize: 13, color: INK, background: '#fff' }}
          >
            <option value="" disabled>Reassign…</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isLeadCapable ? ' (lead)' : ''}</option>)}
          </select>
        </div>
      </div>

      {/* Evidence photos (SP-258): the customer's problem photos brief the crew;
          before/after is this provider's proof of work — dispute armour. */}
      <div style={card({ marginTop: 14, padding: '16px 18px' })}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Evidence photos</div>
        <EvidenceBlock title="Problem — from the customer" photos={media.problem} />
        <EvidenceBlock title="Before work" photos={media.before}
          onUpload={['assigned', 'en_route', 'in_progress'].includes(b.status) ? (f) => void addPhoto('before', f) : undefined}
          busy={mediaBusy === 'before'} />
        <EvidenceBlock title="Proof of completion" photos={media.after}
          onUpload={['assigned', 'en_route', 'in_progress', 'completed'].includes(b.status) ? (f) => void addPhoto('after', f) : undefined}
          busy={mediaBusy === 'after'} />
        {mediaErr && <p style={{ fontSize: 12.5, color: '#B42318', marginTop: 8 }}>{mediaErr}</p>}
      </div>

      {/* Inspection visit (quote services, before any quote) */}
      {isInspection && (
        <div style={card({ marginTop: 14, padding: '16px 18px' })}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Inspection visit</div>
          <p style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>
            This is a quote job: inspect first, then send an itemised quote. The {approver} approves{landlordPays ? '' : ' and pays'} before any work starts.
          </p>
          <ol style={{ margin: '12px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { t: `Visit the ${landlordPays ? 'property' : 'customer'} at the booked slot`, d: `${fmtWhen(b.scheduledAt)}${b.addressText ? ` · ${b.addressText}` : ''}`, done: inspected },
              { t: 'Inspect the job and photograph what you find', d: 'Add supplier quotations to the quote below if parts are needed.', done: inspected },
              { t: 'Send the itemised quote', d: 'Labour and materials, line by line.', done: false },
            ].map((x, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, border: `2px solid ${x.done ? GREEN : '#DDE2DD'}`, background: x.done ? GREEN : '#fff', color: x.done ? '#fff' : FAINT }}>{x.done ? '✓' : i + 1}</span>
                <span>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: INK }}>{x.t}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: FAINT }}>{x.d}</span>
                </span>
              </li>
            ))}
          </ol>
          {!inspected && (
            <button onClick={() => setInspected(true)}
              style={{ marginTop: 14, background: GREEN, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              I&apos;ve done the inspection — write the quote
            </button>
          )}
          <p style={{ fontSize: 12, color: FAINT, marginTop: 8 }}>
            Visit check-ins (on my way / arrived) aren&apos;t tracked for inspection visits yet — they start once the quote is approved.
          </p>
        </div>
      )}

      {/* Quote entry / status (quote services only) */}
      {isQuote && (!isInspection || inspected) && (
        <div style={card({ marginTop: 14, padding: '16px 18px' })}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{isInspection ? 'Send quote after your inspection' : 'Quote'}</div>
          {!quote || ['draft', 'rejected', 'expired'].includes(quote.status) ? (
            <>
              {quote?.status === 'rejected' && (
                <div style={{ marginTop: 10, padding: '9px 12px', background: TINT_AMBER, border: '1px solid #F5D9A8', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: AMBER }}>The {approver} declined your quote.</span>
                  {quote.rejectionReason && <span style={{ fontSize: 13, color: MUTE }}> “{quote.rejectionReason}”</span>}
                  <span style={{ fontSize: 13, color: MUTE }}> Send a revised quote below.</span>
                </div>
              )}
              {quote?.status === 'expired' && (
                <div style={{ marginTop: 10, padding: '9px 12px', background: TINT_AMBER, border: '1px solid #F5D9A8', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: AMBER }}>Your previous quote expired.</span>
                  <span style={{ fontSize: 13, color: MUTE }}> Send a fresh quote below if the {approver} still wants the job.</span>
                </div>
              )}
              <p style={{ fontSize: 13, color: MUTE, marginTop: quote ? 10 : 4 }}>
                {landlordPays
                  ? (b.status === 'booked'
                    ? 'After your assessment, price the job. The landlord approves before you start.'
                    : "Already approved — the landlord's own team or an approved price. A quote here is your estimate for the landlord's close-out, not a gate.")
                  : 'After your assessment, price the job. The customer approves and pays before you start.'}
              </p>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8 }}>
                    <input placeholder="Line item (e.g. Labour)" value={r.itemName}
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, itemName: e.target.value } : x))}
                      style={{ flex: 1, border: BORDER, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK }} />
                    <select value={r.itemType}
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, itemType: e.target.value as 'labor' | 'materials' } : x))}
                      style={{ width: 104, border: BORDER, borderRadius: 9, padding: '8px 6px', fontSize: 12, color: MUTE, background: '#fff' }}>
                      <option value="labor">Labour</option>
                      <option value="materials">Materials</option>
                    </select>
                    <input placeholder="Qty" value={r.quantity} inputMode="numeric"
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                      style={{ width: 58, border: BORDER, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, textAlign: 'center' }} />
                    <input placeholder="AED" value={r.unitPrice} inputMode="decimal"
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))}
                      style={{ width: 90, border: BORDER, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, textAlign: 'right' }} />
                    {rows.length > 1 && (
                      <button onClick={() => setRows((p) => p.filter((_, j) => j !== i))} style={{ border: BORDER, borderRadius: 9, background: '#fff', color: FAINT, width: 34, cursor: 'pointer' }}>×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setRows((p) => [...p, emptyRow()])} style={{ alignSelf: 'flex-start', fontSize: 13, color: GREEN, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add line</button>
              </div>
              <input placeholder="Summary for the customer (optional)" value={summary} onChange={(e) => setSummary(e.target.value)}
                style={{ width: '100%', marginTop: 8, border: BORDER, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK }} />
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: MUTE }}>Supplier quotations (optional, up to 4)</div>
                <p style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>Photos of the quotations you collected — the {approver} sees them beside your price.</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {media.quote.map((p) => (
                    <a key={p.id} href={p.viewUrl} target="_blank" rel="noopener noreferrer" title={p.caption ?? 'Open quotation'}>
                      <img src={p.viewUrl} alt={p.caption ?? 'Quotation'} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: BORDER }} />
                    </a>
                  ))}
                  {media.quote.length < 4 && (
                    <label style={{ width: 72, height: 72, border: '1px dashed #cfccc4', borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 22, color: FAINT, cursor: 'pointer' }}>
                      {mediaBusy === 'quote' ? '…' : '+'}
                      <input type="file" accept="image/*" style={{ display: 'none' }} disabled={mediaBusy === 'quote'}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto('quote', f); e.target.value = ''; }} />
                    </label>
                  )}
                </div>
              </div>
              {draftMaterials > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: FAINT, display: 'flex', gap: 14 }}>
                  <span>Labour {aed(draftLabor)}</span><span>Materials {aed(draftMaterials)}</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>Total {aed(draftTotal)}</span>
                <button disabled={busy || draftTotal <= 0} onClick={submitQuote}
                  style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, opacity: busy || draftTotal <= 0 ? 0.5 : 1, cursor: 'pointer' }}>
                  {busy ? 'Sending…' : `Send quote to ${approver}`}
                </button>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: quote.status === 'approved' ? TINT_GREEN : TINT_AMBER, color: quote.status === 'approved' ? GREEN : AMBER }}>
                  {quote.status === 'approved' ? `Approved by ${approver}` : `Sent — awaiting ${approver} approval`}
                </span>
              </div>
              {quote.summary && <p style={{ fontSize: 13, color: MUTE, marginTop: 8 }}>{quote.summary}</p>}
              <div style={{ marginTop: 10 }}>
                {quote.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: INK, padding: '4px 0' }}>
                    <span>{it.itemName}{Number(it.quantity) > 1 ? ` × ${it.quantity}` : ''}</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{aed(it.lineTotal)}</span>
                  </div>
                ))}
              </div>
              {Number(quote.materialsAmount ?? 0) > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: HAIRLINE, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: FAINT }}>
                    <span>Labour</span><span style={{ fontFamily: 'ui-monospace, monospace' }}>{aed(quote.laborAmount ?? 0)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: FAINT }}>
                    <span>Materials</span><span style={{ fontFamily: 'ui-monospace, monospace' }}>{aed(quote.materialsAmount ?? 0)}</span>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: HAIRLINE, fontWeight: 700, color: INK }}>
                <span>Total</span><span>{aed(quote.totalAmount)}</span>
              </div>
              {media.quote.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: HAIRLINE }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: MUTE }}>Attached quotations · {media.quote.length}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    {media.quote.map((p) => (
                      <a key={p.id} href={p.viewUrl} target="_blank" rel="noopener noreferrer" title={p.caption ?? 'Open quotation'}>
                        <img src={p.viewUrl} alt={p.caption ?? 'Quotation'} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: BORDER }} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Status action */}
      <div style={card({ marginTop: 14, padding: '16px 18px' })}>
        <div style={lbl}>Job progress</div>
        {b.status === 'booked' && isQuote ? (
          <p style={{ fontSize: 14, color: MUTE, marginTop: 8 }}>
            {!quote || quote.status === 'draft'
              ? `Inspect at ${fmtWhen(b.scheduledAt)}, then send your quote. The job starts once the ${approver} approves${landlordPays ? '' : ' and pays'}.`
              : quote.status === 'submitted'
                ? (landlordPays
                  ? 'Waiting for the landlord to approve. You\u2019ll be able to start once they do.'
                  : 'Waiting for the customer to approve your quote. You\u2019ll be able to start once they pay.')
                : `The ${approver} didn\u2019t take this quote${quote.status === 'expired' ? ' before it expired' : ''} — send a revised one above.`}
          </p>
        ) : b.status === 'assigned' ? (
          <div style={{ marginTop: 10 }}>
            {accepted && <div style={{ fontSize: 13, fontWeight: 600, color: GREEN, marginBottom: 10 }}>✓ You accepted this job</div>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {!accepted ? (
                <button disabled={busy} onClick={accept}
                  style={{ flex: 1, minWidth: 160, background: GREEN, color: '#fff', border: 'none', borderRadius: 11, padding: '12px', fontSize: 15, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>
                  {busy ? 'Working…' : 'Accept job'}
                </button>
              ) : next ? (
                <button disabled={busy} onClick={() => advance(next.to)}
                  style={{ flex: 1, minWidth: 160, background: GREEN, color: '#fff', border: 'none', borderRadius: 11, padding: '12px', fontSize: 15, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>
                  {busy ? 'Updating…' : next.label}
                </button>
              ) : null}
              <button disabled={busy} onClick={() => { setDeclineReason(''); setDeclineOpen(true); }}
                style={{ background: '#fff', color: '#B42318', border: '1px solid #FECDCA', borderRadius: 11, padding: '12px 18px', fontSize: 15, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>
                Decline
              </button>
            </div>
            {!accepted && <p style={{ fontSize: 12.5, color: FAINT, marginTop: 8 }}>Accept to confirm you&apos;ll take this job — the customer is told you&apos;re confirmed. Can&apos;t make it? Decline and we&apos;ll reassign it.</p>}
          </div>
        ) : next ? (
          <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={() => advance(next.to)}
              style={{ flex: 1, minWidth: 160, background: GREEN, color: '#fff', border: 'none', borderRadius: 11, padding: '12px', fontSize: 15, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>
              {busy ? 'Updating…' : next.label}
            </button>
            {b.status === 'en_route' && new Date(b.scheduledAt).getTime() < Date.now() && (
              <button disabled={busy} onClick={() => void customerNoShow()} title="Nobody at the address — closes the job under the no-show policy"
                style={{ background: '#fff', color: '#B42318', border: '1px solid #FECDCA', borderRadius: 11, padding: '12px 18px', fontSize: 15, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>
                Customer not there
              </button>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 14, color: GREEN, marginTop: 8, fontWeight: 600 }}>✓ Job {b.status}.</p>
        )}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: HAIRLINE }}>
          <ServiceStatusStepper view={view} audience="provider" />
        </div>
        {b.timeline && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {b.timeline.map((s) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${s.done ? GREEN : '#DDE2DD'}`, background: s.done ? GREEN : 'transparent' }} />
                <span style={{ color: s.done ? INK : FAINT, fontWeight: s.done ? 600 : 400 }}>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Decline confirmation */}
      {declineOpen && (
        <div onClick={() => setDeclineOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,18,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={card({ width: 440, maxWidth: '100%', padding: 22 })}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Decline this job?</div>
            <p style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>
              {isMaint
                ? <>BK-{b.id} goes back to the landlord, who re-routes it to another of their providers. A reason helps them.</>
                : <>We&apos;ll reassign BK-{b.id} to another provider (or hand it to Ops). A reason helps us dispatch better.</>}
            </p>
            <textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3}
              placeholder="Reason (optional) — e.g. fully booked at that time"
              style={{ width: '100%', marginTop: 12, border: BORDER, borderRadius: 10, padding: '9px 11px', fontSize: 13, color: INK, resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeclineOpen(false)} style={{ background: 'none', border: BORDER, borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 600, color: MUTE, cursor: 'pointer' }}>Keep job</button>
              <button disabled={busy} onClick={decline} style={{ background: '#B42318', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 17px', fontSize: 13, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>{busy ? 'Declining…' : 'Decline & reassign'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: FAINT };
const val: React.CSSProperties = { color: INK, marginTop: 3, fontWeight: 500 };
