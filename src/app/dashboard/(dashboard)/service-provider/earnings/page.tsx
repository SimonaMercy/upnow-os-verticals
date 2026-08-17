'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';

/* Tokens shared with SpLiveOverview (design 2a). */
const GREEN = '#0B7A4E';
const INK = '#182420';
const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2';
const HAIRLINE = '1px solid #EEF1EE';
const TINT_GREEN = '#E9F4EE';
const TINT_AMBER = '#FEF6E7';
const AMBER = '#C77D0A';

/** Provider-facing labels for escrow refund reasons (SP-259). */
const REFUND_REASON_LABELS: Record<string, string> = {
  customer_cancelled: 'Customer cancelled',
  provider_cancelled: 'Provider cancelled',
  provider_no_show: 'No-show (you)',
  customer_no_show: 'Customer no-show',
  work_not_to_standard: 'Work not to standard',
  duplicate_booking: 'Duplicate booking',
  platform_error: 'Platform error',
  dispute_upheld: 'Dispute upheld',
  goodwill: 'Goodwill refund',
};
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });
const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface EarningsJob {
  bookingId: number;
  serviceName: string | null;
  status: string;
  /** 'job' = completed work · 'cancellation_fee' = a retained fee on a cancelled / no-show booking (SP-138). */
  kind?: 'job' | 'cancellation_fee';
  disputed: boolean;
  gross: number;
  /** VAT slice inside the gross (SP-141); 0 for bookings priced before the engine. */
  vat: number;
  commission: number | null;
  net: number | null;
  earnedAt: string | null;
  /** Why a refunded/clawed-back job paid nothing (SP-259). */
  refundReason: string | null;
}
interface Earnings {
  currency: string;
  summary: {
    netEarned: number; commissionPaid: number; vatWithheld: number; grossEarned: number;
    pendingHeld: number; jobsCompleted: number; jobsPending: number;
    disputedHeld: number; jobsDisputed: number;
  };
  jobs: EarningsJob[];
}
interface BankAccount {
  holderName: string; bankName: string; iban: string; swiftBic: string | null; isVerified: boolean;
}
interface PayoutRow {
  id: number; amount: number; currency: string; status: string;
  requestedAt: string; paidAt: string | null; notes: string | null;
}
interface PayoutMe {
  balance: {
    currency: string; netEarned: number; paidOut: number; available: number; disputedHeld: number;
    /** SP-221 · payout schedule split */
    maturing?: number; maturesAt?: string | null; belowMinimum?: boolean;
    schedule?: { holdHoursAfterRelease: number; cadence: 'daily' | 'weekly' | 'manual'; payoutWeekday: number; minPayoutAed: number; nextPayoutAt: string | null };
  };
  bankAccount: BankAccount | null;
  payouts: PayoutRow[];
}
const maskIban = (iban: string) => (iban.length > 8 ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : iban);

function Tile({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint?: string }) {
  return (
    <div style={card({ padding: '16px 18px' })}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 700, color: tint ?? INK, marginTop: 6, letterSpacing: '-.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: FAINT, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function statusPill(status: string, disputed = false) {
  // A disputed job is released-but-withheld — never show it as paid out.
  if (disputed) {
    return (
      <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', color: '#B42318', background: '#FEF2F2' }}>
        In dispute
      </span>
    );
  }
  // A cancellation / no-show fee is money earned without a completed job (SP-138):
  // partially_released = fee kept, rest refunded; released on a cancelled booking = the whole amount kept.
  const released = status === 'released' || status === 'partially_released';
  const refunded = status === 'refunded';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px',
      color: released ? GREEN : refunded ? FAINT : AMBER,
      background: released ? TINT_GREEN : refunded ? '#F3F4F6' : TINT_AMBER,
    }}>
      {status === 'partially_released' ? 'Fee paid out' : released ? 'Paid out' : refunded ? 'Refunded' : 'Held'}
    </span>
  );
}

export default function ServiceProviderEarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [pay, setPay] = useState<PayoutMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPay = () => apiGet<PayoutMe>('/payouts/me').then(setPay).catch(() => {});

  useEffect(() => {
    Promise.all([apiGet<Earnings>('/bookings/earnings').then(setData), loadPay()])
      .catch((e) => setError(e?.message ?? 'Could not load earnings'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading earnings…</div>;
  if (error) return <div style={{ padding: 24, color: '#B42318' }}>{error}</div>;
  if (!data) return null;

  const s = data.summary;
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '4px 2px 40px' }}>
      <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: GREEN }}>Earnings</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Your payouts</h1>
      <p style={{ color: FAINT, fontSize: 14, marginTop: 4 }}>
        Funds are held when a job is confirmed and released to you once you complete it — net of VAT and the platform commission (charged on the VAT-exclusive value).
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5" style={{ marginTop: 18 }}>
        <Tile label="Net earned" value={aed(s.netEarned)} sub={`${s.jobsCompleted} job${s.jobsCompleted === 1 ? '' : 's'} completed`} tint={GREEN} />
        <Tile label="Commission paid" value={aed(s.commissionPaid)} sub={s.vatWithheld > 0 ? `Platform fee · + ${aed(s.vatWithheld)} VAT withheld` : 'Platform fee'} />
        <Tile label="Pending (held)" value={aed(s.pendingHeld)} sub={`${s.jobsPending} in progress`} tint={s.pendingHeld > 0 ? AMBER : undefined} />
        <Tile label="Gross billed" value={aed(s.grossEarned)} sub="VAT-inclusive, before commission" />
        {s.disputedHeld > 0 && (
          <Tile
            label="In dispute (on hold)"
            value={aed(s.disputedHeld)}
            sub={`${s.jobsDisputed} job${s.jobsDisputed === 1 ? '' : 's'} — withheld until resolved`}
            tint="#B42318"
          />
        )}
      </div>

      {pay && <PayoutSection pay={pay} onReload={loadPay} />}

      <div style={card({ marginTop: 18, overflow: 'hidden' })}>
        <div style={{ padding: '14px 18px', borderBottom: HAIRLINE, fontSize: 13.5, fontWeight: 700, color: INK }}>
          Per-job breakdown
        </div>
        {data.jobs.length === 0 ? (
          <div style={{ padding: '34px 18px', textAlign: 'center', color: FAINT, fontSize: 14 }}>
            No earnings yet — completed jobs will appear here.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: FAINT, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  <th style={{ textAlign: 'left', padding: '10px 18px', fontWeight: 600 }}>Service</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Booking</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Gross</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>VAT</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Commission</th>
                  <th style={{ textAlign: 'right', padding: '10px 18px', fontWeight: 600 }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j, i) => (
                  <tr key={j.bookingId} style={{ borderTop: i === 0 ? HAIRLINE : '1px solid #F4F6F3', color: INK }}>
                    <td style={{ padding: '12px 18px', fontWeight: 600 }}>
                      {j.serviceName ?? '—'}
                      {j.kind === 'cancellation_fee' && (
                        <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: AMBER, background: TINT_AMBER, borderRadius: 999, padding: '2px 8px' }}>
                          {j.refundReason === 'customer_no_show' ? 'No-show fee' : 'Cancellation fee'}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 12px', color: FAINT }}>BK-{j.bookingId}</td>
                    <td style={{ padding: '12px 12px' }}>
                      {statusPill(j.status, j.disputed)}
                      {j.refundReason && (
                        <div style={{ fontSize: 11, color: FAINT, marginTop: 2 }}>
                          {REFUND_REASON_LABELS[j.refundReason] ?? j.refundReason}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 12px', textAlign: 'right' }}>{aed(j.gross)}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', color: FAINT }}>{j.vat > 0 ? `− ${aed(j.vat)}` : '—'}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', color: FAINT }}>{j.commission != null ? `− ${aed(j.commission)}` : '—'}</td>
                    <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: j.net != null ? GREEN : FAINT }}>{j.net != null ? aed(j.net) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

function PayoutSection({ pay, onReload }: { pay: PayoutMe; onReload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ holderName: '', bankName: '', iban: '', swiftBic: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = () => {
    const b = pay.bankAccount;
    setForm({ holderName: b?.holderName ?? '', bankName: b?.bankName ?? '', iban: b?.iban ?? '', swiftBic: b?.swiftBic ?? '' });
    setErr(null);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await apiPut('/payouts/me/bank-account', {
        holderName: form.holderName, bankName: form.bankName, iban: form.iban, swiftBic: form.swiftBic || undefined,
      });
      await onReload();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save bank account');
    } finally { setSaving(false); }
  };
  const field = (ph: string, key: keyof typeof form, mono = false) => (
    <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={ph}
      style={{ width: '100%', border: BORDER, borderRadius: 9, padding: '9px 11px', fontSize: 14, color: INK, marginTop: 8, boxSizing: 'border-box', fontFamily: mono ? 'ui-monospace, monospace' : undefined }} />
  );
  const canSave = form.holderName.trim() && form.bankName.trim() && form.iban.trim();

  return (
    <div style={card({ marginTop: 18, padding: 18 })}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>Available to pay out</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: pay.balance.available > 0 ? GREEN : INK, marginTop: 4, letterSpacing: '-.02em' }}>{aed(pay.balance.available)}</div>
          <div style={{ fontSize: 12.5, color: FAINT, marginTop: 3 }}>{aed(pay.balance.paidOut)} paid out · settled manually during the pilot</div>
          {pay.balance.disputedHeld > 0 && (
            <div style={{ fontSize: 12.5, color: '#B42318', marginTop: 6, fontWeight: 600 }}>
              {aed(pay.balance.disputedHeld)} withheld pending dispute resolution
            </div>
          )}
          {/* SP-221 · payout schedule: hold + cadence + minimum */}
          {(pay.balance.maturing ?? 0) > 0 && (
            <div style={{ fontSize: 12.5, color: '#92400E', marginTop: 6 }}>
              {aed(pay.balance.maturing ?? 0)} released, payable {pay.balance.maturesAt ? `from ${new Date(pay.balance.maturesAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })}` : 'soon'} ({pay.balance.schedule?.holdHoursAfterRelease ?? 48} h hold)
            </div>
          )}
          {pay.balance.schedule && (
            <div style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>
              {pay.balance.schedule.cadence === 'manual' ? 'Payouts are run manually by UpNow' : `Payouts run ${pay.balance.schedule.cadence}${pay.balance.schedule.nextPayoutAt ? ` · next ${new Date(pay.balance.schedule.nextPayoutAt).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })}` : ''}`}
              {pay.balance.schedule.minPayoutAed > 0 ? ` · minimum ${aed(pay.balance.schedule.minPayoutAed)}` : ''}
              {pay.balance.belowMinimum ? ' — below the minimum, rolls into the next run' : ''}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 260, maxWidth: 400 }}>
          {editing ? (
            <div style={{ background: '#F7FAF8', border: HAIRLINE, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: FAINT, textTransform: 'uppercase', letterSpacing: '.06em' }}>Payout bank account</div>
              {field('Account holder name', 'holderName')}
              {field('Bank name', 'bankName')}
              {field('IBAN (AE…)', 'iban', true)}
              {field('SWIFT / BIC (optional)', 'swiftBic', true)}
              {err && <div style={{ color: '#B42318', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={save} disabled={saving || !canSave}
                  style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving || !canSave ? 0.5 : 1 }}>
                  {saving ? 'Saving…' : 'Save account'}</button>
                <button onClick={() => setEditing(false)} style={{ background: 'none', border: BORDER, borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: FAINT, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : pay.bankAccount ? (
            <div style={{ background: '#F7FAF8', border: HAIRLINE, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: FAINT, textTransform: 'uppercase', letterSpacing: '.06em' }}>Payout account</span>
                <button onClick={open} style={{ background: 'none', border: 'none', color: GREEN, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginTop: 6 }}>{pay.bankAccount.bankName}</div>
              <div style={{ fontSize: 13.5, color: INK, fontFamily: 'ui-monospace, monospace', marginTop: 1 }}>{maskIban(pay.bankAccount.iban)}</div>
              <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>{pay.bankAccount.holderName}</div>
              <div style={{ marginTop: 8 }}>
                {pay.bankAccount.isVerified
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, background: TINT_GREEN, borderRadius: 999, padding: '3px 9px' }}>✓ Verified</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, color: AMBER, background: TINT_AMBER, borderRadius: 999, padding: '3px 9px' }}>Pending verification</span>}
              </div>
            </div>
          ) : (
            <div style={{ background: TINT_AMBER, border: '1px solid #F3DEB6', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#8A5A00' }}>Add your bank account to get paid</div>
              <div style={{ fontSize: 12.5, color: '#A06A12', marginTop: 2 }}>We pay your released earnings to this IBAN.</div>
              <button onClick={open} style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 10 }}>Add bank account</button>
            </div>
          )}
        </div>
      </div>

      {pay.payouts.length > 0 && (
        <div style={{ marginTop: 16, borderTop: HAIRLINE, paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: FAINT, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Payout history</div>
          {pay.payouts.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid #F4F6F3', fontSize: 13.5 }}>
              <span style={{ color: INK }}>{p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Requested'}</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: p.status === 'paid' ? GREEN : AMBER, background: p.status === 'paid' ? TINT_GREEN : TINT_AMBER, borderRadius: 999, padding: '2px 8px', textTransform: 'capitalize' }}>{p.status}</span>
                <span style={{ fontWeight: 700, color: GREEN }}>{aed(p.amount)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
