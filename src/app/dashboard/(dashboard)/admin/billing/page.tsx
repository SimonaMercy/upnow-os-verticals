/**
 * Admin: Platform Billing (dashboard/admin/billing)
 *
 * RP commercial model (agency, final recommendation) — what UpNow bills each
 * Rental Provider per calendar month: platform subscription (AED 499/mo) +
 * lease origination (AED 300, new lease activated) + lease renewal (AED 100)
 * + lease settlement (AED 100, settlement paid). VAT (5%) is always its own
 * line, never folded into net. Phase 1 = statement CALCULATOR with per-provider
 * drill-down; invoice generation is a later phase.
 *
 * Fee amounts are versioned in fee_config; editing is SUPER_ADMIN-only.
 * Backend contract: /admin/billing/* . All money WHOLE AED (VAT can be 2dp).
 */
'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Receipt, Landmark, FilePlus2, RefreshCw, Scale, ChevronLeft, ChevronRight,
  ChevronDown, Loader2, Pencil, Check, X, Building2, Users,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { apiGet, apiPatch } from '@/lib/api';

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
    providers: number; newLeases: number; renewals: number; settlements: number;
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
  totals: StatementRow extends infer _ ? Omit<StatementRow, 'rentalProviderId' | 'name' | 'email' | 'joinedAt'> : never;
}
interface TrendPoint {
  month: string; providers: number; newLeases: number; renewals: number; settlements: number;
  subscriptionAed: number; newLeaseAed: number; renewalAed: number; settlementAed: number;
  netAed: number; vatAed: number;
}
interface Trend { months: TrendPoint[]; vatRatePct: number }

/* ── Style constants (match admin/risk generation) ──
   Stream palette validated (dataviz six checks, light surface):
   GREEN sub · BLUE origination · AMBER renewal · PURPLE settlement. */
const GREEN = '#2e9f82', BLUE = '#3b6fb5', AMBER = '#d97706', PURPLE = '#7c3aed';
const tooltipStyle = { borderRadius: 12, border: '1px solid #e8e6e0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };

const STREAMS = [
  { key: 'subscriptionAed', label: 'Subscription', color: GREEN },
  { key: 'newLeaseAed', label: 'Lease origination', color: BLUE },
  { key: 'renewalAed', label: 'Renewals', color: AMBER },
  { key: 'settlementAed', label: 'Settlements', color: PURPLE },
] as const;

/* ── Formatting helpers ── */
function fmtAED(n: number | null | undefined): string {
  if (n == null) return '—';
  return `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}
const aedAxis = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K` : String(v));
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthShort(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${String(y).slice(2)}`;
}
function monthLong(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return `${['January','February','March','April','May','June','July','August','September','October','November','December'][mo - 1]} ${y}`;
}
function currentMonth(): string {
  return new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);
}
function shiftMonth(m: string, delta: 1 | -1): string {
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
}

/* ── Small building blocks ── */
function KpiTile({ icon: Icon, label, value, sub }: {
  icon: React.ComponentType<{ size?: number }>; label: string; value: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">
        <Icon size={12} /> {label}
      </div>
      <p className="text-xl font-bold mt-1.5 leading-none text-[#1a1916]">{value}</p>
      {sub && <p className="text-[11px] text-[#9b9890] mt-1.5">{sub}</p>}
    </div>
  );
}

function StreamChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6b6860]">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

function KindChip({ kind }: { kind: 'new' | 'renewal' }) {
  const c = kind === 'new' ? BLUE : AMBER;
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: `${c}1a`, color: c }}>
      {kind === 'new' ? 'New lease' : 'Renewal'}
    </span>
  );
}

/* ── Fee schedule card (SUPER_ADMIN can edit) ── */
const FEE_META: { key: keyof BillingFees; label: string; trigger: string; color: string }[] = [
  { key: 'subscriptionAed', label: 'Platform subscription', trigger: 'per provider / month', color: GREEN },
  { key: 'leaseOriginationAed', label: 'Lease origination', trigger: 'per new lease activated', color: BLUE },
  { key: 'leaseRenewalAed', label: 'Lease renewal', trigger: 'per renewal activated', color: AMBER },
  { key: 'leaseSettlementAed', label: 'Lease settlement', trigger: 'per settlement completed', color: PURPLE },
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

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#1a1916]">Fee schedule</h3>
        <span className="text-[10px] text-[#9b9890]">exclusive of {config.vatRatePct}% VAT</span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {FEE_META.map((f) => (
          <li key={f.key} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-[#1a1916] leading-tight">{f.label}</p>
              <p className="text-[10px] text-[#9b9890]">{f.trigger}</p>
            </div>
            {editing === f.key ? (
              <span className="flex items-center gap-1">
                <input
                  autoFocus type="number" min={0} max={100000} value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !saving) save();
                    if (e.key === 'Escape') { setEditing(null); setError(null); }
                  }}
                  className="w-20 px-1.5 py-0.5 text-[12px] text-right border border-[#e8e6e0] rounded-md focus:outline-none focus:border-[#2e9f82]"
                />
                <button onClick={save} disabled={saving} className="p-1 rounded-md text-[#1a7a5a] hover:bg-[#f0faf6]" title="Save">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </button>
                <button onClick={() => { setEditing(null); setError(null); }} className="p-1 rounded-md text-[#9b9890] hover:bg-[#f5f4f0]" title="Cancel">
                  <X size={13} />
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-[#1a1916] tabular-nums">{fmtAED(config.fees[f.key])}</span>
                {canEdit && (
                  <button
                    onClick={() => { setEditing(f.key); setDraft(String(config.fees[f.key])); setError(null); }}
                    className="p-1 rounded-md text-[#9b9890] hover:bg-[#f5f4f0]" title="Edit fee"
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-[11px] text-[#b91c1c] mt-2">{error}</p>}
      {!canEdit && <p className="text-[10px] text-[#9b9890] mt-3">Fee edits are super-admin only.</p>}
    </div>
  );
}

/* ── Provider drill-down (line items for one month) ── */
function ProviderDetail({ rpId, month }: { rpId: number; month: string }) {
  const [detail, setDetail] = useState<ProviderStatement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setDetail(null); setFailed(false);
    apiGet<ProviderStatement>(`/admin/billing/statements/${rpId}?month=${month}`)
      .then((d) => { if (live) setDetail(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [rpId, month]);

  if (failed) return <p className="text-[12px] text-[#9b9890] py-3">Could not load line items.</p>;
  if (!detail) return <p className="text-[12px] text-[#9b9890] py-3 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading line items…</p>;

  const rows: { key: string; date: string; what: React.ReactNode; who: string; fee: number }[] = [
    ...(detail.subscription ? [{
      key: 'sub',
      date: `${monthLong(detail.subscription.periodMonth)}`,
      what: <StreamChip color={GREEN}>Platform subscription</StreamChip>,
      who: '—',
      fee: detail.subscription.feeAed,
    }] : []),
    ...detail.leases.map((l) => ({
      key: `lease-${l.contractId}`,
      date: fmtDate(l.activatedAt),
      what: (
        <span className="flex items-center gap-2 min-w-0">
          <KindChip kind={l.kind} />
          <span className="truncate text-[#1a1916]">Contract #{l.contractId} · {l.unitLabel}</span>
        </span>
      ),
      who: l.tenantName ?? '—',
      fee: l.feeAed,
    })),
    ...detail.settlements.map((s) => ({
      key: `set-${s.settlementId}`,
      date: fmtDate(s.paidAt),
      what: (
        <span className="flex items-center gap-2 min-w-0">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: `${PURPLE}1a`, color: PURPLE }}>Settlement</span>
          <span className="truncate text-[#1a1916]">Contract #{s.contractId} · {s.unitLabel}</span>
        </span>
      ),
      who: s.tenantName ?? '—',
      fee: s.feeAed,
    })),
  ];

  return (
    <div className="py-2">
      {rows.length === 0 ? (
        <p className="text-[12px] text-[#9b9890] py-2">No billable items this month.</p>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890]">
              <th className="py-1.5 font-semibold w-28">Date</th>
              <th className="py-1.5 font-semibold">Item</th>
              <th className="py-1.5 font-semibold w-44">Customer</th>
              <th className="py-1.5 font-semibold text-right w-24">Fee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0ede8]">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1.5 text-[#6b6860] whitespace-nowrap">{r.date}</td>
                <td className="py-1.5 pr-3">{r.what}</td>
                <td className="py-1.5 text-[#6b6860] truncate max-w-44">{r.who}</td>
                <td className="py-1.5 text-right font-semibold text-[#1a1916] tabular-nums">{fmtAED(r.fee)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#e8e6e0]">
              <td colSpan={3} className="py-1.5 text-right text-[#6b6860]">Net</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{fmtAED(detail.totals.netAed)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="py-1 text-right text-[#6b6860]">VAT 5%</td>
              <td className="py-1 text-right text-[#6b6860] tabular-nums">{fmtAED(detail.totals.vatAed)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="py-1.5 text-right font-bold text-[#1a1916]">Gross</td>
              <td className="py-1.5 text-right font-bold text-[#1a1916] tabular-nums">{fmtAED(detail.totals.grossAed)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
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
  const [expanded, setExpanded] = useState<number | null>(null);

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
    loadConfig();
    loadTrend();
  }, [allowed, loadConfig, loadTrend]);

  const loadStatements = useCallback((m: string) => {
    setLoading(true);
    setExpanded(null);
    setStmtError(false);
    apiGet<Statements>(`/admin/billing/statements?month=${m}`)
      .then(setStatements)
      .catch(() => { setStatements(null); setStmtError(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (allowed) loadStatements(month); }, [allowed, month, loadStatements]);

  if (!allowed) return <p className="p-8 text-sm text-[#9b9890]">Admin access required.</p>;

  const t = statements?.totals;
  const chartData = (trend?.months ?? []).map((p) => ({ ...p, label: monthShort(p.month) }));

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-52">
          <h1 className="text-xl font-bold text-[#1a1916] flex items-center gap-2">
            <Receipt size={20} className="text-[#2e9f82]" /> Platform Billing
          </h1>
          <p className="text-[12px] text-[#9b9890] mt-0.5">
            Agency model — what UpNow bills each rental provider for the month. Rent flows tenant → provider; these are platform fees only.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-[#e8e6e0] rounded-xl px-1.5 py-1">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="p-1.5 rounded-lg hover:bg-[#f5f4f0] text-[#6b6860]" title="Previous month">
            <ChevronLeft size={15} />
          </button>
          <span className="text-[13px] font-semibold text-[#1a1916] min-w-28 text-center">{monthLong(month)}</span>
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={month >= currentMonth()}
            className="p-1.5 rounded-lg hover:bg-[#f5f4f0] text-[#6b6860] disabled:opacity-30"
            title="Next month"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* KPI row — '—' on fetch failure so an error is never mistaken for AED 0 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile icon={Landmark} label="Gross billed" value={loading ? '…' : stmtError ? '—' : fmtAED(t?.grossAed ?? 0)} sub={t ? `${fmtAED(t.netAed)} net + ${fmtAED(t.vatAed)} VAT` : undefined} />
        <KpiTile icon={Users} label="Providers billed" value={loading ? '…' : stmtError ? '—' : String(t?.providers ?? 0)} sub={`subscription ${fmtAED(statements?.fees.subscriptionAed ?? config?.fees.subscriptionAed ?? 499)}/mo each`} />
        <KpiTile icon={FilePlus2} label="Lease events" value={loading ? '…' : stmtError ? '—' : String((t?.newLeases ?? 0) + (t?.renewals ?? 0))} sub={t ? `${t.newLeases} new · ${t.renewals} renewals` : undefined} />
        <KpiTile icon={Scale} label="Settlements" value={loading ? '…' : stmtError ? '—' : String(t?.settlements ?? 0)} sub="settlement & closure completed" />
      </div>

      {/* Trend + fee schedule */}
      <div className="grid md:grid-cols-3 gap-3">
        <div className="md:col-span-2 bg-white rounded-2xl border border-[#e8e6e0] p-4">
          <h3 className="text-sm font-bold text-[#1a1916]">Platform revenue by stream</h3>
          <p className="text-[11px] text-[#9b9890] mt-0.5">Net AED per month, last 12 months, at current fee rates — historical activity included.</p>
          <div className="mt-2 h-56">
            {trendFailed ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-[12px] text-[#9b9890]">
                Could not load the revenue trend.
                <button onClick={loadTrend} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f5f4f0]">
                  <RefreshCw size={12} /> Retry
                </button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={{ stroke: '#e8e6e0' }} tickLine={false} />
                  <YAxis tickFormatter={aedAxis} tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) => [fmtAED(Number(v)), String(name)]}
                    labelFormatter={(l, payload) => {
                      const p = payload?.[0]?.payload as TrendPoint | undefined;
                      return p ? `${monthLong(p.month)} — ${p.providers} providers` : String(l);
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
        </div>
        {config ? (
          <FeeScheduleCard
            config={config}
            canEdit={!!isSuperAdmin}
            onSaved={(c) => { setConfig(c); loadStatements(month); loadTrend(); }}
          />
        ) : (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4 flex flex-col items-center justify-center gap-2 text-[12px] text-[#9b9890]">
            {configFailed ? (
              <>
                Could not load the fee schedule.
                <button onClick={loadConfig} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f5f4f0]">
                  <RefreshCw size={12} /> Retry
                </button>
              </>
            ) : (
              <span className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading fee schedule…</span>
            )}
          </div>
        )}
      </div>

      {/* Statement table */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0ede8]">
          <Building2 size={14} className="text-[#6b6860]" />
          <h3 className="text-sm font-bold text-[#1a1916] flex-1">Provider statements — {monthLong(month)}</h3>
          <span className="text-[11px] text-[#9b9890]">{statements?.rows.length ?? 0} providers</span>
        </div>

        {loading ? (
          <p className="px-4 py-8 text-[12px] text-center text-[#9b9890] flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Calculating statements…
          </p>
        ) : stmtError ? (
          <div className="px-4 py-8 text-[12px] text-center text-[#b91c1c] flex flex-col items-center gap-2">
            Could not load statements for {monthLong(month)} — the figures above are unavailable, not zero.
            <button onClick={() => loadStatements(month)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f5f4f0]">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : !statements || statements.rows.length === 0 ? (
          <p className="px-4 py-8 text-[12px] text-center text-[#9b9890]">No billable activity or providers in this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[760px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890] border-b border-[#f0ede8]">
                  <th className="px-4 py-2 font-semibold">Provider</th>
                  <th className="px-2 py-2 font-semibold text-right">Subscription</th>
                  <th className="px-2 py-2 font-semibold text-right">New leases</th>
                  <th className="px-2 py-2 font-semibold text-right">Renewals</th>
                  <th className="px-2 py-2 font-semibold text-right">Settlements</th>
                  <th className="px-2 py-2 font-semibold text-right">Net</th>
                  <th className="px-2 py-2 font-semibold text-right">VAT</th>
                  <th className="px-4 py-2 font-semibold text-right">Gross</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede8]">
                {statements.rows.map((r) => (
                  <Fragment key={r.rentalProviderId}>
                    <tr
                      onClick={() => setExpanded((e) => (e === r.rentalProviderId ? null : r.rentalProviderId))}
                      className="cursor-pointer hover:bg-[#fafaf8]"
                    >
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <ChevronDown size={13} className={`text-[#9b9890] transition-transform ${expanded === r.rentalProviderId ? '' : '-rotate-90'}`} />
                          <span className="min-w-0">
                            <span className="block font-semibold text-[#1a1916] truncate max-w-56">{r.name}</span>
                            <span className="block text-[10px] text-[#9b9890] truncate max-w-56">{r.email ?? `#${r.rentalProviderId}`}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[#6b6860]">{fmtAED(r.subscriptionAed)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[#6b6860]">
                        {r.newLeaseCount > 0 ? <>{r.newLeaseCount} · <span className="text-[#1a1916] font-semibold">{fmtAED(r.newLeaseAed)}</span></> : '—'}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[#6b6860]">
                        {r.renewalCount > 0 ? <>{r.renewalCount} · <span className="text-[#1a1916] font-semibold">{fmtAED(r.renewalAed)}</span></> : '—'}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[#6b6860]">
                        {r.settlementCount > 0 ? <>{r.settlementCount} · <span className="text-[#1a1916] font-semibold">{fmtAED(r.settlementAed)}</span></> : '—'}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-[#1a1916]">{fmtAED(r.netAed)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[#6b6860]">{fmtAED(r.vatAed)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-[#1a1916]">{fmtAED(r.grossAed)}</td>
                    </tr>
                    {expanded === r.rentalProviderId && (
                      <tr>
                        <td colSpan={8} className="px-10 pb-2 bg-[#fafaf8]">
                          <ProviderDetail rpId={r.rentalProviderId} month={month} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#e8e6e0] bg-[#fafaf8]">
                  <td className="px-4 py-2.5 font-bold text-[#1a1916]">Total — {statements.totals.providers} providers</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold">{fmtAED(statements.totals.subscriptionAed)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold">{fmtAED(statements.totals.newLeaseAed)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold">{fmtAED(statements.totals.renewalAed)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold">{fmtAED(statements.totals.settlementAed)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-bold text-[#1a1916]">{fmtAED(statements.totals.netAed)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold">{fmtAED(statements.totals.vatAed)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-[#1a7a5a]">{fmtAED(statements.totals.grossAed)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="px-4 py-2.5 text-[10px] text-[#9b9890] border-t border-[#f0ede8]">
          Billable events: new lease / renewal on activation (amendments excluded) · settlement on payment · subscription for every provider existing in the month.
          History included from each lease&apos;s real activation month. VAT {statements?.vatRatePct ?? 5}% shown separately. Statement view only — no invoices are issued from this page.
        </p>
      </div>
    </div>
  );
}
