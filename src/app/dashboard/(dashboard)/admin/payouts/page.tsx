'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

const PRIMARY = '#2e9f82';
const INK = '#1a1916';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
const GREEN = '#1a7a5a';
const BORDER = '1px solid #ececea';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 16, ...extra });
const aed = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const maskIban = (iban: string) => (iban.length > 8 ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : iban);

interface PayoutRow { id: number; amount: number; status: string; paidAt: string | null }
interface Row {
  serviceProviderId: number;
  payeeUserId: number;
  businessName: string;
  currency: string;
  netEarned: number;
  paidOut: number;
  available: number;
  bankAccount: { holderName: string; bankName: string; iban: string; isVerified: boolean } | null;
  payouts: PayoutRow[];
}

export default function AdminPayoutsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<Row[]>('/payouts'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payouts');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const record = async (r: Row) => {
    setBusy(true);
    try {
      await apiPost('/payouts', { payeeUserId: r.payeeUserId });
      setConfirm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payout');
    } finally { setBusy(false); }
  };

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading payouts…</div>;

  const owed = rows.filter((r) => r.available > 0);
  const totalOwed = owed.reduce((s, r) => s + r.available, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paidOut, 0);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 4px 48px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: PRIMARY }}>Finance</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Provider payouts</h1>
      <p style={{ color: MUTE, fontSize: 14, marginTop: 4 }}>Released earnings owed to providers. On the pilot you settle by manual bank transfer, then record it here.</p>

      {error && <div style={{ marginTop: 12, background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      {/* Summary */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        <div style={card({ padding: '14px 18px', flex: 1, minWidth: 200, borderColor: owed.length ? '#f3c6c6' : '#ececea' })}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>Owed now</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: owed.length ? '#991b1b' : INK, marginTop: 4 }}>{aed(totalOwed)}</div>
          <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>{owed.length} provider{owed.length === 1 ? '' : 's'} awaiting payout</div>
        </div>
        <div style={card({ padding: '14px 18px', flex: 1, minWidth: 200 })}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>Paid to date</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: GREEN, marginTop: 4 }}>{aed(totalPaid)}</div>
          <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>across all providers</div>
        </div>
      </div>

      {/* Table */}
      <div style={card({ marginTop: 18, overflow: 'hidden' })}>
        <div style={{ padding: '13px 18px', borderBottom: BORDER, fontSize: 14, fontWeight: 700, color: INK }}>
          Providers <span style={{ color: FAINT, fontWeight: 400 }}>({rows.length})</span>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: '26px 18px', color: FAINT, fontSize: 14 }}>No provider earnings yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: FAINT, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {['Provider', 'Bank account', 'Net earned', 'Paid out', 'Available', ''].map((h) => (
                    <th key={h} style={{ textAlign: h === 'Provider' || h === 'Bank account' ? 'left' : 'right', padding: '10px 18px', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.serviceProviderId} style={{ borderTop: i === 0 ? BORDER : '1px solid #f6f6f4', color: INK }}>
                    <td style={{ padding: '12px 18px', fontWeight: 600 }}>{r.businessName}</td>
                    <td style={{ padding: '12px 18px', color: MUTE }}>
                      {r.bankAccount ? (
                        <span>
                          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{maskIban(r.bankAccount.iban)}</span>
                          {!r.bankAccount.isVerified && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 999, padding: '2px 7px' }}>unverified</span>}
                        </span>
                      ) : <span style={{ color: '#b45309' }}>No bank account</span>}
                    </td>
                    <td style={{ padding: '12px 18px', textAlign: 'right' }}>{aed(r.netEarned)}</td>
                    <td style={{ padding: '12px 18px', textAlign: 'right', color: FAINT }}>{aed(r.paidOut)}</td>
                    <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: r.available > 0 ? '#991b1b' : FAINT }}>{aed(r.available)}</td>
                    <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                      {r.available > 0 && (
                        <button onClick={() => setConfirm(r)} style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Record payout</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div onClick={() => !busy && setConfirm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,18,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={card({ width: 440, maxWidth: '100%', padding: 22 })}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Record payout</div>
            <p style={{ fontSize: 13.5, color: MUTE, marginTop: 6 }}>
              Confirm you have transferred <b style={{ color: INK }}>{aed(confirm.available)}</b> to <b style={{ color: INK }}>{confirm.businessName}</b>
              {confirm.bankAccount ? <> ({confirm.bankAccount.bankName}, <span style={{ fontFamily: 'ui-monospace, monospace' }}>{maskIban(confirm.bankAccount.iban)}</span>)</> : null}. This records the settlement and clears their balance.
            </p>
            {!confirm.bankAccount && (
              <div style={{ marginTop: 10, background: '#fef6e7', color: '#92400e', borderRadius: 8, padding: '8px 10px', fontSize: 12.5 }}>
                This provider has no bank account on file — record only if you settled another way.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirm(null)} disabled={busy} style={{ background: 'none', border: BORDER, borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 600, color: MUTE, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => record(confirm)} disabled={busy} style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 17px', fontSize: 13, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>{busy ? 'Recording…' : `Record ${aed(confirm.available)}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
