/**
 * OperationsBoard — the contract-setup worklist shared by the RP and Manager
 * "Operations" pages.
 *
 * Operations holds every NON-ended contract that hasn't been blessed yet
 * (locked_at IS NULL): drafts, in-progress setups, and imported active leases
 * that still need a review pass. Each card shows a per-step completeness
 * checklist (mirroring the v2 stepper's isDone signals). An admin:
 *   - flips the trivial steps inline (Confirm PDC / Mark utility / Mark Ejari),
 *   - deep-links into the v2 contract page for the heavy steps (signatures,
 *     KYC, payment plan, move-in),
 *   - and clicks "Mark active" to bless it. That stamps locked_at on the
 *     backend → the lease leaves Operations and shows in the Leases register.
 *
 * "Mark active" is a SOFT gate: if items are still missing it confirms first
 * ("3 items missing — activate anyway?") rather than blocking, because imported
 * leases legitimately lack move-in/utility records.
 *
 * The board is portal-agnostic: the list endpoint differs (RP vs manager-scoped
 * ?rp=), but the row ACTIONS reuse the same /contracts/:id/* endpoints for both
 * (the backend authorises managers via resolveContractActor).
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, X, Check, FileText, Coins, ClipboardList,
  CheckCircle2, PenLine, RefreshCw, ArrowRight, Calendar, LogOut,
} from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { tenantDisplayName } from '@/lib/tenantName';
import OperationsViewToggle from '@/components/upnow/OperationsViewToggle';

interface ChecklistItem { key: string; label: string; done: boolean; action: string | null }
export interface OpsContract {
  id: number;
  ref: string;
  contractType: string | null;
  startDate: string;
  endDate: string;
  annualRent: number;
  status: string;
  /** Active lease whose termination was accepted — back on Operations for
   *  move-out + settlement (NOT a setup card; no "Mark active"). */
  windDown?: boolean;
  /** Active lease with a termination request pending acceptance (Terminated pipeline, "Requested"). */
  terminationRequested?: boolean;
  lockedAt: string | null;
  contractSent: boolean;
  createdAt: string;
  updatedAt?: string;
  tenant: { id: number | null; name: string | null; entityType: string | null; companyName: string | null; email: string | null };
  unit: { id: number | null; number: string | null; name: string | null };
  property: { id: number | null; buildingName: string | null };
  checklist: ChecklistItem[];
  doneCount: number;
  totalCount: number;
}

interface Props {
  /** API path (without the /api prefix), e.g. '/contracts/operations'. */
  listPath: string;
  /** Deep-link to the v2 contract page for a given contract id. */
  contractHref: (id: number) => string;
  /** When false, the "Mark active" + inline quick-fills are hidden (read-only). */
  canAct?: boolean;
}

// Contract-type tabs — split the worklist into New leases vs Renewals so each
// flow can be worked separately. 'all' keeps the combined view.
type TypeKey = 'all' | 'new' | 'renewal';
const TYPE_TABS: { key: TypeKey; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'new',     label: 'New' },
  { key: 'renewal', label: 'Renewal' },
];

// Inline one-click flips. The other steps deep-link into the contract page.
const QUICK: Record<string, { path: string; label: string }> = {
  pdc: { path: 'confirm-pdc', label: 'Confirm PDC' },
  utility: { path: 'utility/mark-on-file', label: 'Mark utility on file' },
  ejari: { path: 'ejari/mark-registered', label: 'Mark Contract Registration on file' },
};

function fmtShort(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: '2-digit' });
}
function fmtAed(n: number): string { return n.toLocaleString('en-AE'); }
function initials(name: string | null): string {
  if (!name) return '—';
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export default function OperationsBoard({ listPath, contractHref, canAct = true }: Props) {
  const [rows, setRows] = useState<OpsContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAsset, setFilterAsset] = useState('all');
  // Worklist filters — same year control as the Leases page, plus stage + a
  // "missing item" slice so the admin can work one gap at a time (e.g. all
  // contracts missing Ejari). Year defaults to the CURRENT year (like Leases).
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [filterStage, setFilterStage] = useState('all');
  const [filterMissing, setFilterMissing] = useState('all');
  const [filterType, setFilterType] = useState<TypeKey>('all');
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);

  const load = useMemo(() => () => {
    return apiGet<OpsContract[]>(listPath)
      .then(data => { if (Array.isArray(data)) setRows(data); })
      .catch(() => undefined);
  }, [listPath]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const assets = useMemo(
    () => [...new Set(rows.map(c => c.property.buildingName).filter((s): s is string => Boolean(s)))],
    [rows],
  );

  // Year options — every year a contract's term touches, newest first (parsed
  // from the ISO prefix to avoid timezone drift). The current year is always an
  // option so the default selection is never empty. Mirrors the Leases page.
  const years = useMemo(() => {
    const set = new Set<string>();
    const yearOf = (d: string | null) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null);
    for (const c of rows) {
      const sy = yearOf(c.startDate); if (sy) set.add(sy);
      const ey = yearOf(c.endDate);   if (ey) set.add(ey);
    }
    set.add(String(new Date().getFullYear()));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [rows]);

  // Distinct checklist items present, for the "missing" slice.
  const missingOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of rows) for (const i of c.checklist) m.set(i.key, i.label);
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [rows]);

  // Year scopes the WHOLE page (KPIs + list), exactly like the Leases page — a
  // contract counts for a year when its term OVERLAPS it (plus a forward-dated
  // contract created that year). This keeps the KPI counts and the list in sync.
  const yearScoped = useMemo(() => {
    if (filterYear === 'all') return rows;
    const jan1 = `${filterYear}-01-01`, dec31 = `${filterYear}-12-31`;
    return rows.filter(c => {
      const s = (c.startDate ?? '').slice(0, 10), e = (c.endDate ?? '').slice(0, 10);
      const createdYr = (c.createdAt ?? '').slice(0, 4);
      if (s && s > dec31 && createdYr === filterYear) return true;
      if (!s || s > dec31) return false;
      if (e && e < jan1) return false;
      return true;
    });
  }, [rows, filterYear]);

  // Everything EXCEPT the New/Renewal tab — this base drives the tab counts so
  // each tab shows how many it holds within the current year/asset/stage/search.
  const typeBase = useMemo(() => {
    return yearScoped.filter(c => {
      if (filterAsset !== 'all' && c.property.buildingName !== filterAsset) return false;
      // Stage: draft = pending, issued, live = active, winddown = terminating.
      if (filterStage !== 'all') {
        const stage = c.windDown ? 'winddown' : c.status === 'active' ? 'live' : c.status === 'issued' ? 'issued' : 'draft';
        if (stage !== filterStage) return false;
      }
      // Missing-item slice: keep only contracts where that item is still undone.
      if (filterMissing !== 'all' && !c.checklist.some(i => i.key === filterMissing && !i.done)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [c.ref, c.tenant.name, c.tenant.companyName, c.tenant.email, c.unit.number, c.property.buildingName]
          .filter((s): s is string => Boolean(s)).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [yearScoped, search, filterAsset, filterStage, filterMissing]);

  const typeCounts = useMemo<Record<TypeKey, number>>(() => ({
    all:     typeBase.length,
    new:     typeBase.filter(c => c.contractType !== 'renewal').length,
    renewal: typeBase.filter(c => c.contractType === 'renewal').length,
  }), [typeBase]);

  const filtered = useMemo(() => {
    const list = typeBase.filter(c => {
      if (filterType === 'new' && c.contractType === 'renewal') return false;
      if (filterType === 'renewal' && c.contractType !== 'renewal') return false;
      return true;
    });
    // Most-incomplete first — that's the work queue order. Ties: newest first.
    return [...list].sort((a, b) => {
      const ra = a.doneCount / a.totalCount, rb = b.doneCount / b.totalCount;
      if (ra !== rb) return ra - rb;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
  }, [typeBase, filterType]);

  const hasFilters = filterAsset !== 'all' || filterYear !== 'all' || filterStage !== 'all' || filterMissing !== 'all' || filterType !== 'all' || search !== '';

  // KPIs reflect the year scope (not the stage/missing/search slices) — same
  // semantics as the Leases page, so the counts always match the year selected.
  const stats = useMemo(() => ({
    total: yearScoped.length,
    live: yearScoped.filter(c => c.status === 'active' && !c.windDown).length,
    winding: yearScoped.filter(c => c.windDown).length,
    ready: yearScoped.filter(c => c.status !== 'active' && c.doneCount >= c.totalCount).length,
    drafts: yearScoped.filter(c => c.status === 'pending' && !c.contractSent).length,
  }), [yearScoped]);

  async function runQuick(c: OpsContract, action: string) {
    const q = QUICK[action];
    if (!q || busy) return;
    setBusy(c.id);
    setNote(null);
    try {
      const res = await apiPatch<{ matched?: boolean }>(`/contracts/${c.id}/${q.path}`, {});
      // Ejari "mark on file" only links an EXISTING certificate; if none is on
      // file it returns matched:false and nothing changed — guide the admin in.
      if (action === 'ejari' && res && res.matched === false) {
        setNote({ id: c.id, text: 'No Contract Registration Certificate on file — open the contract to upload/register it.' });
      }
      await load();
    } catch (e) {
      setNote({ id: c.id, text: (e as Error)?.message || 'Action failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function markActive(c: OpsContract) {
    if (busy) return;
    const missing = c.totalCount - c.doneCount;
    if (missing > 0) {
      const ok = window.confirm(
        `${missing} item${missing === 1 ? '' : 's'} still missing for ${c.ref}.\n\nMark active anyway? It will move to Leases.`,
      );
      if (!ok) return;
    }
    setBusy(c.id);
    setNote(null);
    try {
      await apiPatch(`/contracts/${c.id}/activate`, {});
      // Refetch: a fully-complete lease drops off; one activated with gaps still
      // remaining stays as a live-but-incomplete row (dual membership).
      await load();
    } catch (e) {
      setNote({ id: c.id, text: (e as Error)?.message || 'Could not activate.' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ops-page">
      <main className="main">
        <div className="hero">
          <div className="left">
            <div className="eyebrow"><ClipboardList size={12} /> Operations</div>
            <h1>Setup <span className="accent">worklist</span></h1>
            <p>Contracts still being set up — fill the missing steps, then <b>Mark active</b> to lock the lease and move it to Leases. Terminated leases come back here to finish <b>move-out &amp; settlement</b>.</p>
          </div>
          <div className="hero-actions">
            <OperationsViewToggle active="list" />
            <div className="year-global" title="Scope the worklist by lease year">
              <Calendar size={14} />
              <select className="sel" value={filterYear} onChange={e => setFilterYear(e.target.value)} aria-label="Filter by year">
                <option value="all">All years</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <div className="kpis">
          <div className="kpi"><div className="lbl"><ClipboardList size={12} /> Needs setup</div><div className="val">{stats.total}</div></div>
          <div className="kpi"><div className="lbl"><PenLine size={12} /> Live · finishing</div><div className="val">{stats.live}</div></div>
          <div className="kpi"><div className="lbl"><LogOut size={12} /> Winding down</div><div className="val">{stats.winding}</div></div>
          <div className="kpi"><div className="lbl"><CheckCircle2 size={12} /> Ready to activate</div><div className="val">{stats.ready}</div></div>
          <div className="kpi"><div className="lbl"><FileText size={12} /> Drafts (not sent)</div><div className="val">{stats.drafts}</div></div>
        </div>

        {/* New vs Renewal — work each flow separately. */}
        <div className="optabs">
          {TYPE_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={filterType === t.key ? 'active' : ''}
              onClick={() => setFilterType(t.key)}
            >
              {t.label}<span className="count">{typeCounts[t.key]}</span>
            </button>
          ))}
        </div>

        <div className="filters">
          <div className="search">
            <span className="ic"><Search size={15} /></span>
            <input placeholder="Search ref, customer, unit or email…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button type="button" className="clear" onClick={() => setSearch('')}><X size={14} /></button>}
          </div>
          <div className="sel-wrap">
            <select className="sel" value={filterAsset} onChange={e => setFilterAsset(e.target.value)}>
              <option value="all">All properties</option>
              {assets.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="sel-wrap">
            <select className="sel" value={filterStage} onChange={e => setFilterStage(e.target.value)} aria-label="Filter by stage">
              <option value="all">All stages</option>
              <option value="draft">Drafts</option>
              <option value="issued">Issued</option>
              <option value="live">Live leases</option>
            <option value="winddown">Winding down</option>
            </select>
          </div>
          <div className="sel-wrap">
            <select className="sel" value={filterMissing} onChange={e => setFilterMissing(e.target.value)} aria-label="Filter by missing item">
              <option value="all">Any item missing</option>
              {missingOptions.map(o => <option key={o.key} value={o.key}>Missing: {o.label}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button type="button" className="reset" onClick={() => { setFilterAsset('all'); setFilterYear('all'); setFilterStage('all'); setFilterMissing('all'); setFilterType('all'); setSearch(''); }}>
              <X size={12} /> Reset
            </button>
          )}
          <span className="results">{filtered.length} of {yearScoped.length}</span>
        </div>

        {loading ? (
          <div className="card empty"><p>Loading worklist…</p></div>
        ) : filtered.length === 0 ? (
          <div className="card empty">
            <div className="ic"><CheckCircle2 size={20} /></div>
            <h3>{rows.length === 0 ? 'Nothing in operations' : 'No matches'}</h3>
            <p>{rows.length === 0
              ? 'Every contract is set up and locked. New or incomplete contracts will appear here for completion.'
              : 'Try clearing your search or property filter.'}</p>
          </div>
        ) : (
          <div className="list">
            {filtered.map(c => {
              const isRenewal = c.contractType === 'renewal';
              const isWindDown = !!c.windDown;
              const isLive = c.status === 'active' && !isWindDown;
              const stageLabel = isWindDown ? 'Winding down' : isLive ? 'Live' : c.status === 'issued' ? 'Issued' : 'Draft';
              const pct = Math.round((c.doneCount / c.totalCount) * 100);
              const ready = c.doneCount >= c.totalCount;
              const quickItems = c.checklist.filter(i => !i.done && i.action && QUICK[i.action]);
              const rowBusy = busy === c.id;
              const tenantLabel = tenantDisplayName(c.tenant);
              return (
                <div key={c.id} className={'opcard' + (rowBusy ? ' busy' : '')}>
                  <div className="top">
                    <div className="who">
                      <div className="av">{initials(tenantLabel)}</div>
                      <div className="info">
                        <div className="ref">{c.ref}
                          <span className={'type-chip ' + (isRenewal ? 'renewal' : '')}>{isRenewal ? 'Renewal' : 'New'}</span>
                          <span className={'stage-chip ' + (isWindDown ? 'winddown' : c.status)}>{stageLabel}</span>
                        </div>
                        <div className="tenant">{tenantLabel ?? '—'}</div>
                      </div>
                    </div>
                    <div className="meta">
                      <div className="m-prop">
                        <div className="unit">{c.unit.number ? `Unit ${c.unit.number}` : (c.unit.name ?? '—')}</div>
                        <div className="bldg">{c.property.buildingName ?? '—'}</div>
                      </div>
                      <div className="m-term">
                        <div className="span">{fmtShort(c.startDate)} – {fmtShort(c.endDate)}</div>
                        <div className="rent"><Coins size={11} /> AED {fmtAed(c.annualRent)}/yr</div>
                      </div>
                      <div className={'progress' + (ready ? ' ready' : '')}>
                        <div className="ring" style={{ ['--pct' as string]: `${pct}` }}>
                          <span>{c.doneCount}/{c.totalCount}</span>
                        </div>
                        <div className="plabel">{isWindDown ? 'Wind-down' : ready ? 'Ready' : 'In setup'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="chips">
                    {c.checklist.map(i => (
                      <span key={i.key} className={'chip ' + (i.done ? 'on' : 'off')}>
                        {i.done ? <Check size={12} /> : <X size={12} />}{i.label}
                      </span>
                    ))}
                  </div>

                  {note?.id === c.id && <div className="rownote">{note.text}</div>}

                  <div className="actions">
                    <div className="quick">
                      {canAct && quickItems.map(i => (
                        <button key={i.key} type="button" className="qa" disabled={rowBusy}
                          onClick={() => runQuick(c, i.action as string)}>
                          {QUICK[i.action as string].label}
                        </button>
                      ))}
                    </div>
                    <div className="right">
                      <Link href={contractHref(c.id)} className="open">Open contract <ArrowRight size={13} /></Link>
                      {canAct && (isWindDown ? (
                        <Link href={contractHref(c.id)} className="activate go" title="Finish the move-out inspection, signature and deposit settlement">
                          <LogOut size={14} /> Complete move-out
                        </Link>
                      ) : isLive ? (
                        <span className="live-note" title="Already a live lease — fill the remaining items to clear it from the worklist">Live · finish setup</span>
                      ) : (
                        <button type="button" className={'activate' + (ready ? ' go' : '')} disabled={rowBusy} onClick={() => markActive(c)}>
                          <CheckCircle2 size={14} /> Mark active
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Style />
    </div>
  );
}

function Style() {
  return (
    <style jsx global>{`
      .ops-page {
        --green:#2e9f82; --green-d:#1a7a5a; --green-t:#d8f2e8; --green-t2:#ebf8f2;
        --ink:#1a1916; --ink-2:#3d3b35; --ink-3:#6b6860; --mute:#9b9890; --mute-2:#b0ae9a;
        --line:#e8e6e0; --line-2:#f0eeea; --paper:#f4f3ef; --paper-2:#ebe9e3; --card:#fff;
        --warn-bg:#fef3c7; --warn-fg:#92400e; --sky-bg:#e0f2fe; --sky-fg:#0369a1;
        --danger-bg:#fee2e2; --danger-fg:#991b1b;
        --sh-sm:0 1px 2px rgba(26,25,22,.04);
        background:var(--paper); color:var(--ink); min-height:100vh;
        font-family:inherit; font-size:14px; line-height:1.5; font-weight:450;
      }
      .ops-page *{ box-sizing:border-box; }
      .ops-page button, .ops-page input, .ops-page select{ font-family:inherit; color:inherit; }
      .ops-page .main{ padding:32px 36px 64px; max-width:1320px; margin:0 auto; width:100%; }
      @media (max-width:720px){ .ops-page .main{ padding:24px 16px 60px; } }

      .ops-page .hero{ display:flex; justify-content:space-between; align-items:flex-start; gap:18px; margin-bottom:22px; flex-wrap:wrap; }
      .ops-page .hero .left{ flex:1; min-width:280px; }
      .ops-page .eyebrow{ font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--green-d); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
      .ops-page .hero h1{ margin:0; font-size:32px; font-weight:700; letter-spacing:-.022em; line-height:1.1; }
      .ops-page .hero h1 .accent{ color:var(--green-d); }
      .ops-page .hero p{ margin:10px 0 0; font-size:14.5px; color:var(--ink-3); max-width:60ch; }
      .ops-page .hero p b{ color:var(--ink-2); font-weight:700; }

      .ops-page .btn{ display:inline-flex; align-items:center; gap:7px; padding:10px 14px; border-radius:10px; font-weight:600; font-size:13.5px; border:1px solid transparent; cursor:pointer; white-space:nowrap; }
      .ops-page .btn-ghost{ background:#fff; color:var(--ink-2); border-color:var(--line); }
      .ops-page .btn-ghost:hover{ border-color:var(--ink-3); color:var(--ink); }
      .ops-page .hero-actions{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .ops-page .year-global{ display:inline-flex; align-items:center; gap:6px; padding:0 4px 0 12px; height:38px; border-radius:10px; background:#fff; border:1px solid var(--line); color:var(--ink-2); }
      .ops-page .year-global svg{ color:var(--green-d); }
      .ops-page .year-global .sel{ border:0; background:transparent; height:36px; padding:0 8px 0 4px; font-weight:600; color:var(--ink); cursor:pointer; }
      .ops-page .reset{ background:transparent; border:0; color:var(--green-d); font-weight:600; font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; padding:6px 8px; border-radius:7px; }
      .ops-page .reset:hover{ background:var(--green-t2); }

      .ops-page .kpis{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:18px; }
      @media (max-width:760px){ .ops-page .kpis{ grid-template-columns:repeat(2,1fr); } }
      .ops-page .kpi{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px 16px; box-shadow:var(--sh-sm); display:flex; flex-direction:column; gap:7px; }
      .ops-page .kpi .lbl{ font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--mute); font-weight:700; display:flex; align-items:center; gap:6px; }
      .ops-page .kpi .lbl svg{ color:var(--green-d); }
      .ops-page .kpi .val{ font-size:24px; font-weight:700; letter-spacing:-.025em; line-height:1; font-variant-numeric:tabular-nums; }

      .ops-page .optabs{ display:flex; align-items:stretch; gap:0; margin:0 0 16px; border-bottom:1px solid var(--line); overflow-x:auto; }
      .ops-page .optabs::-webkit-scrollbar{ display:none; }
      .ops-page .optabs button{ appearance:none; background:transparent; border:0; cursor:pointer; padding:12px 16px 11px; font-size:13.5px; font-weight:600; color:var(--mute); border-bottom:2px solid transparent; margin-bottom:-1px; display:inline-flex; align-items:center; gap:8px; line-height:1; white-space:nowrap; font-family:inherit; transition:color .15s, border-color .15s; }
      .ops-page .optabs button:hover{ color:var(--ink-2); }
      .ops-page .optabs button.active{ color:var(--green-d); border-bottom-color:var(--green); }
      .ops-page .optabs button .count{ font-size:10.5px; font-weight:700; padding:2px 7px; border-radius:99px; background:var(--paper-2); color:var(--mute); }
      .ops-page .optabs button.active .count{ background:var(--green-t); color:var(--green-d); }

      .ops-page .filters{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:16px; }
      .ops-page .search{ position:relative; flex:1; max-width:380px; min-width:200px; }
      .ops-page .search input{ width:100%; padding:10px 12px 10px 36px; font-size:13.5px; border:1px solid var(--line); border-radius:10px; background:#fff; outline:none; }
      .ops-page .search input:focus{ border-color:var(--green); box-shadow:0 0 0 3px rgba(46,159,130,.08); }
      .ops-page .search .ic{ position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--mute); }
      .ops-page .search .clear{ position:absolute; right:8px; top:50%; transform:translateY(-50%); background:transparent; border:0; color:var(--mute); cursor:pointer; width:24px; height:24px; border-radius:6px; display:grid; place-items:center; }
      .ops-page .sel{ appearance:none; padding:10px 32px 10px 14px; font-size:13.5px; border:1px solid var(--line); border-radius:10px; background:#fff; color:var(--ink-2); cursor:pointer; font-weight:500; }
      .ops-page .sel-wrap{ position:relative; }
      .ops-page .sel-wrap::after{ content:''; position:absolute; right:14px; top:50%; width:6px; height:6px; border-right:1.5px solid var(--mute); border-bottom:1.5px solid var(--mute); transform:translateY(-65%) rotate(45deg); pointer-events:none; }
      .ops-page .results{ margin-left:auto; font-size:12.5px; color:var(--mute); font-weight:500; }

      .ops-page .card{ background:#fff; border:1px solid var(--line); border-radius:16px; box-shadow:var(--sh-sm); }
      .ops-page .empty{ padding:56px 24px; text-align:center; color:var(--mute); }
      .ops-page .empty .ic{ width:48px; height:48px; border-radius:14px; background:var(--green-t); color:var(--green-d); display:grid; place-items:center; margin:0 auto 12px; }
      .ops-page .empty h3{ margin:0 0 6px; font-size:18px; font-weight:700; color:var(--ink); }
      .ops-page .empty p{ margin:0 auto; font-size:13.5px; color:var(--ink-3); max-width:46ch; }

      .ops-page .list{ display:flex; flex-direction:column; gap:12px; }
      .ops-page .opcard{ background:#fff; border:1px solid var(--line); border-radius:16px; padding:16px 18px; box-shadow:var(--sh-sm); transition:opacity .15s; }
      .ops-page .opcard.busy{ opacity:.55; pointer-events:none; }

      .ops-page .top{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
      .ops-page .who{ display:flex; align-items:center; gap:12px; min-width:0; }
      .ops-page .av{ width:40px; height:40px; border-radius:11px; background:var(--green-t); color:var(--green-d); display:grid; place-items:center; font-weight:700; font-size:13px; flex-shrink:0; border:1px solid #cfe7dc; }
      .ops-page .info .ref{ font-family:'DM Mono',ui-monospace,monospace; font-size:13px; font-weight:500; display:flex; align-items:center; gap:7px; }
      .ops-page .info .tenant{ font-size:12.5px; color:var(--mute); margin-top:2px; }
      .ops-page .type-chip{ font-size:9px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); font-weight:700; padding:2px 6px; border-radius:99px; background:var(--paper-2); }
      .ops-page .type-chip.renewal{ background:var(--sky-bg); color:var(--sky-fg); }
      .ops-page .stage-chip{ font-size:9px; letter-spacing:.06em; text-transform:uppercase; font-weight:700; padding:2px 6px; border-radius:99px; }
      .ops-page .stage-chip.active{ background:var(--green-t); color:var(--green-d); }
      .ops-page .stage-chip.issued{ background:var(--sky-bg); color:var(--sky-fg); }
      .ops-page .stage-chip.pending{ background:var(--warn-bg); color:var(--warn-fg); }
      .ops-page .stage-chip.winddown{ background:var(--danger-bg); color:var(--danger-fg); }
      .ops-page .live-note{ font-size:11.5px; font-weight:600; color:var(--green-d); background:var(--green-t2); border:1px solid #cfe7dc; padding:8px 12px; border-radius:9px; white-space:nowrap; }

      .ops-page .meta{ display:flex; align-items:center; gap:22px; flex-wrap:wrap; }
      .ops-page .m-prop .unit, .ops-page .m-term .span{ font-size:13px; font-weight:600; color:var(--ink-2); line-height:1.3; }
      .ops-page .m-prop .bldg{ font-size:11.5px; color:var(--mute); }
      .ops-page .m-term .rent{ font-size:11.5px; color:var(--mute); display:flex; align-items:center; gap:4px; margin-top:1px; }
      .ops-page .m-term .rent svg{ color:var(--green-d); }

      .ops-page .progress{ display:flex; flex-direction:column; align-items:center; gap:4px; }
      .ops-page .ring{ width:46px; height:46px; border-radius:99px; display:grid; place-items:center; font-size:11px; font-weight:700; color:var(--ink-2); font-variant-numeric:tabular-nums;
        background:conic-gradient(var(--green) calc(var(--pct)*1%), var(--paper-2) 0); }
      .ops-page .ring span{ width:36px; height:36px; border-radius:99px; background:#fff; display:grid; place-items:center; }
      .ops-page .progress.ready .ring{ background:conic-gradient(var(--green) 100%, var(--green) 0); }
      .ops-page .progress.ready .ring span{ color:var(--green-d); }
      .ops-page .plabel{ font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--mute); font-weight:700; }
      .ops-page .progress.ready .plabel{ color:var(--green-d); }

      .ops-page .chips{ display:flex; flex-wrap:wrap; gap:7px; margin:14px 0 0; padding-top:14px; border-top:1px solid var(--line-2); }
      .ops-page .chip{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; padding:4px 9px; border-radius:99px; border:1px solid transparent; }
      .ops-page .chip.on{ background:var(--green-t2); color:var(--green-d); border-color:#cfe7dc; }
      .ops-page .chip.off{ background:var(--warn-bg); color:var(--warn-fg); border-color:#f4dd9b; }
      .ops-page .chip svg{ flex-shrink:0; }

      .ops-page .rownote{ margin-top:10px; font-size:12px; color:var(--danger-fg); background:var(--danger-bg); border:1px solid #f1c5c2; border-radius:9px; padding:7px 11px; }

      .ops-page .actions{ display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:14px; flex-wrap:wrap; }
      .ops-page .quick{ display:flex; flex-wrap:wrap; gap:7px; }
      .ops-page .qa{ font-size:12px; font-weight:600; padding:7px 11px; border-radius:9px; cursor:pointer; border:1px solid var(--line); background:#fff; color:var(--ink-2); }
      .ops-page .qa:hover:not(:disabled){ border-color:var(--green); color:var(--green-d); background:var(--green-t2); }
      .ops-page .qa:disabled{ opacity:.5; cursor:not-allowed; }
      .ops-page .right{ display:flex; align-items:center; gap:10px; margin-left:auto; }
      .ops-page .open{ display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:var(--ink-2); text-decoration:none; padding:8px 12px; border-radius:9px; border:1px solid var(--line); background:#fff; }
      .ops-page .open:hover{ border-color:var(--ink-3); color:var(--ink); }
      .ops-page .activate{ display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; padding:8px 14px; border-radius:9px; cursor:pointer; border:1px solid var(--line); background:#fff; color:var(--ink-2); }
      .ops-page .activate:hover:not(:disabled){ border-color:var(--ink-3); color:var(--ink); }
      .ops-page .activate.go{ background:var(--green); border-color:var(--green); color:#fff; }
      .ops-page .activate.go:hover:not(:disabled){ background:var(--green-d); border-color:var(--green-d); }
      .ops-page .activate:disabled{ opacity:.5; cursor:not-allowed; }
    `}</style>
  );
}
