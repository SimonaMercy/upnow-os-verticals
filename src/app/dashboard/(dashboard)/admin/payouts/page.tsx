'use client';

/**
 * Admin › Finance › Provider payouts — Genspark OS rebuild.
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET /payouts — one row per service provider (net earned, disputed hold, paid out,
 *    available, bank account, payout history). Amounts are AED NUMBERS (may be 2dp) —
 *    NOT fils — shown with fmtAed(…, true); sums done in integer fils.
 *  - POST /payouts { payeeUserId } — "Record payout" for a provider with available > 0,
 *    behind a confirm step that names the amount, provider, bank + masked IBAN, and warns
 *    when there is no bank account on file. Reloads the list on success.
 *  - Summary: Owed now (total available + count of providers awaiting) and Paid to date.
 *  - Table: provider, bank account (masked IBAN + "unverified" flag / "No bank account"),
 *    net earned, on hold (with the dispute tooltip), paid out, available.
 *  - Loading / error / empty ("No provider earnings yet") states.
 *  New (real data already in the response, previously unrendered): an "Open" drawer per
 *  provider with the bank details and the payout history (payouts[]). No manager route
 *  re-exports this page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import {
  Btn, Callout, Drawer, EmptyRow, ErrorRow, KV, Kpi, Kpis, Modal, OsPage, PageHead, Pill, ScopeStrip, SearchField,
  Seg, SkeletonRows, StatusTag, TableWrap, fmtAed, fmtDate,
} from '@/components/os/kit';

interface PayoutRow { id: number; amount: number; status: string; paidAt: string | null }
interface Row {
  serviceProviderId: number;
  payeeUserId: number;
  businessName: string;
  currency: string;
  netEarned: number;
  disputedHeld: number;
  paidOut: number;
  available: number;
  bankAccount: { holderName: string; bankName: string; iban: string; isVerified: boolean } | null;
  payouts: PayoutRow[];
}

const aed = (n: number | null | undefined) => fmtAed(n, true);
const toFils = (n: number) => Math.round((Number(n) || 0) * 100);
const sumAed = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + toFils(f(r)), 0) / 100;
const maskIban = (iban: string) => (iban.length > 8 ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : iban);

type View = 'all' | 'owed' | 'held' | 'settled';
const stateOf = (r: Row): Exclude<View, 'all'> => (r.available > 0 ? 'owed' : r.disputedHeld > 0 ? 'held' : 'settled');
const STATE_PILL = {
  owed: <Pill tone="amber">Owed</Pill>,
  held: <Pill tone="danger">On hold</Pill>,
  settled: <Pill tone="primary">Settled</Pill>,
};

export default function AdminPayoutsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>('all');

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<Row[]>('/payouts'));
      setError(null); setLoadFailed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payouts');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

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

  const owed = rows.filter((r) => r.available > 0);
  const totalOwed = sumAed(owed, (r) => r.available);
  const totalPaid = sumAed(rows, (r) => r.paidOut);
  const totalHeld = sumAed(rows, (r) => r.disputedHeld);
  const heldCount = rows.filter((r) => r.disputedHeld > 0).length;
  const counts = useMemo(() => ({
    all: rows.length,
    owed: rows.filter((r) => stateOf(r) === 'owed').length,
    held: rows.filter((r) => stateOf(r) === 'held').length,
    settled: rows.filter((r) => stateOf(r) === 'settled').length,
  }), [rows]);
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (view === 'all' || stateOf(r) === view)
      && (!s || [r.businessName, r.bankAccount?.bankName, r.bankAccount?.holderName].some((x) => x?.toLowerCase().includes(s))));
  }, [rows, q, view]);
  const open = rows.find((r) => r.serviceProviderId === openId) ?? null;

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Finance"
        title="Provider payouts"
        lede="Released earnings owed to service providers. On the pilot you settle by manual bank transfer, then record it here."
        actions={<Btn size="sm" onClick={() => { setLoading(true); void load(); }}>Refresh</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Finance' },
        { label: 'Providers', value: loading ? '…' : rows.length },
        { label: 'Settlement', value: 'Manual bank transfer' },
      ]} />

      {error && !loadFailed && <div style={{ marginBottom: 14 }}><Callout tone="bad" title="Something went wrong.">{error}</Callout></div>}

      <Kpis>
        <Kpi dark k="Owed now" v={loading || loadFailed ? '—' : aed(totalOwed)} d={`${owed.length} provider${owed.length === 1 ? '' : 's'} awaiting payout`} />
        <Kpi k="Paid to date" v={loading || loadFailed ? '—' : aed(totalPaid)} d="across all providers" />
        <Kpi k="On hold" v={loading || loadFailed ? '—' : aed(totalHeld)} d={`${heldCount} provider${heldCount === 1 ? '' : 's'} with an open dispute`} />
        <Kpi k="Providers" v={loading || loadFailed ? '—' : rows.length} d="with earnings on the platform" />
      </Kpis>

      <div style={{ marginBottom: 14 }}>
        <Callout tone="info" title="Only available money moves.">
          Pay out the Available figure only. Amounts on hold are withheld from payout until the dispute is resolved; recording a payout clears the provider&apos;s available balance.
        </Callout>
      </div>

      <TableWrap toolbar={<>
        <SearchField value={q} onChange={setQ} placeholder="Search provider or bank" />
        <Seg label="Payout state" value={view} onChange={setView} options={[
          { v: 'all', l: 'All', n: counts.all }, { v: 'owed', l: 'Owed', n: counts.owed },
          { v: 'held', l: 'On hold', n: counts.held }, { v: 'settled', l: 'Settled', n: counts.settled },
        ]} />
      </>}>
        <table className="gx-tbl">
          <thead><tr>
            <th>Provider</th><th>Bank account</th><th className="num">Net earned</th><th className="num">On hold</th>
            <th className="num">Paid out</th><th className="num">Available</th><th>Status</th><th className="act">Actions</th>
          </tr></thead>
          {loading ? <SkeletonRows cols={8} /> : loadFailed ? <ErrorRow cols={8} onRetry={() => { setLoading(true); void load(); }} /> : visible.length === 0 ? (
            <EmptyRow cols={8} title={rows.length ? 'No providers match' : 'No provider earnings yet.'}
              text={rows.length ? 'Clear the search or pick another state.' : 'Earnings appear once a booking is completed and released.'} />
          ) : (
            <tbody>
              {visible.map((r) => (
                <tr key={r.serviceProviderId}>
                  <td className="strong">{r.businessName}</td>
                  <td>
                    {r.bankAccount ? (
                      <><span className="mono">{maskIban(r.bankAccount.iban)}</span>{' '}
                        {!r.bankAccount.isVerified && <Pill tone="amber">Unverified</Pill>}</>
                    ) : <Pill tone="amber">No bank account</Pill>}
                  </td>
                  <td className="num">{aed(r.netEarned)}</td>
                  <td className="num" title={r.disputedHeld > 0 ? 'Withheld from payout until the dispute is resolved' : undefined}
                    style={r.disputedHeld > 0 ? { color: 'var(--ms-danger)', fontWeight: 600 } : undefined}>
                    {r.disputedHeld > 0 ? aed(r.disputedHeld) : '—'}
                  </td>
                  <td className="num">{aed(r.paidOut)}</td>
                  <td className="num strong">{aed(r.available)}</td>
                  <td>{STATE_PILL[stateOf(r)]}</td>
                  <td className="act">
                    <div className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
                      <Btn size="xs" onClick={() => setOpenId(r.serviceProviderId)}>Open</Btn>
                      {r.available > 0 && <Btn size="xs" variant="primary" onClick={() => setConfirm(r)}>Record payout</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </TableWrap>

      {/* Provider drawer */}
      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open?.businessName ?? ''}
        sub={open ? <>Provider #{open.serviceProviderId} · {STATE_PILL[stateOf(open)]}</> : null}
        footer={open && (
          <>
            <Btn onClick={() => setOpenId(null)}>Close</Btn>
            {open.available > 0 && <Btn variant="primary" onClick={() => setConfirm(open)}>Record payout {aed(open.available)}</Btn>}
          </>
        )}
      >
        {open && (
          <div style={{ display: 'grid', gap: 16 }}>
            <KV items={[
              { k: 'Net earned', v: aed(open.netEarned) },
              { k: 'On hold (disputes)', v: open.disputedHeld > 0 ? aed(open.disputedHeld) : '—' },
              { k: 'Paid out', v: aed(open.paidOut) },
              { k: 'Available', v: aed(open.available) },
              { k: 'Currency', v: open.currency },
            ]} />
            {open.bankAccount ? (
              <KV items={[
                { k: 'Account holder', v: open.bankAccount.holderName },
                { k: 'Bank', v: open.bankAccount.bankName },
                { k: 'IBAN', v: <span className="mono">{maskIban(open.bankAccount.iban)}</span> },
                { k: 'Verified', v: open.bankAccount.isVerified ? <Pill tone="primary">Verified</Pill> : <Pill tone="amber">Unverified</Pill> },
              ]} />
            ) : (
              <Callout tone="warn" title="No bank account on file.">Record a payout only if you settled another way.</Callout>
            )}
            <div>
              <div className="gx-lb" style={{ marginBottom: 6 }}>Payout history</div>
              <TableWrap>
                <table className="gx-tbl">
                  <thead><tr><th>Payout</th><th>Paid on</th><th>Status</th><th className="num">Amount</th></tr></thead>
                  {open.payouts.length === 0 ? <EmptyRow cols={4} title="No payouts yet" text="Recorded payouts appear here." /> : (
                    <tbody>
                      {open.payouts.map((p) => (
                        <tr key={p.id}>
                          <td className="mono">#{p.id}</td>
                          <td className="nowrap">{fmtDate(p.paidAt)}</td>
                          <td><StatusTag status={p.status} /></td>
                          <td className="num strong">{aed(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  )}
                </table>
              </TableWrap>
            </div>
          </div>
        )}
      </Drawer>

      {/* Confirm */}
      <Modal
        open={!!confirm}
        onClose={() => { if (!busy) setConfirm(null); }}
        title="Record payout"
        width={460}
        footer={confirm && (
          <>
            <Btn onClick={() => setConfirm(null)} disabled={busy}>Cancel</Btn>
            <Btn variant="primary" onClick={() => record(confirm)} disabled={busy}>{busy ? 'Recording…' : `Record ${aed(confirm.available)}`}</Btn>
          </>
        )}
      >
        {confirm && (
          <div style={{ display: 'grid', gap: 10, fontSize: 12.5 }}>
            <p>
              Confirm you have transferred <b>{aed(confirm.available)}</b> to <b>{confirm.businessName}</b>
              {confirm.bankAccount ? <> ({confirm.bankAccount.bankName}, <span className="mono">{maskIban(confirm.bankAccount.iban)}</span>)</> : null}.
              This records the settlement and clears their balance.
            </p>
            {!confirm.bankAccount && (
              <Callout tone="warn">This provider has no bank account on file — record only if you settled another way.</Callout>
            )}
          </div>
        )}
      </Modal>
    </OsPage>
  );
}
