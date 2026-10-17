/**
 * Admin › Spaces › Platform billing (dashboard/admin/billing) — Genspark OS rebuild.
 *
 * RP commercial model (agency, final recommendation) — what UpNow bills each
 * Rental Provider per calendar month: platform subscription (AED 499/month,
 * recurring) + lease origination (AED 300, new lease activated) + lease renewal
 * (AED 100) + lease settlement (AED 100, settlement paid, once per tenancy chain).
 * VAT (5%) is always its own line, never folded into net. Fee amounts are versioned
 * in fee_config; editing is SUPER_ADMIN-only. All money is WHOLE AED (VAT can be 2dp)
 * — NOT fils — so it is shown with fmtAed (2 dp only when fractional).
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - Permission: admin or super_admin only ("Admin access required." otherwise); fee
 *    edits super_admin only ("Fee edits are super-admin only." note for admins).
 *  - GET /admin/billing/config — fee schedule + VAT rate; error → retry.
 *  - PATCH /admin/billing/config { [feeKey]: wholeAed } — inline fee edit (Enter saves,
 *    Esc cancels; validation "Whole AED, 0–100,000"); on save reloads statements + trend.
 *  - GET /admin/billing/trend?months=12 — "Platform revenue by stream" stacked bar chart
 *    (recharts, same 4 streams/colours, tooltip "<Month> — N subscribed"); error → retry.
 *  - GET /admin/billing/statements?month=YYYY-MM — month navigator (previous / next,
 *    next disabled at the current Dubai month); KPIs Gross billed / Providers billed /
 *    Lease events / Settlements show "…" while loading and "—" on error (never AED 0).
 *  - Provider statements table (Subscription, New leases, Renewals, Settlements, Net, VAT,
 *    Gross) with totals footer + the billable-events footnote; error → retry; empty copy.
 *  - Per-provider drill-down (was an expandable row, now an "Open" Drawer, same content):
 *    GET /admin/billing/statements/:rpId?month= — line items (subscription, new lease /
 *    renewal per contract, settlements) with Net / VAT / Gross; GET /admin/billing/receipts
 *    ?month= — existing RP invoice + UpNow-Admin receipt for that provider; POST
 *    /admin/billing/receipts/:rpId?month= — "Issue receipts" (only when gross > 0);
 *    "PDF" per receipt → downloadPlatformReceipt (REUSED, unchanged).
 *  - Fee Edit / Save / Cancel are LABELLED buttons (the old ones were icon-only).
 *  New: provider search over the statement rows (name, email, #id), a "Platform fees, not
 *  rent" money-rule callout. No manager route re-exports this page.
 */
'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { downloadPlatformReceipt, type PlatformReceiptDoc } from '@/components/upnow/PlatformReceiptPdf';
import {
  Btn, Callout, Card, Cols, Drawer, EmptyRow, KV, Kpi, Kpis, Locked, OsPage, PageHead, Pill, ScopeStrip, SearchField,
  SkeletonRows, TableWrap, fmtAed, fmtDate,
} from '@/components/os/kit';

/* ── API types (exact contract) ── */
interface BillingFees {
  subscriptionAed: number; leaseOriginationAed: number;
  leaseRenewalAed: number; leaseSettlementAed: number;
}
interface BillingConfig { vatRatePct: number; fees: BillingFees }
interface StatementRow {
  rentalProviderId: number; name: string; email: string | null; joinedAt: string;
  subscriptionAed: number;
  newLeaseCount: number; newLeaseAed: number;
  renewalCount: number; renewalAed: number;
  settlementCount: number; settlementAed: number;
  netAed: number; vatAed: number; grossAed: number;
}
interface Statements {
  month: string; vatRatePct: number; fees: BillingFees;
  totals: {
    providers: number; subscribedProviders: number;
    newLeases: number; renewals: number; settlements: number;
    subscriptionAed: number; newLeaseAed: number; renewalAed: number; settlementAed: number;
    netAed: number; vatAed: number; grossAed: number;
  };
  rows: StatementRow[];
}
interface LeaseLine {
  contractId: number; kind: 'new' | 'renewal'; activatedAt: string; status: string;
  startDate: string; endDate: string; annualRentAed: number | null;
  unitLabel: string; tenantName: string | null; feeAed: number;
}
interface SettlementLine {
  settlementId: number; contractId: number; paidAt: string; refundAed: number | null;
  unitLabel: string; tenantName: string | null; feeAed: number;
}
interface ProviderStatement {
  month: string;
  provider: { rentalProviderId: number; name: string; email: string | null; joinedAt: string };
  subscription: { periodMonth: string; feeAed: number } | null;
  leases: LeaseLine[];
  settlements: SettlementLine[];
  totals: Omit<StatementRow, 'rentalProviderId' | 'name' | 'email' | 'joinedAt'>;
}
interface TrendPoint {
  // `subscribers` = providers paying the monthly subscription that month.
  month: string; subscribers: number; newLeases: number; renewals: number; settlements: number;
  subscriptionAed: number; newLeaseAed: number; renewalAed: number; settlementAed: number;
  netAed: number; vatAed: number;
}
interface Trend { months: TrendPoint[]; vatRatePct: number }

/* Stream palette (validated earlier): GREEN sub · BLUE origination · AMBER renewal · PURPLE settlement. */
const GREEN = '#047246', BLUE = '#3b6fb5', AMBER = '#d97706', PURPLE = '#7c3aed';
const tooltipStyle = { borderRadius: 12, border: '1px solid #e4e9e5', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };
const STREAMS = [
  { key: 'subscriptionAed', label: 'Subscription', color: GREEN },
  { key: 'newLeaseAed', label: 'Lease origination', color: BLUE },
  { key: 'renewalAed', label: 'Renewals', color: AMBER },
  { key: 'settlementAed', label: 'Settlements', color: PURPLE },
] as const;

/* ── Formatting ── whole AED; fractional (VAT) always 2 dp so a column stays aligned. */
const fmtAED = (n: number | null | undefined) => (n == null ? '—' : fmtAed(n, !Number.isInteger(n)));
const aedAxis = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : String(v));
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthShort(m: string): string { const [y, mo] = m.split('-').map(Number); return `${MONTH_NAMES[mo - 1]} ${String(y).slice(2)}`; }
function monthLong(m: string): string { const [y, mo] = m.split('-').map(Number); return `${MONTH_LONG[mo - 1]} ${y}`; }
/** Current month in Asia/Dubai (UTC+4). */
function currentMonth(): string { return new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7); }
function shiftMonth(m: string, delta: 1 | -1): string {
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/* ── Fee schedule card (SUPER_ADMIN can edit) ── */
const FEE_META: { key: keyof BillingFees; label: string; trigger: string }[] = [
  { key: 'subscriptionAed', label: 'Platform subscription', trigger: 'per provider / month' },
  { key: 'leaseOriginationAed', label: 'Lease origination', trigger: 'per new lease activated' },
  { key: 'leaseRenewalAed', label: 'Lease renewal', trigger: 'per renewal activated' },
  { key: 'leaseSettlementAed', label: 'Lease settlement', trigger: 'per settlement completed' },
];

function FeeScheduleCard({ config, canEdit, onSaved }: {
  config: BillingConfig; canEdit: boolean; onSaved: (c: BillingConfig) => void;
}) {
  const [editing, setEditing] = useState<keyof BillingFees | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    // Number() (not parseInt) so '499.5' / '3e2' are rejected, not truncated.
    const aed = Number(draft);
    if (!Number.isInteger(aed) || aed < 0 || aed > 100_000) { setError('Whole AED, 0–100,000'); return; }
    setSaving(true); setError(null);
    try {
      const next = await apiPatch<BillingConfig>('/admin/billing/config', { [editing!]: aed });
      onSaved(next);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }
  const cancel = () => { setEditing(null); setError(null); };

  return (
    <Card title="Fee schedule" sub={`Exclusive of ${config.vatRatePct}% VAT`}>
      <table className="gx-tbl">
        <thead><tr><th>Fee</th><th className="num">Amount</th>{canEdit && <th className="act">Action</th>}</tr></thead>
        <tbody>
          {FEE_META.map((f) => (
            <tr key={f.key}>
              <td><span className="strong">{f.label}</span><span className="sub">{f.trigger}</span></td>
              <td className="num">
                {editing === f.key ? (
                  <input
                    autoFocus type="number" min={0} max={100000} value={draft} aria-label={`${f.label} in whole AED`}
                    className="gx-inp" style={{ width: 96, textAlign: 'right' }}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !saving) save();
                      if (e.key === 'Escape') cancel();
                    }}
                  />
                ) : <span className="strong">{fmtAED(config.fees[f.key])}</span>}
              </td>
              {canEdit && (
                <td className="act">
                  {editing === f.key ? (
                    <span className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
                      <Btn size="xs" variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
                      <Btn size="xs" onClick={cancel}>Cancel</Btn>
                    </span>
                  ) : (
                    <Btn size="xs" onClick={() => { setEditing(f.key); setDraft(String(config.fees[f.key])); setError(null); }}>Edit</Btn>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="gx-pad">
        {error && <Callout tone="bad">{error}</Callout>}
        {!canEdit && <div className="gx-hint">Fee edits are super-admin only.</div>}
      </div>
    </Card>
  );
}

/* ── Provider drill-down (line items for one month) — shown in the Drawer ── */
function ProviderDetail({ rpId, month }: { rpId: number; month: string }) {
  const [detail, setDetail] = useState<ProviderStatement | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setDetail(null); setFailed(false);
      apiGet<ProviderStatement>(`/admin/billing/statements/${rpId}?month=${month}`)
        .then((d) => { if (live) setDetail(d); })
        .catch(() => { if (live) setFailed(true); });
    }, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [rpId, month, attempt]);

  // Issued receipts for this provider-month (RP tax invoice + UpNow-Admin receipt).
  const [receipts, setReceipts] = useState<{ rpInvoice: PlatformReceiptDoc; upnowAdmin: PlatformReceiptDoc } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [receiptErr, setReceiptErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setReceipts(null); setReceiptErr(null);
      apiGet<{ month: string; receipts: PlatformReceiptDoc[] }>(`/admin/billing/receipts?month=${month}`)
        .then((d) => {
          if (!live) return;
          const mine = d.receipts.filter((r) => r.rentalProviderId === rpId);
          const rp = mine.find((r) => r.series === 'rp_invoice');
          const adm = mine.find((r) => r.series === 'upnow_admin');
          if (rp && adm) setReceipts({ rpInvoice: rp, upnowAdmin: adm });
        })
        .catch(() => {});
    }, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [rpId, month]);

  const issueReceipts = async () => {
    setIssuing(true); setReceiptErr(null);
    try {
      const d = await apiPost<{ rpInvoice: PlatformReceiptDoc; upnowAdmin: PlatformReceiptDoc }>(
        `/admin/billing/receipts/${rpId}?month=${month}`,
      );
      setReceipts({ rpInvoice: d.rpInvoice, upnowAdmin: d.upnowAdmin });
    } catch (e) {
      setReceiptErr((e as Error)?.message || 'Could not issue receipts');
    } finally {
      setIssuing(false);
    }
  };

  if (failed) {
    return (
      <Callout tone="bad" title="Could not load line items.">
        <div style={{ marginTop: 6 }}><Btn size="sm" onClick={() => setAttempt((a) => a + 1)}>Try again</Btn></div>
      </Callout>
    );
  }

  const rows: { key: string; date: string; kind: ReactNode; what: string; who: string; fee: number }[] = detail ? [
    ...(detail.subscription ? [{
      key: 'sub', date: monthLong(detail.subscription.periodMonth),
      kind: <Pill tone="primary">Subscription</Pill>, what: 'Platform subscription', who: '—', fee: detail.subscription.feeAed,
    }] : []),
    ...detail.leases.map((l) => ({
      key: `lease-${l.contractId}`, date: fmtDate(l.activatedAt),
      kind: l.kind === 'new' ? <Pill tone="info">New lease</Pill> : <Pill tone="amber">Renewal</Pill>,
      what: `Contract #${l.contractId} · ${l.unitLabel}`, who: l.tenantName ?? '—', fee: l.feeAed,
    })),
    ...detail.settlements.map((s) => ({
      key: `set-${s.settlementId}`, date: fmtDate(s.paidAt),
      kind: <Pill tone="dark">Settlement</Pill>,
      what: `Contract #${s.contractId} · ${s.unitLabel}`, who: s.tenantName ?? '—', fee: s.feeAed,
    })),
  ] : [];

  return (
    <>
      {detail && (
        <div style={{ marginBottom: 14 }}>
          <KV items={[
            { k: 'Provider', v: detail.provider.name },
            { k: 'Email', v: detail.provider.email ?? `#${detail.provider.rentalProviderId}` },
            { k: 'Joined', v: fmtDate(detail.provider.joinedAt) },
            { k: 'Month', v: monthLong(month) },
          ]} />
        </div>
      )}
      <TableWrap>
        <table className="gx-tbl">
          <thead><tr><th>Date</th><th>Item</th><th>Customer</th><th className="num">Fee</th></tr></thead>
          {!detail ? <SkeletonRows rows={3} cols={4} /> : rows.length === 0 ? (
            <EmptyRow cols={4} title="No billable items this month." />
          ) : (
            <>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="nowrap">{r.date}</td>
                    <td><div className="gx-cell">{r.kind}<span className="strong">{r.what}</span></div></td>
                    <td>{r.who}</td>
                    <td className="num strong">{fmtAED(r.fee)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3} className="num">Net</td><td className="num strong">{fmtAED(detail.totals.netAed)}</td></tr>
                <tr><td colSpan={3} className="num">VAT 5%</td><td className="num">{fmtAED(detail.totals.vatAed)}</td></tr>
                <tr><td colSpan={3} className="num strong">Gross</td><td className="num strong">{fmtAED(detail.totals.grossAed)}</td></tr>
              </tfoot>
            </>
          )}
        </table>
      </TableWrap>

      {/* Receipts — the RP tax invoice + UpNow-Admin receipt (gapless numbered) */}
      {detail && detail.totals.grossAed > 0 && (
        <div style={{ marginTop: 14 }}>
          <Card title="Receipts" right={!receipts && (
            <Btn size="sm" variant="primary" onClick={issueReceipts} disabled={issuing}>{issuing ? 'Issuing…' : 'Issue receipts'}</Btn>
          )}>
            <div className="gx-pad">
              {receiptErr && <div style={{ marginBottom: 8 }}><Callout tone="bad">{receiptErr}</Callout></div>}
              {receipts ? (
                <table className="gx-tbl">
                  <tbody>
                    {[receipts.rpInvoice, receipts.upnowAdmin].map((r) => (
                      <tr key={r.series}>
                        <td className="strong">{r.docType}</td>
                        <td className="mono">{r.receiptNo}</td>
                        <td className="act">
                          <Btn size="xs" onClick={() => downloadPlatformReceipt(r)}><Download size={12} aria-hidden /> PDF</Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="gx-hint">
                  Issue the Rental-Provider tax invoice (UPN-RP) + UpNow-Admin receipt (UPN-ADM) for {monthLong(month)} — each a separate gapless numbered series.
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/* ── Page ── */
export default function AdminBillingPage() {
  const { user } = useAuth();
  const allowed = user?.role === 'super_admin' || user?.role === 'admin';
  const isSuperAdmin = user?.role === 'super_admin';

  const [month, setMonth] = useState(currentMonth());
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [statements, setStatements] = useState<Statements | null>(null);
  const [stmtError, setStmtError] = useState(false);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [trendFailed, setTrendFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openRow, setOpenRow] = useState<StatementRow | null>(null);
  const [q, setQ] = useState('');

  const loadConfig = useCallback(() => {
    setConfigFailed(false);
    apiGet<BillingConfig>('/admin/billing/config').then(setConfig).catch(() => setConfigFailed(true));
  }, []);
  const loadTrend = useCallback(() => {
    setTrendFailed(false);
    apiGet<Trend>('/admin/billing/trend?months=12').then(setTrend).catch(() => setTrendFailed(true));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => { loadConfig(); loadTrend(); }, 0);
    return () => clearTimeout(timer);
  }, [allowed, loadConfig, loadTrend]);

  const loadStatements = useCallback((m: string) => {
    setLoading(true);
    setOpenRow(null);
    setStmtError(false);
    apiGet<Statements>(`/admin/billing/statements?month=${m}`)
      .then(setStatements)
      .catch(() => { setStatements(null); setStmtError(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => loadStatements(month), 0);
    return () => clearTimeout(timer);
  }, [allowed, month, loadStatements]);

  const visibleRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = statements?.rows ?? [];
    return s ? rows.filter((r) => [r.name, r.email, `#${r.rentalProviderId}`].some((x) => x?.toLowerCase().includes(s))) : rows;
  }, [statements, q]);

  if (!allowed) {
    return (
      <OsPage>
        <Locked title="Admin access required." text="Platform billing is available to admins and super-admins only." />
      </OsPage>
    );
  }

  // Undefined while loading/errored so KPI sub-labels never show a stale month's figures.
  const t = !loading && !stmtError ? statements?.totals : undefined;
  const kpiVal = (v: string) => (loading ? '…' : stmtError ? '—' : v);
  const chartData = (trend?.months ?? []).map((p) => ({ ...p, label: monthShort(p.month) }));
  const atCurrent = month >= currentMonth();

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Spaces"
        title="Platform billing"
        lede="Agency model — what UpNow bills each rental provider for the month. Rent flows customer → provider; these are platform fees only."
        actions={<>
          <Btn size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} title="Previous month"><ChevronLeft size={14} aria-hidden /> Previous</Btn>
          <Pill tone="dark" dot={false}>{monthLong(month)}</Pill>
          <Btn size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={atCurrent} title="Next month">Next <ChevronRight size={14} aria-hidden /></Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Spaces' },
        { label: 'Month', value: monthLong(month) },
        { label: 'VAT', value: `${statements?.vatRatePct ?? config?.vatRatePct ?? 5}% — separate line` },
        { label: 'Fees', value: isSuperAdmin ? 'Editable (super-admin)' : 'Read-only' },
      ]} />

      {/* '—' on fetch failure so an error is never mistaken for AED 0 */}
      <Kpis>
        <Kpi dark k="Gross billed" v={kpiVal(fmtAED(t?.grossAed ?? 0))} d={t ? `${fmtAED(t.netAed)} net + ${fmtAED(t.vatAed)} VAT` : undefined} />
        <Kpi k="Providers billed" v={kpiVal(String(t?.providers ?? 0))} d={t && statements ? `${t.subscribedProviders} × ${fmtAED(statements.fees.subscriptionAed)}/mo subscription` : undefined} />
        <Kpi k="Lease events" v={kpiVal(String((t?.newLeases ?? 0) + (t?.renewals ?? 0)))} d={t ? `${t.newLeases} new · ${t.renewals} renewals` : undefined} />
        <Kpi k="Settlements" v={kpiVal(String(t?.settlements ?? 0))} d="settlement & closure completed" />
      </Kpis>

      <div style={{ marginBottom: 14 }}>
        <Callout tone="info" title="Platform fees, not rent.">
          UpNow bills each provider a monthly subscription plus per-event fees (origination, renewal, settlement) in whole AED, exclusive of VAT.
          VAT is always its own line and never folded into net; rent flows customer → provider and never passes through these statements. Fee changes are super-admin only and apply at current rates.
        </Callout>
      </div>

      <Cols kind="2">
        <Card title="Platform revenue by stream" sub="Net AED per month, last 12 months, at current fee rates — historical activity included.">
          <div className="gx-pad" style={{ height: 260 }}>
            {trendFailed ? (
              <Callout tone="bad" title="Could not load the revenue trend.">
                <div style={{ marginTop: 6 }}><Btn size="sm" onClick={loadTrend}>Try again</Btn></div>
              </Callout>
            ) : !trend ? (
              <div className="gx-skel" style={{ height: '100%' }} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8a948d' }} axisLine={{ stroke: '#e4e9e5' }} tickLine={false} />
                  <YAxis tickFormatter={aedAxis} tick={{ fontSize: 10, fill: '#8a948d' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) => [fmtAED(Number(v)), String(name)]}
                    labelFormatter={(l, payload) => {
                      const p = payload?.[0]?.payload as TrendPoint | undefined;
                      return p ? `${monthLong(p.month)} — ${p.subscribers} subscribed` : String(l);
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                  {STREAMS.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} stackId="rev" fill={s.color} maxBarSize={34} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        {config ? (
          <FeeScheduleCard
            config={config}
            canEdit={!!isSuperAdmin}
            onSaved={(c) => { setConfig(c); loadStatements(month); loadTrend(); }}
          />
        ) : (
          <Card title="Fee schedule">
            <div className="gx-pad">
              {configFailed ? (
                <Callout tone="bad" title="Could not load the fee schedule.">
                  <div style={{ marginTop: 6 }}><Btn size="sm" onClick={loadConfig}>Try again</Btn></div>
                </Callout>
              ) : <div className="gx-skel" style={{ height: 120 }} />}
            </div>
          </Card>
        )}
      </Cols>

      <TableWrap toolbar={<>
        <span className="strong">Provider statements — {monthLong(month)}</span>
        <span className="gx-hint">{loading ? '…' : `${statements?.rows.length ?? 0} providers`}</span>
        <div style={{ marginLeft: 'auto' }}><SearchField value={q} onChange={setQ} placeholder="Search provider, email or #id" /></div>
      </>}>
        <table className="gx-tbl">
          <thead>
            <tr>
              <th>Provider</th><th className="num">Subscription</th><th className="num">New leases</th>
              <th className="num">Renewals</th><th className="num">Settlements</th><th className="num">Net</th>
              <th className="num">VAT</th><th className="num">Gross</th><th className="act">Action</th>
            </tr>
          </thead>
          {loading ? <SkeletonRows rows={5} cols={9} /> : stmtError ? (
            <tbody><tr><td colSpan={9}>
              <div className="gx-empty">
                <b>Could not load statements for {monthLong(month)}</b>
                The figures above are unavailable, not zero.
                <div style={{ marginTop: 8 }}><Btn size="sm" onClick={() => loadStatements(month)}>Try again</Btn></div>
              </div>
            </td></tr></tbody>
          ) : !statements || statements.rows.length === 0 ? (
            <EmptyRow cols={9} title="No billable activity or providers in this month." text="Use Previous to look at an earlier month." />
          ) : visibleRows.length === 0 ? (
            <EmptyRow cols={9} title="No providers match" text="Clear the search to see every statement." />
          ) : (
            <>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.rentalProviderId} className="click" onClick={() => setOpenRow(r)}>
                    <td><span className="strong">{r.name}</span><span className="sub">{r.email ?? `#${r.rentalProviderId}`}</span></td>
                    <td className="num">{fmtAED(r.subscriptionAed)}</td>
                    <td className="num">{r.newLeaseCount > 0 ? <>{r.newLeaseCount} · <b>{fmtAED(r.newLeaseAed)}</b></> : '—'}</td>
                    <td className="num">{r.renewalCount > 0 ? <>{r.renewalCount} · <b>{fmtAED(r.renewalAed)}</b></> : '—'}</td>
                    <td className="num">{r.settlementCount > 0 ? <>{r.settlementCount} · <b>{fmtAED(r.settlementAed)}</b></> : '—'}</td>
                    <td className="num strong">{fmtAED(r.netAed)}</td>
                    <td className="num">{fmtAED(r.vatAed)}</td>
                    <td className="num strong">{fmtAED(r.grossAed)}</td>
                    <td className="act" onClick={(e) => e.stopPropagation()}>
                      <Btn size="xs" onClick={() => setOpenRow(r)}>Open</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="strong">Total — {statements.totals.providers} providers{q.trim() ? ' (all, not just matches)' : ''}</td>
                  <td className="num strong">{fmtAED(statements.totals.subscriptionAed)}</td>
                  <td className="num strong">{fmtAED(statements.totals.newLeaseAed)}</td>
                  <td className="num strong">{fmtAED(statements.totals.renewalAed)}</td>
                  <td className="num strong">{fmtAED(statements.totals.settlementAed)}</td>
                  <td className="num strong">{fmtAED(statements.totals.netAed)}</td>
                  <td className="num strong">{fmtAED(statements.totals.vatAed)}</td>
                  <td className="num strong">{fmtAED(statements.totals.grossAed)}</td>
                  <td />
                </tr>
              </tfoot>
            </>
          )}
        </table>
      </TableWrap>
      <div style={{ marginTop: 12 }}>
        <Callout tone="info" title="Billable events.">
          New lease / renewal on activation (amendments excluded) · settlement on payment (once per tenancy chain) · monthly subscription for every provider existing in the month.
          History included from each lease&apos;s real activation month. VAT {statements?.vatRatePct ?? 5}% shown separately. Receipts are issued per provider from the provider&apos;s statement.
        </Callout>
      </div>

      <Drawer
        open={!!openRow}
        onClose={() => setOpenRow(null)}
        title={openRow?.name ?? ''}
        sub={openRow ? `Statement · ${monthLong(month)} · ${fmtAED(openRow.grossAed)} gross` : undefined}
        footer={<Btn onClick={() => setOpenRow(null)}>Close</Btn>}
      >
        {openRow && <ProviderDetail rpId={openRow.rentalProviderId} month={month} />}
      </Drawer>
    </OsPage>
  );
}
