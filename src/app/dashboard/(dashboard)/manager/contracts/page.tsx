/**
 * RP Contracts ("Orders") list page
 *
 * Implements the "UpNow RP Orders" design (Jun 3 design package):
 *   - Hero with eyebrow / display headline / tagline + Export & New CTAs
 *   - 5 KPIs strip (Total / Active / Expiring 60d / Declined renewals /
 *     Active rent per year — last one rendered as a dark accent card)
 *   - Tab row with status counts (preserves the existing 9-status
 *     synthetic set: active, terminating, pending, issued, expired,
 *     renewal_pending, declined, superseded, terminated + an
 *     upcoming_renewal computed bucket)
 *   - Filter row: search across ref/customer/email/unit/property,
 *     property selector, reset, results count
 *   - Single table card. Each row is a Link that navigates to the
 *     manager contract detail at /dashboard/manager/contracts/[id],
 *     which re-exports the canonical landlord v2 Quest layout (scoped by
 *     the now-manager-aware backend); the design's inline row-body is
 *     unused here so the page doesn't duplicate v2.
 *   - Pagination (10 per page)
 *
 * Data fetch and the canonical `displayStatusOf` derivation are unchanged
 * from the previous version of this file so the synthetic statuses
 * (declined / renewal_pending / superseded / terminating) keep matching
 * what the lifecycle spec (docs/CONTRACT_LIFECYCLE.md) prescribes.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Search, X, FileText, ChevronLeft, ChevronRight, Plus,
  Bell, Download, Clock, RotateCcw, Shield, Coins, Lock,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { liveTenantIdSet } from '@/lib/activeCustomer';

// ────────────────────────────────────────────────────────────────────────────
// Status model (preserved from previous version)
// ────────────────────────────────────────────────────────────────────────────

type ContractStatus = 'active' | 'expired' | 'terminated' | 'pending' | 'issued';
type DisplayStatus = ContractStatus | 'declined' | 'needs_activation' | 'starts_later' | 'superseded' | 'terminating';
type TabKey = DisplayStatus | 'all' | 'upcoming_renewal';

const STATUS_LABELS: Record<DisplayStatus, string> = {
  active:           'Active',
  expired:          'Expired',
  terminated:       'Terminated',
  pending:          'Draft',
  issued:           'In Progress',
  declined:         'Declined',
  needs_activation: 'Needs Activation',
  starts_later:     'Starts Later',
  superseded:       'Superseded',
  terminating:      'Terminating',
};

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',              label: 'All' },
  { key: 'active',           label: 'Active' },
  { key: 'terminating',      label: 'Terminating' },
  { key: 'needs_activation', label: 'Needs Activation' },
  { key: 'starts_later',     label: 'Starts Later' },
  { key: 'upcoming_renewal', label: 'Expiring ≤ 60d' },
  { key: 'issued',           label: 'In Progress' },
  { key: 'pending',          label: 'Draft' },
  { key: 'declined',         label: 'Declined' },
  { key: 'superseded',       label: 'Superseded' },
  { key: 'expired',          label: 'Expired' },
  { key: 'terminated',       label: 'Terminated' },
];

/** Local YYYY-MM-DD (no UTC shift) — the page's "today" for term-state checks. */
const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/** Map the raw DB status to a display status. Synthetic labels on top of the
 *  DB enum (docs/CONTRACT_LIFECYCLE.md §3 + §4.3) — mirrors the RP orders page:
 *    - `declined`         — renewal child where `contractActive=false`
 *    - `superseded`       — new-lease draft archived because the unit was
 *                           leased to a different customer first
 *    - `terminating`      — ACTIVE contract with accepted termination
 *    - `needs_activation` — `pending` contract whose term is ALREADY RUNNING
 *                           (the live lease in practice, awaiting activation)
 *    - `starts_later`     — `pending` contract whose term has not begun yet */
function displayStatusOf(c: Pick<Contract, 'status' | 'contractType' | 'contractActive' | 'termination' | 'startDate' | 'endDate'>): DisplayStatus {
  if (c.contractType === 'renewal' && c.contractActive === false) return 'declined';
  if (
    c.contractType !== 'renewal' &&
    c.contractActive === false &&
    (c.status === 'pending' || c.status === 'issued')
  ) {
    return 'superseded';
  }
  if (c.status === 'active' && c.termination?.response === 'accepted') return 'terminating';
  if (c.status === 'pending') {
    const s = (c.startDate ?? '').slice(0, 10);
    const e = (c.endDate ?? '').slice(0, 10);
    if (s && s > TODAY) return 'starts_later';
    if (s && s <= TODAY && e && e >= TODAY) return 'needs_activation';
  }
  return c.status;
}

const PAGE_SIZE = 10;

/** Compact page list: 1 … current-1 current current+1 … last (max 7 chips),
 *  so tabs with many pages (e.g. 200+ expired) don't stretch a full-width row. */
function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

interface Contract {
  id: number;
  ref: string;
  contractType: string | null;
  startDate: string;
  endDate: string;
  annualRent: number;
  status: ContractStatus;
  ejariStatus: string;
  contractActive: boolean;
  renewalStatus: string | null;
  createdAt: string;
  /** Operations vs Leases split: NULL = still in the Operations worklist. */
  lockedAt: string | null;
  tenant: { id: number | null; name: string | null; email: string | null };
  unit: { id: number | null; number: string | null; name: string | null };
  property: { id: number | null; buildingName: string | null };
  /** Termination snapshot — only present when a request has been raised. */
  termination?: {
    response: 'pending' | 'accepted' | 'rejected' | null;
    effectiveDate: string | null;
  } | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtShort(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: '2-digit' });
}

function fmtAedAmt(n: number): string {
  return n.toLocaleString('en-AE');
}

function initials(name: string | null): string {
  if (!name) return '—';
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function isExpiringSoon(c: Contract, now: Date, in60: Date): boolean {
  // Live tenancy = signed-active OR running-but-not-activated.
  const ds = displayStatusOf(c);
  if (ds !== 'active' && ds !== 'needs_activation') return false;
  const e = new Date(c.endDate);
  return e >= now && e <= in60;
}

function daysTo(iso: string, now: Date): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

function statusLabel(c: Contract): string {
  return STATUS_LABELS[displayStatusOf(c)];
}

// ────────────────────────────────────────────────────────────────────────────
// Row component
// ────────────────────────────────────────────────────────────────────────────

function Row({
  contract, now, in60,
}: { contract: Contract; now: Date; in60: Date }) {
  const c = contract;
  const ds = displayStatusOf(c);
  const soon = isExpiringSoon(c, now, in60);
  const d = soon ? daysTo(c.endDate, now) : null;
  const isRenewal = c.contractType === 'renewal';
  // The whole row links to the manager contract detail. That detail page reuses
  // the landlord v2 page (re-exported under /dashboard/manager/contracts/[id])
  // and is scoped by the now-manager-aware backend contract endpoints.
  return (
    <Link href={`/dashboard/manager/contracts/${c.id}/v2`} className="row">
      <div className="col-ref">
        <div className="av">{initials(c.tenant.name)}</div>
        <div className="info">
          <div className="ref">
            {c.ref}
            <span className={'type-chip ' + (isRenewal ? 'renewal' : '')}>{isRenewal ? 'Renewal' : 'New'}</span>
          </div>
          <div className="tenant">{c.tenant.name ?? '—'}</div>
        </div>
      </div>

      <div className="col-prop">
        <div className="unit">{c.unit.number ? `Unit ${c.unit.number}` : '—'}</div>
        <div className="bldg">{c.property.buildingName ?? '—'}</div>
      </div>

      <div className="col-term">
        <div className="span">{fmtShort(c.startDate)} – {fmtShort(c.endDate)}</div>
        <div className={'end-note ' + (soon ? 'soon' : '')}>
          {soon ? <span className="soon-pill">Expires {d}d</span> : <>Ends {fmtDate(c.endDate)}</>}
        </div>
      </div>

      <div className="col-rent">
        <div className="amt">AED {fmtAedAmt(c.annualRent)}</div>
        <div className="per">per year</div>
      </div>

      <div className="col-status">
        <span className={'status ' + ds}><span className="sd" />{statusLabel(c)}</span>
      </div>

      <div className="col-chev">
        <span className="cv"><ChevronRight size={16} /></span>
      </div>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────

export default function ManagerContractsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  // Effective landlord = the one chosen in the LandlordSwitcher, else the first
  // managed landlord that delegated contract access.
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageAgreements)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageAgreements', effectiveRp);

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAsset, setFilterAsset] = useState('all');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (effectiveRp == null || !allowed) { setContracts([]); setLoading(false); return; }
    setLoading(true);
    Promise.all([
      apiGet<Contract[]>(`/manager/contracts?rp=${effectiveRp}`).catch(() => null),
      apiGet<{ id: number }[]>(`/manager/contracts/operations?rp=${effectiveRp}`).catch(() => null),
    ])
      .then(([data, ops]) => {
        if (!Array.isArray(data)) return;
        // Active tenants only — drop fully-ended customers (all their leases have
        // ended); they live under Ended Leases. Active customers keep their full
        // history, including expired/terminated rows.
        const live = liveTenantIdSet(data);
        // Operations vs Leases split: the Leases register is the COMPLEMENT of the
        // Operations worklist. Hide any contract still in Operations (drafts +
        // active-but-incomplete) — they show here only once their pipeline is
        // complete and they leave Operations. Ended history stays.
        const opsIds = new Set((Array.isArray(ops) ? ops : []).map(c => c.id));
        setContracts(data.filter(c =>
          (c.tenant?.id == null || live.has(c.tenant.id)) &&
          !opsIds.has(c.id) &&
          (c.lockedAt != null || c.status === 'expired' || c.status === 'terminated')
        ));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [effectiveRp, allowed]);

  useEffect(() => { setPage(1); }, [activeTab, search, filterAsset]);

  // Per-landlord permission gate — mirrors the lock the nav enforces.
  if (!permsLoading && !allowed) {
    return (
      <div className="orders-page" style={{ padding: '48px 24px' }}>
        <div className="mgr-lock">
          <div className="ic"><Lock size={20} /></div>
          <p className="t">Permission required</p>
          <p className="s">This landlord hasn’t granted you the <strong>Manage Agreements</strong> permission, so their contracts aren’t available.</p>
        </div>
        <style jsx>{`
          .mgr-lock { max-width: 460px; margin: 0 auto; text-align: center; background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 40px 28px; }
          .mgr-lock .ic { width: 48px; height: 48px; border-radius: 12px; display: grid; place-items: center; margin: 0 auto 14px; background: var(--orange-bg); color: var(--orange-fg); }
          .mgr-lock .t { font-size: 16px; font-weight: 700; color: var(--ink); }
          .mgr-lock .s { font-size: 13.5px; color: var(--mute); margin-top: 6px; line-height: 1.5; }
        `}</style>
      </div>
    );
  }

  const now = useMemo(() => new Date(), []);
  const in60 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 60); return d; }, []);

  const assets = useMemo(
    () => [...new Set(contracts.map(c => c.property.buildingName).filter((s): s is string => Boolean(s)))],
    [contracts],
  );

  const tabCounts = useMemo(() => {
    const counts: Partial<Record<TabKey, number>> = {};
    counts.all = contracts.length;
    for (const s of Object.keys(STATUS_LABELS) as DisplayStatus[]) {
      counts[s] = contracts.filter(c => displayStatusOf(c) === s).length;
    }
    counts.upcoming_renewal = contracts.filter(c => isExpiringSoon(c, now, in60)).length;
    return counts;
  }, [contracts, now, in60]);

  const filtered = useMemo(() => {
    return contracts.filter(c => {
      if (activeTab === 'upcoming_renewal') {
        if (!isExpiringSoon(c, now, in60)) return false;
      } else if (activeTab !== 'all') {
        if (displayStatusOf(c) !== activeTab) return false;
      }
      if (filterAsset !== 'all' && c.property.buildingName !== filterAsset) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = [
          c.ref,
          c.tenant.name,
          c.tenant.email,
          c.unit.number,
          c.property.buildingName,
        ].filter((s): s is string => Boolean(s)).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [contracts, activeTab, filterAsset, search, now, in60]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const activeRent = useMemo(
    () => contracts.filter(c => displayStatusOf(c) === 'active').reduce((s, c) => s + c.annualRent, 0),
    [contracts],
  );

  const hasFilters = filterAsset !== 'all' || search !== '';

  const kpis: { lbl: string; val: string; aed?: boolean; accent?: boolean; ic: React.ReactNode }[] = [
    { lbl: 'Total',              val: String(contracts.length),       ic: <FileText size={12} /> },
    { lbl: 'Active',             val: String(tabCounts.active ?? 0),   ic: <Shield size={12} /> },
    { lbl: 'Needs activation',   val: String(tabCounts.needs_activation ?? 0), ic: <RotateCcw size={12} /> },
    { lbl: 'Expiring · 60d',     val: String(tabCounts.upcoming_renewal ?? 0), ic: <Clock size={12} /> },
    { lbl: 'Active rent / yr',   val: fmtAedAmt(activeRent), aed: true, accent: true, ic: <Coins size={12} /> },
  ];

  return (
    <div className="orders-page">
      <header className="topbar">
        <div className="crumbs">Workspace / Leasing / <b>Contracts</b></div>
        <div className="right">
          <button className="icon-btn" aria-label="Notifications"><Bell size={18} /><span className="dot" /></button>
          <button className="av-btn" aria-label="Profile">A</button>
        </div>
      </header>

      <main className="main">
        {/* Hero */}
        <div className="hero">
          <div className="left">
            <div className="eyebrow"><FileText size={12} /> Leasing · Managed</div>
            <h1>Tenancy <span className="accent">contracts</span></h1>
            <p>Every agreement across the landlord’s portfolio and where it sits in its lifecycle — from draft to Ejari, renewal and termination.</p>
          </div>
          <div className="right">
            {effectiveRp != null && canForRp('canCreateContracts', effectiveRp) && (
              <Link href={`/dashboard/manager/contracts/new?rp=${effectiveRp}`} className="btn" style={{ background: '#2e9f82', color: '#fff', borderColor: '#2e9f82' }}>
                <Plus size={14} /> New contract
              </Link>
            )}
            <button type="button" className="btn btn-ghost"><Download size={14} /> Export</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="kpis">
          {kpis.map((k, i) => (
            <div key={i} className={'kpi ' + (k.accent ? 'accent' : '')}>
              <div className="lbl"><span className="ic">{k.ic}</span>{k.lbl}</div>
              <div className={'val ' + (k.aed ? 'aed' : '')}>
                {k.aed && <span className="cur">AED</span>}{k.val}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="rangetabs">
          <div className="tabs">
            {TABS.filter(t => t.key === 'all' || (tabCounts[t.key] ?? 0) > 0).map(t => (
              <button
                key={t.key}
                type="button"
                className={activeTab === t.key ? 'active' : ''}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}<span className="count">{tabCounts[t.key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="filters">
          <div className="search">
            <span className="ic"><Search size={15} /></span>
            <input
              placeholder="Search ref, customer, unit or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="clear" onClick={() => setSearch('')}><X size={14} /></button>
            )}
          </div>
          <div className="sel-wrap">
            <select className="sel" value={filterAsset} onChange={e => setFilterAsset(e.target.value)}>
              <option value="all">All properties</option>
              {assets.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button type="button" className="reset" onClick={() => { setFilterAsset('all'); setSearch(''); }}>
              <X size={12} /> Reset
            </button>
          )}
          <span className="results">{filtered.length} of {contracts.length}</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="table-card">
            <div className="empty">
              <p>Loading contracts…</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="table-card">
            <div className="empty">
              <div className="ic"><FileText size={20} /></div>
              <h3>No contracts match</h3>
              <p>Try clearing your search or selecting a different status above.</p>
            </div>
          </div>
        ) : (
          <div className="table-card">
            <div className="table-head">
              <div>Contract</div>
              <div className="col-prop">Property</div>
              <div className="col-term">Term</div>
              <div className="col-rent ar">Annual rent</div>
              <div className="col-status">Status</div>
              <div />
            </div>
            <div className="rows">
              {rows.map(c => (
                <Row key={c.id} contract={c} now={now} in60={in60} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="pager">
                <span className="info">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="nums">
                  <button
                    type="button"
                    className="pg"
                    disabled={safePage === 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  {pageWindow(safePage, totalPages).map((p, i) =>
                    p === '…' ? (
                      <span key={`gap${i}`} className="pg-gap" aria-hidden="true">…</span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        className={'pg ' + (p === safePage ? 'active' : '')}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    className="pg"
                    disabled={safePage === totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <GlobalStyle />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Scoped design tokens + component styles
// ────────────────────────────────────────────────────────────────────────────

function GlobalStyle() {
  return (
    <style jsx global>{`
      .orders-page {
        --green: #2e9f82;
        --green-d: #1a7a5a;
        --green-t: #d8f2e8;
        --green-t2: #ebf8f2;

        --ink: #1a1916; --ink-2: #3d3b35; --ink-3: #6b6860;
        --mute: #9b9890; --mute-2: #b0ae9a;

        --line: #e8e6e0; --line-2: #f0eeea;
        --paper: #f4f3ef; --paper-2: #ebe9e3;
        --card: #ffffff;

        --warn-bg: #fef3c7; --warn-fg: #92400e; --warn-edge: #f4dd9b;
        --info-bg: #dbeafe; --info-fg: #1e40af;
        --purple-bg: #ede9fe; --purple-fg: #6d28d9;
        --orange-bg: #ffedd5; --orange-fg: #9a3412;
        --sky-bg: #e0f2fe; --sky-fg: #0369a1;
        --danger-bg: #fee2e2; --danger-fg: #991b1b;

        --r-card: 18px; --r-row: 14px; --r-input: 10px;
        --sh-sm: 0 1px 2px rgba(26,25,22,.04);

        background: var(--paper);
        color: var(--ink);
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        min-width: 0;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.5;
        font-weight: 450;
      }
      .orders-page * { box-sizing: border-box; }
      .orders-page button, .orders-page input, .orders-page select {
        font-family: inherit; color: inherit;
      }

      .orders-page .topbar {
        background: #fff; border-bottom: 1px solid var(--line);
        position: sticky; top: 0; z-index: 20;
        padding: 14px 36px;
        display: flex; justify-content: space-between; align-items: center; gap: 14px;
      }
      @media (max-width: 720px) { .orders-page .topbar { padding: 14px 16px; } }
      .orders-page .topbar .crumbs { font-size: 13px; color: var(--mute); font-weight: 500; }
      .orders-page .topbar .crumbs b { color: var(--ink); font-weight: 700; }
      .orders-page .topbar .right { display: flex; align-items: center; gap: 12px; }
      .orders-page .icon-btn {
        appearance: none; background: transparent; border: 0;
        width: 34px; height: 34px; border-radius: 8px;
        color: var(--ink-2); cursor: pointer;
        display: grid; place-items: center; transition: background .15s; position: relative;
      }
      .orders-page .icon-btn:hover { background: var(--paper); }
      .orders-page .icon-btn .dot {
        position: absolute; top: 7px; right: 8px;
        width: 7px; height: 7px; border-radius: 99px;
        background: var(--green); border: 1.5px solid #fff;
      }
      .orders-page .av-btn {
        width: 34px; height: 34px; border-radius: 99px;
        background: linear-gradient(135deg, var(--green), #34c79f);
        color: #fff; display: grid; place-items: center;
        font-weight: 700; font-size: 13px; border: 0; cursor: pointer;
      }

      .orders-page .main {
        padding: 32px 36px 64px; max-width: 1320px;
        margin: 0 auto; width: 100%;
      }
      @media (max-width: 720px) { .orders-page .main { padding: 24px 16px 60px; } }

      .orders-page .hero {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 18px; margin-bottom: 22px; flex-wrap: wrap;
      }
      .orders-page .hero .left { flex: 1; min-width: 280px; }
      .orders-page .hero .eyebrow {
        font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
        color: var(--green-d); font-weight: 700; margin-bottom: 8px;
        display: flex; align-items: center; gap: 8px;
      }
      .orders-page .hero h1 {
        margin: 0; font-size: 34px; font-weight: 700; letter-spacing: -.022em;
        line-height: 1.1; color: var(--ink);
      }
      .orders-page .hero h1 .accent { color: var(--green-d); }
      .orders-page .hero p {
        margin: 10px 0 0; font-size: 15px; color: var(--ink-3);
        max-width: 56ch; line-height: 1.55;
      }
      .orders-page .hero .right {
        display: flex; align-items: center; gap: 10px;
        flex-wrap: wrap; flex-shrink: 0;
      }

      .orders-page .kpis {
        display: grid; grid-template-columns: repeat(5, 1fr);
        gap: 12px; margin-bottom: 8px;
      }
      @media (max-width: 1100px) { .orders-page .kpis { grid-template-columns: repeat(3, 1fr); } }
      @media (max-width: 640px) { .orders-page .kpis { grid-template-columns: repeat(2, 1fr); } }
      .orders-page .kpi {
        background: #fff; border: 1px solid var(--line);
        border-radius: 14px; padding: 16px 18px; box-shadow: var(--sh-sm);
        display: flex; flex-direction: column; gap: 7px; min-width: 0;
      }
      .orders-page .kpi .lbl {
        font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
        color: var(--mute); font-weight: 700;
        display: flex; align-items: center; gap: 6px; line-height: 1.2;
      }
      .orders-page .kpi .lbl .ic { color: var(--green-d); opacity: .85; flex-shrink: 0; }
      .orders-page .kpi .val {
        font-size: 25px; font-weight: 700; letter-spacing: -.025em;
        color: var(--ink); line-height: 1; font-variant-numeric: tabular-nums;
      }
      .orders-page .kpi .val.aed { font-size: 18px; letter-spacing: -.01em; }
      .orders-page .kpi .val .cur {
        font-size: 12px; color: var(--mute); font-weight: 700;
        margin-right: 3px; letter-spacing: .02em;
      }
      .orders-page .kpi.accent {
        background: linear-gradient(160deg, var(--ink) 0%, #23332d 100%);
        border-color: transparent;
      }
      .orders-page .kpi.accent .lbl { color: rgba(255,255,255,.6); }
      .orders-page .kpi.accent .lbl .ic { color: #7be1c2; }
      .orders-page .kpi.accent .val { color: #fff; }
      .orders-page .kpi.accent .val .cur { color: rgba(255,255,255,.55); }

      .orders-page .rangetabs {
        display: flex; align-items: center; justify-content: space-between;
        gap: 18px; margin: 22px 0 16px;
        border-bottom: 1px solid var(--line); flex-wrap: wrap;
      }
      .orders-page .rangetabs .tabs {
        display: flex; align-items: stretch; gap: 0;
        overflow-x: auto; flex: 1; min-width: 0;
      }
      .orders-page .rangetabs .tabs::-webkit-scrollbar { display: none; }
      .orders-page .rangetabs button {
        appearance: none; background: transparent; border: 0; cursor: pointer;
        padding: 14px 15px 13px;
        font-size: 13.5px; font-weight: 600; color: var(--mute);
        border-bottom: 2px solid transparent; margin-bottom: -1px;
        display: inline-flex; align-items: center; gap: 8px;
        line-height: 1; white-space: nowrap;
        transition: color .15s, border-color .15s; font-family: inherit;
      }
      .orders-page .rangetabs button:hover { color: var(--ink-2); }
      .orders-page .rangetabs button.active {
        color: var(--green-d); border-bottom-color: var(--green);
      }
      .orders-page .rangetabs button .count {
        font-size: 10.5px; font-weight: 700;
        padding: 2px 7px; border-radius: 99px;
        background: var(--paper-2); color: var(--mute);
      }
      .orders-page .rangetabs button.active .count {
        background: var(--green-t); color: var(--green-d);
      }

      .orders-page .filters {
        display: flex; flex-wrap: wrap; align-items: center;
        gap: 8px; margin-bottom: 16px;
      }
      .orders-page .search { position: relative; flex: 1; max-width: 380px; min-width: 200px; }
      .orders-page .search input {
        width: 100%; padding: 10px 12px 10px 36px;
        font-size: 13.5px; border: 1px solid var(--line);
        border-radius: 10px; background: #fff; outline: none;
        transition: all .15s; font-family: inherit; color: var(--ink);
      }
      .orders-page .search input:focus {
        border-color: var(--green);
        box-shadow: 0 0 0 3px rgba(46,159,130,.08);
      }
      .orders-page .search input::placeholder { color: var(--mute-2); }
      .orders-page .search .ic {
        position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
        color: var(--mute); pointer-events: none;
      }
      .orders-page .search .clear {
        position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
        background: transparent; border: 0; color: var(--mute); cursor: pointer;
        width: 24px; height: 24px; border-radius: 6px;
        display: grid; place-items: center;
      }
      .orders-page .search .clear:hover { background: var(--paper); }
      .orders-page .sel {
        appearance: none; padding: 10px 32px 10px 14px;
        font-size: 13.5px; border: 1px solid var(--line);
        border-radius: 10px; background: #fff; color: var(--ink-2);
        cursor: pointer; font-family: inherit; outline: none;
        transition: all .15s; font-weight: 500;
      }
      .orders-page .sel:hover { border-color: var(--ink-3); }
      .orders-page .sel-wrap { position: relative; }
      .orders-page .sel-wrap::after {
        content: ''; position: absolute; right: 14px; top: 50%;
        width: 6px; height: 6px;
        border-right: 1.5px solid var(--mute);
        border-bottom: 1.5px solid var(--mute);
        transform: translateY(-65%) rotate(45deg); pointer-events: none;
      }
      .orders-page .filters .reset {
        background: transparent; border: 0; color: var(--green-d);
        font-weight: 600; font-size: 12.5px; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px;
        padding: 6px 8px; border-radius: 7px;
      }
      .orders-page .filters .reset:hover { background: var(--green-t2); }
      .orders-page .filters .results {
        margin-left: auto; font-size: 12.5px; color: var(--mute); font-weight: 500;
      }

      .orders-page .btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 7px; padding: 11px 16px; border-radius: 10px;
        font-weight: 600; font-size: 13.5px;
        border: 1px solid transparent; cursor: pointer;
        transition: all .15s; line-height: 1; white-space: nowrap;
        font-family: inherit; text-decoration: none;
      }
      .orders-page .btn-primary {
        background: var(--green); color: #fff; border-color: var(--green);
      }
      .orders-page .btn-primary:hover {
        background: var(--green-d); border-color: var(--green-d);
      }
      .orders-page .btn-ghost {
        background: #fff; color: var(--ink-2); border-color: var(--line);
      }
      .orders-page .btn-ghost:hover { border-color: var(--ink-3); color: var(--ink); }

      .orders-page .table-card {
        background: #fff; border: 1px solid var(--line);
        border-radius: 16px; overflow: hidden; box-shadow: var(--sh-sm);
      }
      .orders-page .table-head, .orders-page .row {
        display: grid;
        grid-template-columns: minmax(230px, 2fr) minmax(170px, 1.4fr) 168px minmax(120px, 1fr) 132px 34px;
        gap: 14px; align-items: center;
      }
      .orders-page .table-head {
        padding: 14px 22px; background: var(--paper);
        border-bottom: 1px solid var(--line);
        font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
        color: var(--mute); font-weight: 700;
      }
      .orders-page .table-head .ar { text-align: right; }
      @media (max-width: 1040px) {
        .orders-page .table-head, .orders-page .row { grid-template-columns: 1fr auto 34px; gap: 10px; }
        .orders-page .table-head .col-prop, .orders-page .table-head .col-term, .orders-page .table-head .col-rent,
        .orders-page .row .col-prop, .orders-page .row .col-term, .orders-page .row .col-rent { display: none; }
      }

      .orders-page .rows { display: flex; flex-direction: column; }
      .orders-page .row {
        padding: 15px 22px; border-bottom: 1px solid var(--line-2);
        transition: background .15s; cursor: pointer; min-height: 72px;
        text-decoration: none; color: inherit;
      }
      .orders-page .row:last-child { border-bottom: 0; }
      .orders-page .row:hover { background: var(--paper); }
      .orders-page .row.expanded { background: var(--green-t2); }

      .orders-page .col-ref { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .orders-page .av {
        width: 38px; height: 38px; border-radius: 11px;
        background: var(--green-t); color: var(--green-d);
        display: grid; place-items: center;
        font-weight: 700; font-size: 13px; letter-spacing: -.005em;
        flex-shrink: 0; border: 1px solid #cfe7dc;
      }
      .orders-page .col-ref .info {
        min-width: 0; flex: 1;
        display: flex; flex-direction: column; justify-content: center; gap: 3px;
      }
      .orders-page .col-ref .ref {
        font-family: 'DM Mono', ui-monospace, monospace;
        font-size: 13px; font-weight: 500; color: var(--ink);
        letter-spacing: -.01em; line-height: 1.2;
        display: flex; align-items: center; gap: 7px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .orders-page .col-ref .tenant {
        font-size: 12px; color: var(--mute); line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .orders-page .type-chip {
        display: inline-flex; align-items: center; flex-shrink: 0;
        font-size: 9px; letter-spacing: .06em; text-transform: uppercase;
        color: var(--ink-3); font-weight: 700;
        padding: 2px 6px; border-radius: 99px; background: var(--paper-2);
      }
      .orders-page .type-chip.renewal { background: var(--sky-bg); color: var(--sky-fg); }

      .orders-page .col-prop {
        min-width: 0; display: flex; flex-direction: column;
        justify-content: center; gap: 3px;
      }
      .orders-page .col-prop .unit {
        font-size: 13.5px; font-weight: 600; color: var(--ink-2);
        letter-spacing: -.005em; line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .orders-page .col-prop .bldg {
        font-size: 12px; color: var(--mute); line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .orders-page .col-term {
        min-width: 0; display: flex; flex-direction: column;
        justify-content: center; gap: 3px; font-variant-numeric: tabular-nums;
      }
      .orders-page .col-term .span {
        font-size: 12.5px; font-weight: 600; color: var(--ink-2);
        line-height: 1.2; white-space: nowrap;
      }
      .orders-page .col-term .end-note {
        font-size: 11px; color: var(--mute); line-height: 1.2;
        display: flex; align-items: center; gap: 5px;
      }
      .orders-page .col-term .end-note.soon { color: var(--warn-fg); font-weight: 600; }
      .orders-page .soon-pill {
        display: inline-flex; align-items: center;
        font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
        padding: 1px 6px; border-radius: 99px;
        background: var(--warn-bg); color: var(--warn-fg); border: 1px solid var(--warn-edge);
      }

      .orders-page .col-rent {
        min-width: 0; text-align: right; font-variant-numeric: tabular-nums;
      }
      .orders-page .col-rent .amt {
        font-size: 14px; font-weight: 700; color: var(--ink);
        letter-spacing: -.01em; line-height: 1.2; white-space: nowrap;
      }
      .orders-page .col-rent .per { font-size: 11px; color: var(--mute); line-height: 1.2; margin-top: 2px; }

      .orders-page .col-status { display: flex; align-items: center; }
      .orders-page .status {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600;
        padding: 4px 10px; border-radius: 99px;
        letter-spacing: .01em; white-space: nowrap; border: 1px solid transparent;
      }
      .orders-page .status .sd {
        width: 6px; height: 6px; border-radius: 99px;
        background: currentColor; flex-shrink: 0; opacity: .85;
      }
      .orders-page .status.active      { background: var(--green-t); color: var(--green-d); border-color: #cfe7dc; }
      .orders-page .status.terminating { background: var(--orange-bg); color: var(--orange-fg); border-color: #fbd0aa; }
      .orders-page .status.pending     { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-edge); }
      .orders-page .status.issued      { background: var(--info-bg); color: var(--info-fg); border-color: #c7d8f5; }
      .orders-page .status.expired     { background: var(--paper-2); color: var(--ink-3); border-color: var(--line); }
      .orders-page .status.needs_activation { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-edge); }
      .orders-page .status.starts_later     { background: var(--sky-bg); color: var(--sky-fg); border-color: #bae0fa; }
      .orders-page .status.declined    { background: var(--danger-bg); color: var(--danger-fg); border-color: #f1c5c2; }
      .orders-page .status.superseded  { background: var(--purple-bg); color: var(--purple-fg); border-color: #d6cef9; }
      .orders-page .status.terminated  { background: #ececec; color: #57534e; border-color: #ddd9d2; }

      .orders-page .col-chev {
        display: flex; align-items: center; justify-content: center; color: var(--mute);
      }
      .orders-page .col-chev .cv { transition: transform .2s; display: grid; place-items: center; }
      .orders-page .row.expanded .col-chev .cv { transform: rotate(90deg); color: var(--green-d); }

      .orders-page .row-body {
        grid-column: 1 / -1;
        border-top: 1px solid var(--line-2);
        margin-top: 15px; padding-top: 18px;
        display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px;
      }
      @media (max-width: 980px) { .orders-page .row-body { grid-template-columns: 1fr; } }
      .orders-page .blk {
        background: #fff; border: 1px solid var(--line);
        border-radius: 12px; padding: 15px 16px;
      }
      .orders-page .blk .h {
        font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
        color: var(--mute); font-weight: 700; margin-bottom: 12px;
        display: flex; align-items: center; gap: 6px;
      }
      .orders-page .blk .h .icw { color: var(--green-d); }
      .orders-page .det-grid {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 12px 18px;
      }
      .orders-page .det {
        display: flex; flex-direction: column; gap: 3px; min-width: 0;
      }
      .orders-page .det .k { font-size: 11px; color: var(--mute); font-weight: 500; }
      .orders-page .det .v {
        font-size: 13px; color: var(--ink); font-weight: 600; letter-spacing: -.005em;
      }
      .orders-page .det .v.mono {
        font-family: 'DM Mono', ui-monospace, monospace;
        font-size: 12.5px; font-weight: 500;
      }
      .orders-page .ejari {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11px; font-weight: 600;
        padding: 2px 8px; border-radius: 99px; width: max-content;
      }
      .orders-page .ejari.registered { background: var(--green-t); color: var(--green-d); }
      .orders-page .ejari.pending    { background: var(--warn-bg); color: var(--warn-fg); }
      .orders-page .ejari.none       { background: var(--paper-2); color: var(--ink-3); }

      .orders-page .body-actions {
        display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px;
      }
      .orders-page .ba {
        appearance: none; display: inline-flex; align-items: center; gap: 6px;
        font-size: 12.5px; font-weight: 600;
        padding: 8px 13px; border-radius: 9px; cursor: pointer;
        border: 1px solid var(--green); background: var(--green); color: #fff;
        transition: all .15s; font-family: inherit; text-decoration: none;
      }
      .orders-page .ba:hover { background: var(--green-d); border-color: var(--green-d); }
      .orders-page .ba.ghost { background: #fff; color: var(--ink-2); border-color: var(--line); }
      .orders-page .ba.ghost:hover { border-color: var(--ink-3); color: var(--ink); }
      .orders-page .ba.danger { background: #fff; color: var(--danger-fg); border-color: #f1c5c2; }
      .orders-page .ba.danger:hover { background: var(--danger-bg); }

      .orders-page .timeline {
        display: flex; flex-direction: column; gap: 0;
        position: relative; padding-left: 16px; margin-top: 2px;
      }
      .orders-page .timeline::before {
        content: ''; position: absolute;
        left: 4px; top: 8px; bottom: 8px;
        width: 1.5px; background: var(--line);
      }
      .orders-page .tl-item { position: relative; padding: 6px 0 6px 18px; }
      .orders-page .tl-item::before {
        content: ''; position: absolute; left: -15px; top: 11px;
        width: 9px; height: 9px; border-radius: 99px;
        background: #fff; border: 1.5px solid var(--line);
      }
      .orders-page .tl-item.past::before { background: var(--green); border-color: var(--green); }
      .orders-page .tl-item.current::before {
        background: #fff; border-color: var(--green);
        box-shadow: 0 0 0 3px var(--green-t2);
      }
      .orders-page .tl-item.alert::before { background: #e8a44a; border-color: #e0973a; }
      .orders-page .tl-item .nm { font-size: 12px; font-weight: 600; color: var(--ink); line-height: 1.3; }
      .orders-page .tl-item:not(.past):not(.current):not(.alert) .nm { color: var(--mute); }
      .orders-page .tl-item .t { font-size: 11px; color: var(--mute); margin-top: 2px; }

      .orders-page .pager {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 22px; border-top: 1px solid var(--line);
        gap: 12px; flex-wrap: wrap;
      }
      .orders-page .pager .info { font-size: 12px; color: var(--mute); font-weight: 500; }
      .orders-page .pager .nums { display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; }
      .orders-page .pg-gap {
        min-width: 20px; height: 32px; display: grid; place-items: center;
        color: var(--mute); font-size: 12.5px; font-weight: 600; user-select: none;
      }
      .orders-page .pg {
        min-width: 32px; height: 32px; padding: 0 6px;
        display: grid; place-items: center;
        border-radius: 8px; border: 1px solid var(--line);
        background: #fff; color: var(--ink-2);
        font-size: 12.5px; font-weight: 600; cursor: pointer;
        transition: all .15s; font-family: inherit;
      }
      .orders-page .pg:hover:not(:disabled):not(.active) {
        background: var(--paper); border-color: var(--ink-3);
      }
      .orders-page .pg.active {
        background: var(--green); color: #fff; border-color: var(--green);
      }
      .orders-page .pg:disabled { opacity: .4; cursor: not-allowed; }

      .orders-page .empty {
        padding: 56px 24px; text-align: center; color: var(--mute);
      }
      .orders-page .empty .ic {
        width: 48px; height: 48px; border-radius: 14px;
        background: var(--green-t); color: var(--green-d);
        display: grid; place-items: center; margin: 0 auto 12px;
      }
      .orders-page .empty h3 {
        margin: 0 0 6px; font-size: 18px; font-weight: 700;
        color: var(--ink); letter-spacing: -.01em;
      }
      .orders-page .empty p {
        margin: 0; font-size: 13.5px; color: var(--ink-3);
        line-height: 1.5; max-width: 42ch;
        margin-left: auto; margin-right: auto;
      }
    `}</style>
  );
}
