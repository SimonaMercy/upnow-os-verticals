/**
 * OperationsKanban — the drag-and-drop "Setup pipeline" board: the second view
 * of the Operations worklist (toggle: List ⇄ Board), shared by the RP and
 * Manager Operations pages. Same data as OperationsBoard (GET listPath), same
 * row actions (/contracts/:id/*), rendered as a kanban instead of a list.
 *
 * COLUMNS ARE OUR REAL SETUP PIPELINE — not the design's invented lifecycle
 * lanes. Each column is one gate of buildOperationsList()'s checklist, in order:
 *
 *   Signatures → KYC → Payment plan → PDC → Ejari → Utility → Move-in
 *               → Ready to activate            (+ a Winding down lane)
 *
 * A card lives in the column of its FIRST incomplete step (its current blocker).
 * The board covers BOTH new and renewed leases — renewals simply never surface
 * in the Utility / Move-in columns (those steps aren't on a renewal's checklist).
 *
 * DRAG = ADVANCE. Dragging a card to a later column completes every gate before
 * it that we can flip in one click — PDC / Ejari / Utility. The heavy gates
 * (signatures, KYC, payment plan, move-in) can't be done from a board, so the
 * card advances as far as the one-click steps allow and a note points the admin
 * into the contract page for the rest. A card whose every step is done lands in
 * "Ready to activate"; "Mark active" there locks the lease and it leaves the
 * board for the Leases register.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, X, RefreshCw, Calendar, ClipboardList, CheckCircle2, ArrowRight,
  PenLine, LogOut, FileText, GripVertical,
} from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { tenantDisplayName } from '@/lib/tenantName';
import type { OpsContract } from '@/components/upnow/OperationsBoard';
import OperationsViewToggle from '@/components/upnow/OperationsViewToggle';

interface Props {
  listPath: string;
  contractHref: (id: number) => string;
  canAct?: boolean;
}

// ── Pipeline columns (our checklist gates), left → right ──
type ColKey = 'signatures' | 'kyc' | 'payment_plan' | 'pdc' | 'ejari' | 'utility' | 'move_in' | 'ready' | 'winddown';
interface ColDef { key: ColKey; title: string; hint: string; accent: string; soft: string; dot: string }
const COLS: ColDef[] = [
  { key: 'signatures',   title: 'Signatures',        hint: 'Customer + landlord must sign on the contract page.', accent: '#9a4a44', soft: '#f7edea', dot: '#c0473a' },
  { key: 'kyc',          title: 'KYC verification',  hint: 'Emirates ID on file.',                                accent: '#4a5a8f', soft: '#eef0fa', dot: '#4a5a8f' },
  { key: 'payment_plan', title: 'Payment plan',      hint: 'Cheque / rent schedule entered.',                     accent: '#a9791f', soft: '#fdf6ea', dot: '#e6a91e' },
  { key: 'pdc',          title: 'PDC',               hint: 'Post-dated cheques confirmed.',                       accent: '#3f6f8f', soft: '#e6f0f3', dot: '#3f6f8f' },
  { key: 'ejari',        title: 'Ejari',             hint: 'Tenancy registered with the certificate on file.',    accent: '#1a7a4f', soft: '#e7f3ec', dot: '#1a9a64' },
  { key: 'utility',      title: 'Utility',           hint: 'DEWA / utility account on file (new leases).',        accent: '#6a4f8f', soft: '#efeaf5', dot: '#6a4f8f' },
  { key: 'move_in',      title: 'Move-in',           hint: 'Move-in inspection signed (new leases).',             accent: '#2b7a78', soft: '#e3f1f0', dot: '#2b7a78' },
  { key: 'ready',        title: 'Ready to activate', hint: 'Every step done — lock it and it moves to Leases.',   accent: '#1a7a5a', soft: '#ebf8f2', dot: '#2e9f82' },
  { key: 'winddown',     title: 'Winding down',      hint: 'Terminated leases finishing move-out & settlement.',  accent: '#991b1b', soft: '#fee2e2', dot: '#991b1b' },
];
const COL_INDEX: Record<ColKey, number> = COLS.reduce((m, c, i) => { m[c.key] = i; return m; }, {} as Record<ColKey, number>);

// Map a checklist key → the column it belongs to.
function stageKeyToCol(key: string): ColKey {
  if (key === 'sign_tenant' || key === 'sign_landlord') return 'signatures';
  if (key === 'kyc' || key === 'payment_plan' || key === 'pdc' || key === 'ejari' || key === 'utility' || key === 'move_in') return key;
  return 'ready';
}
// The column a card currently sits in = its first incomplete gate.
function cardColumn(c: OpsContract): ColKey {
  if (c.windDown) return 'winddown';
  const firstUndone = c.checklist.find(i => !i.done);
  return firstUndone ? stageKeyToCol(firstUndone.key) : 'ready';
}

// Inline one-click flips (mirror OperationsBoard). Everything else deep-links.
const QUICK: Record<string, { path: string; label: string }> = {
  pdc:     { path: 'confirm-pdc',           label: 'Confirm PDC' },
  utility: { path: 'utility/mark-on-file',  label: 'Mark utility on file' },
  ejari:   { path: 'ejari/mark-registered', label: 'Mark Ejari on file' },
};

type TypeKey = 'all' | 'new' | 'renewal';
const TYPE_TABS: { key: TypeKey; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'new', label: 'New' }, { key: 'renewal', label: 'Renewal' },
];

function fmtShort(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: '2-digit' });
}
function fmtAed(n: number): string { return n.toLocaleString('en-AE'); }
function initials(name: string | null): string {
  if (!name) return '—';
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export default function OperationsKanban({ listPath, contractHref, canAct = true }: Props) {
  const [rows, setRows] = useState<OpsContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAsset, setFilterAsset] = useState('all');
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [filterType, setFilterType] = useState<TypeKey>('all');
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ id: number; text: string; bad?: boolean } | null>(null);
  // Drag state: which card is in flight (and the column it came from) + the
  // column currently hovered (for the drop highlight).
  const [drag, setDrag] = useState<{ id: number; col: ColKey } | null>(null);
  const [overCol, setOverCol] = useState<ColKey | null>(null);

  const load = useMemo(() => () =>
    apiGet<OpsContract[]>(listPath).then(d => { if (Array.isArray(d)) setRows(d); }).catch(() => undefined), [listPath]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const assets = useMemo(
    () => [...new Set(rows.map(c => c.property.buildingName).filter((s): s is string => Boolean(s)))], [rows]);

  const years = useMemo(() => {
    const set = new Set<string>();
    const yearOf = (d: string | null) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null);
    for (const c of rows) { const sy = yearOf(c.startDate); if (sy) set.add(sy); const ey = yearOf(c.endDate); if (ey) set.add(ey); }
    set.add(String(new Date().getFullYear()));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [rows]);

  // Year scopes the whole board, same overlap rule as the list view.
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

  // Search + property — applied before the type tabs so the tab counts reflect them.
  const scoped = useMemo(() => yearScoped.filter(c => {
    if (filterAsset !== 'all' && c.property.buildingName !== filterAsset) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = [c.ref, c.tenant.name, c.tenant.companyName, c.tenant.email, c.unit.number, c.property.buildingName]
        .filter((s): s is string => Boolean(s)).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [yearScoped, search, filterAsset]);

  const typeCounts = useMemo<Record<TypeKey, number>>(() => ({
    all: scoped.length,
    new: scoped.filter(c => c.contractType !== 'renewal').length,
    renewal: scoped.filter(c => c.contractType === 'renewal').length,
  }), [scoped]);

  const visible = useMemo(() => scoped.filter(c => {
    if (filterType === 'new' && c.contractType === 'renewal') return false;
    if (filterType === 'renewal' && c.contractType !== 'renewal') return false;
    return true;
  }), [scoped, filterType]);

  // Bucket the visible cards into their pipeline columns.
  const byColumn = useMemo(() => {
    const map = new Map<ColKey, OpsContract[]>();
    for (const c of visible) {
      const col = cardColumn(c);
      const arr = map.get(col) ?? [];
      arr.push(c);
      map.set(col, arr);
    }
    // Within a column: most-complete first (closest to clearing the gate), newest as tiebreak.
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.doneCount - a.doneCount) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    }
    return map;
  }, [visible]);

  // Dynamic lanes: render only stages that actually hold cards, so the board stays
  // focused on live work. Renewals never produce Utility / Move-in cards, so those
  // lanes drop off entirely; an empty Signatures lane likewise disappears once
  // nothing is pending signature, etc. While dragging, we also keep visible the
  // empty FORWARD lanes that are real gates on the dragged card (plus Ready), so it
  // still has a drop target — without resurfacing stages the card doesn't have
  // (e.g. a renewal never flashes Utility / Move-in mid-drag).
  const dragCard = drag ? rows.find(r => r.id === drag.id) : null;
  const dragTargetCols = dragCard
    ? new Set<ColKey>([...dragCard.checklist.map(i => stageKeyToCol(i.key)), 'ready'])
    : null;
  const renderedCols = COLS.filter(c => {
    if ((byColumn.get(c.key)?.length ?? 0) > 0) return true;
    if (drag && isForward(drag.col, c.key) && dragTargetCols?.has(c.key)) return true;
    return false;
  });

  const hasFilters = filterAsset !== 'all' || filterYear !== 'all' || filterType !== 'all' || search !== '';

  const stats = useMemo(() => ({
    total: yearScoped.length,
    live: yearScoped.filter(c => c.status === 'active' && !c.windDown).length,
    winding: yearScoped.filter(c => c.windDown).length,
    ready: yearScoped.filter(c => c.status !== 'active' && c.doneCount >= c.totalCount).length,
    drafts: yearScoped.filter(c => c.status === 'pending' && !c.contractSent).length,
  }), [yearScoped]);

  function isForward(src: ColKey, tgt: ColKey) {
    return tgt !== 'winddown' && COL_INDEX[tgt] > COL_INDEX[src];
  }

  // Run a single one-click flip on a card's CURRENT blocker (the quick button).
  async function runQuick(c: OpsContract, action: string) {
    const q = QUICK[action];
    if (!q || busy || !canAct) return;
    setBusy(c.id); setNote(null);
    try {
      const res = await apiPatch<{ matched?: boolean }>(`/contracts/${c.id}/${q.path}`, {});
      if (action === 'ejari' && res && res.matched === false) {
        setNote({ id: c.id, text: 'No Ejari certificate on file — open the contract to upload/register it.', bad: true });
      }
      await load();
    } catch (e) {
      setNote({ id: c.id, text: (e as Error)?.message || 'Action failed.', bad: true });
    } finally { setBusy(null); }
  }

  // Drag a card to a later column → walk its remaining gates IN ORDER, flipping
  // each one-click step until we hit a gate that needs the contract page. The
  // card then lands wherever those flips left it; a note points at the wall.
  async function advanceTo(c: OpsContract, target: ColKey) {
    if (!canAct || busy) return;
    if (!isForward(cardColumn(c), target)) return;
    const tIdx = COL_INDEX[target];
    // Gates strictly before the target that are still open, in checklist order.
    const needed = c.checklist.filter(i => !i.done && COL_INDEX[stageKeyToCol(i.key)] < tIdx);
    const flippable = (i: OpsContract['checklist'][number]) => !!(i.action && QUICK[i.action]);
    // If the very next gate is a wall, the drag can't do anything — say so plainly.
    if (needed.length && !flippable(needed[0])) {
      setNote({ id: c.id, text: `${needed[0].label} must be completed on the contract page first.`, bad: true });
      return;
    }
    setBusy(c.id); setNote(null);
    try {
      let wall: OpsContract['checklist'][number] | null = null;
      let ejariUnmatched = false;
      for (const step of needed) {
        if (!flippable(step)) { wall = step; break; }          // contiguous: stop at the first wall
        const q = QUICK[step.action as string];
        const res = await apiPatch<{ matched?: boolean }>(`/contracts/${c.id}/${q.path}`, {});
        // Ejari "mark on file" only links an EXISTING certificate — treat a miss as a wall.
        if (step.action === 'ejari' && res && res.matched === false) { wall = step; ejariUnmatched = true; break; }
      }
      await load();
      if (ejariUnmatched) {
        setNote({ id: c.id, text: 'No Ejari certificate on file — open the contract to upload/register it.', bad: true });
      } else if (wall) {
        setNote({ id: c.id, text: `Advanced as far as possible — ${wall.label} needs the contract page.`, bad: false });
      }
    } catch (e) {
      setNote({ id: c.id, text: (e as Error)?.message || 'Action failed.', bad: true });
    } finally { setBusy(null); }
  }

  async function markActive(c: OpsContract) {
    if (busy || !canAct) return;
    const missing = c.totalCount - c.doneCount;
    if (missing > 0) {
      const ok = window.confirm(`${missing} item${missing === 1 ? '' : 's'} still missing for ${c.ref}.\n\nMark active anyway? It will move to Leases.`);
      if (!ok) return;
    }
    setBusy(c.id); setNote(null);
    try { await apiPatch(`/contracts/${c.id}/activate`, {}); await load(); }
    catch (e) { setNote({ id: c.id, text: (e as Error)?.message || 'Could not activate.', bad: true }); await load(); }
    finally { setBusy(null); }
  }

  return (
    <div className="opsk-page">
      <main className="main">
        <div className="hero">
          <div className="left">
            <div className="eyebrow"><ClipboardList size={12} /> Operations</div>
            <h1>Setup <span className="accent">pipeline</span></h1>
            <p>Every contract on one board by setup stage — <b>new and renewals together</b>. Drag a card forward to clear the one-click steps (PDC · Ejari · Utility); the rest open the contract.</p>
          </div>
          <div className="hero-actions">
            <OperationsViewToggle active="board" />
            <div className="year-global" title="Scope the board by lease year">
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

        <div className="optabs">
          {TYPE_TABS.map(t => (
            <button key={t.key} type="button" className={filterType === t.key ? 'active' : ''} onClick={() => setFilterType(t.key)}>
              {t.label}<span className="count">{typeCounts[t.key]}</span>
            </button>
          ))}
          <div className="tabs-spacer" />
          <div className="search">
            <span className="ic"><Search size={15} /></span>
            <input placeholder="Search ref, customer, unit…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button type="button" className="clear" onClick={() => setSearch('')}><X size={14} /></button>}
          </div>
          <div className="sel-wrap">
            <select className="sel" value={filterAsset} onChange={e => setFilterAsset(e.target.value)}>
              <option value="all">All properties</option>
              {assets.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button type="button" className="reset" onClick={() => { setFilterAsset('all'); setFilterYear('all'); setFilterType('all'); setSearch(''); }}>
              <X size={12} /> Reset
            </button>
          )}
        </div>

        {loading ? (
          <div className="empty"><p>Loading board…</p></div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <div className="ic"><CheckCircle2 size={20} /></div>
            <h3>{rows.length === 0 ? 'Nothing in operations' : 'No matches'}</h3>
            <p>{rows.length === 0
              ? 'Every contract is set up and locked. New or incomplete contracts will appear here for completion.'
              : 'Try clearing your search or filters.'}</p>
          </div>
        ) : (
          <div className="board">
            {renderedCols.map(col => {
              const cards = byColumn.get(col.key) ?? [];
              const isDropTarget = !!drag && isForward(drag.col, col.key);
              const isOver = overCol === col.key && isDropTarget;
              return (
                <section
                  key={col.key}
                  className={'lane' + (isDropTarget ? ' droppable' : '') + (isOver ? ' over' : '')}
                  onDragOver={e => { if (isDropTarget) { e.preventDefault(); setOverCol(col.key); } }}
                  onDragLeave={() => { if (overCol === col.key) setOverCol(null); }}
                  onDrop={e => {
                    e.preventDefault();
                    if (drag) { const c = rows.find(r => r.id === drag.id); if (c) advanceTo(c, col.key); }
                    setDrag(null); setOverCol(null);
                  }}
                >
                  <header className="lane-head">
                    <span className="dot" style={{ background: col.dot }} />
                    <span className="lane-title" style={{ color: col.accent }}>{col.title}</span>
                    <span className="lane-count" style={{ color: col.accent, background: col.soft }}>{cards.length}</span>
                  </header>
                  <div className="lane-body">
                    {cards.map(c => {
                      const isRenewal = c.contractType === 'renewal';
                      const isWindDown = !!c.windDown;
                      const isLive = c.status === 'active' && !isWindDown;
                      const ready = c.doneCount >= c.totalCount && !isWindDown;
                      const tenantLabel = tenantDisplayName(c.tenant);
                      const rowBusy = busy === c.id;
                      const blocker = c.checklist.find(i => !i.done);
                      const quickAction = blocker && blocker.action && QUICK[blocker.action] ? blocker.action : null;
                      const draggable = canAct && !isWindDown && !ready && !rowBusy;
                      return (
                        <article
                          key={c.id}
                          className={'card' + (rowBusy ? ' busy' : '') + (draggable ? ' grab' : '')}
                          draggable={draggable}
                          onDragStart={e => { if (!draggable) { e.preventDefault(); return; } setDrag({ id: c.id, col: col.key }); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragEnd={() => { setDrag(null); setOverCol(null); }}
                        >
                          <div className="c-top">
                            {draggable && <span className="handle" aria-hidden><GripVertical size={14} /></span>}
                            <span className="av">{initials(tenantLabel)}</span>
                            <div className="c-id">
                              <div className="c-name">{tenantLabel ?? '—'}</div>
                              <div className="c-ref">{c.ref}</div>
                            </div>
                            <span className={'type ' + (isRenewal ? 'renewal' : 'new')}>{isRenewal ? 'Renewal' : 'New'}</span>
                          </div>

                          <div className="c-unit">{c.unit.number ? `Unit ${c.unit.number}` : (c.unit.name ?? '—')} · {c.property.buildingName ?? '—'}</div>

                          <div className="c-segs">
                            {c.checklist.map(i => (
                              <span key={i.key} className="seg" title={i.label} style={{ background: i.done ? col.dot : '#e3e8e3', opacity: i.done ? 1 : .9 }} />
                            ))}
                            <span className="c-count">{c.doneCount}/{c.totalCount}</span>
                          </div>

                          {!isWindDown && (
                            <div className="c-blocker" style={{ color: ready ? '#1a7a5a' : col.accent }}>
                              {ready ? 'Ready to activate' : `${blocker?.label ?? 'In setup'} needed`}
                            </div>
                          )}
                          {isWindDown && <div className="c-blocker" style={{ color: '#991b1b' }}>Move-out &amp; settlement</div>}

                          {note?.id === c.id && <div className={'c-note' + (note.bad ? ' bad' : '')}>{note.text}</div>}

                          <div className="c-foot">
                            <span className="rent">AED {fmtAed(c.annualRent)}</span>
                            <span className="term">{fmtShort(c.startDate)}–{fmtShort(c.endDate)}</span>
                          </div>

                          <div className="c-actions">
                            <Link href={contractHref(c.id)} className="open">Open <ArrowRight size={12} /></Link>
                            {canAct && isWindDown ? (
                              <Link href={contractHref(c.id)} className="go"><LogOut size={13} /> Move-out</Link>
                            ) : canAct && ready ? (
                              isLive
                                ? <span className="live">Live · finishing</span>
                                : <button type="button" className="go" disabled={rowBusy} onClick={() => markActive(c)}><CheckCircle2 size={13} /> Mark active</button>
                            ) : canAct && quickAction ? (
                              <button type="button" className="quick" disabled={rowBusy} onClick={() => runQuick(c, quickAction)}>{QUICK[quickAction].label}</button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                    {cards.length === 0 && <div className="lane-empty">{col.hint}</div>}
                  </div>
                </section>
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
      .opsk-page {
        --green:#2e9f82; --green-d:#1a7a5a; --green-t:#d8f2e8; --green-t2:#ebf8f2;
        --ink:#1a1916; --ink-2:#3d3b35; --ink-3:#6b6860; --mute:#9b9890;
        --line:#e8e6e0; --line-2:#f0eeea; --paper:#f4f3ef; --paper-2:#ebe9e3;
        --warn-bg:#fef3c7; --warn-fg:#92400e; --sky-bg:#e0f2fe; --sky-fg:#0369a1;
        --danger-bg:#fee2e2; --danger-fg:#991b1b; --sh-sm:0 1px 2px rgba(26,25,22,.04);
        background:var(--paper); color:var(--ink); min-height:100vh; font-family:inherit; font-size:14px; line-height:1.5; font-weight:450;
      }
      .opsk-page *{ box-sizing:border-box; }
      .opsk-page button, .opsk-page input, .opsk-page select{ font-family:inherit; color:inherit; }
      .opsk-page .main{ padding:32px 36px 64px; max-width:1480px; margin:0 auto; width:100%; }
      @media (max-width:720px){ .opsk-page .main{ padding:24px 16px 60px; } }

      .opsk-page .hero{ display:flex; justify-content:space-between; align-items:flex-start; gap:18px; margin-bottom:22px; flex-wrap:wrap; }
      .opsk-page .hero .left{ flex:1; min-width:280px; }
      .opsk-page .eyebrow{ font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--green-d); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
      .opsk-page .hero h1{ margin:0; font-size:32px; font-weight:700; letter-spacing:-.022em; line-height:1.1; }
      .opsk-page .hero h1 .accent{ color:var(--green-d); }
      .opsk-page .hero p{ margin:10px 0 0; font-size:14.5px; color:var(--ink-3); max-width:64ch; }
      .opsk-page .hero p b{ color:var(--ink-2); font-weight:700; }
      .opsk-page .hero-actions{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .opsk-page .btn{ display:inline-flex; align-items:center; gap:7px; padding:10px 14px; border-radius:10px; font-weight:600; font-size:13.5px; border:1px solid transparent; cursor:pointer; white-space:nowrap; }
      .opsk-page .btn-ghost{ background:#fff; color:var(--ink-2); border-color:var(--line); }
      .opsk-page .btn-ghost:hover{ border-color:var(--ink-3); color:var(--ink); }
      .opsk-page .year-global{ display:inline-flex; align-items:center; gap:6px; padding:0 4px 0 12px; height:38px; border-radius:10px; background:#fff; border:1px solid var(--line); color:var(--ink-2); }
      .opsk-page .year-global svg{ color:var(--green-d); }
      .opsk-page .year-global .sel{ border:0; background:transparent; height:36px; padding:0 8px 0 4px; font-weight:600; color:var(--ink); cursor:pointer; }
      .opsk-page .reset{ background:transparent; border:0; color:var(--green-d); font-weight:600; font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; padding:6px 8px; border-radius:7px; }
      .opsk-page .reset:hover{ background:var(--green-t2); }

      .opsk-page .kpis{ display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:18px; }
      @media (max-width:980px){ .opsk-page .kpis{ grid-template-columns:repeat(2,1fr); } }
      .opsk-page .kpi{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px 16px; box-shadow:var(--sh-sm); display:flex; flex-direction:column; gap:7px; }
      .opsk-page .kpi .lbl{ font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--mute); font-weight:700; display:flex; align-items:center; gap:6px; }
      .opsk-page .kpi .lbl svg{ color:var(--green-d); }
      .opsk-page .kpi .val{ font-size:24px; font-weight:700; letter-spacing:-.025em; line-height:1; font-variant-numeric:tabular-nums; }

      .opsk-page .optabs{ display:flex; align-items:center; gap:8px; margin:0 0 16px; flex-wrap:wrap; }
      .opsk-page .optabs > button{ appearance:none; background:#fff; border:1px solid var(--line); cursor:pointer; padding:9px 13px; font-size:13px; font-weight:600; color:var(--ink-3); border-radius:10px; display:inline-flex; align-items:center; gap:7px; line-height:1; }
      .opsk-page .optabs > button:hover{ color:var(--ink-2); }
      .opsk-page .optabs > button.active{ color:var(--green-d); border-color:var(--green); background:var(--green-t2); }
      .opsk-page .optabs > button .count{ font-size:10.5px; font-weight:700; padding:2px 7px; border-radius:99px; background:var(--paper-2); color:var(--mute); }
      .opsk-page .optabs > button.active .count{ background:var(--green-t); color:var(--green-d); }
      .opsk-page .tabs-spacer{ flex:1; min-width:8px; }
      .opsk-page .search{ position:relative; flex:1; max-width:320px; min-width:180px; }
      .opsk-page .search input{ width:100%; padding:10px 12px 10px 36px; font-size:13.5px; border:1px solid var(--line); border-radius:10px; background:#fff; outline:none; }
      .opsk-page .search input:focus{ border-color:var(--green); box-shadow:0 0 0 3px rgba(46,159,130,.08); }
      .opsk-page .search .ic{ position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--mute); }
      .opsk-page .search .clear{ position:absolute; right:8px; top:50%; transform:translateY(-50%); background:transparent; border:0; color:var(--mute); cursor:pointer; width:24px; height:24px; border-radius:6px; display:grid; place-items:center; }
      .opsk-page .sel{ appearance:none; padding:10px 32px 10px 14px; font-size:13.5px; border:1px solid var(--line); border-radius:10px; background:#fff; color:var(--ink-2); cursor:pointer; font-weight:500; }
      .opsk-page .sel-wrap{ position:relative; }
      .opsk-page .sel-wrap::after{ content:''; position:absolute; right:14px; top:50%; width:6px; height:6px; border-right:1.5px solid var(--mute); border-bottom:1.5px solid var(--mute); transform:translateY(-65%) rotate(45deg); pointer-events:none; }

      .opsk-page .empty{ background:#fff; border:1px solid var(--line); border-radius:16px; box-shadow:var(--sh-sm); padding:56px 24px; text-align:center; color:var(--mute); }
      .opsk-page .empty .ic{ width:48px; height:48px; border-radius:14px; background:var(--green-t); color:var(--green-d); display:grid; place-items:center; margin:0 auto 12px; }
      .opsk-page .empty h3{ margin:0 0 6px; font-size:18px; font-weight:700; color:var(--ink); }
      .opsk-page .empty p{ margin:0 auto; font-size:13.5px; color:var(--ink-3); max-width:46ch; }

      /* ── board ── */
      .opsk-page .board{ display:flex; gap:12px; align-items:flex-start; overflow-x:auto; padding-bottom:14px; scroll-snap-type:x proximity; }
      .opsk-page .board::-webkit-scrollbar{ height:10px; }
      .opsk-page .board::-webkit-scrollbar-thumb{ background:var(--paper-2); border-radius:99px; }
      .opsk-page .lane{ flex:0 0 268px; width:268px; background:#f7f8f6; border:1px solid var(--line-2); border-radius:14px; display:flex; flex-direction:column; scroll-snap-align:start; transition:background .15s, border-color .15s, box-shadow .15s; }
      .opsk-page .lane.droppable{ border-style:dashed; border-color:#cdd5cf; }
      .opsk-page .lane.over{ background:var(--green-t2); border-color:var(--green); box-shadow:0 0 0 3px rgba(46,159,130,.1); }
      .opsk-page .lane-head{ display:flex; align-items:center; gap:8px; padding:13px 13px 10px; }
      .opsk-page .lane-head .dot{ width:9px; height:9px; flex:0 0 9px; border-radius:50%; }
      .opsk-page .lane-title{ font-size:12.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
      .opsk-page .lane-count{ font-size:11px; font-weight:700; padding:2px 8px; border-radius:7px; flex:0 0 auto; }
      .opsk-page .lane-body{ padding:0 9px 11px; display:flex; flex-direction:column; gap:9px; min-height:60px; }
      .opsk-page .lane-empty{ border:1px dashed #d6ddd6; border-radius:11px; padding:18px 14px; text-align:center; font-size:11.5px; color:var(--mute); line-height:1.5; }

      .opsk-page .card{ background:#fff; border:1px solid #e9ece8; border-radius:12px; padding:11px; box-shadow:0 1px 2px rgba(20,40,30,.04); transition:opacity .15s, border-color .15s, box-shadow .15s; }
      .opsk-page .card.grab{ cursor:grab; }
      .opsk-page .card.grab:active{ cursor:grabbing; }
      .opsk-page .card.grab:hover{ border-color:#cfe0d4; box-shadow:0 2px 8px rgba(20,40,30,.08); }
      .opsk-page .card.busy{ opacity:.55; pointer-events:none; }

      .opsk-page .c-top{ display:flex; align-items:center; gap:8px; }
      .opsk-page .c-top .handle{ color:#c2cabf; margin:-2px -2px -2px -4px; flex:0 0 auto; display:flex; }
      .opsk-page .c-top .av{ width:28px; height:28px; flex:0 0 28px; border-radius:8px; background:var(--green-t); color:var(--green-d); display:grid; place-items:center; font-size:10.5px; font-weight:700; border:1px solid #cfe7dc; }
      .opsk-page .c-id{ flex:1; min-width:0; }
      .opsk-page .c-name{ font-size:12.5px; font-weight:700; color:var(--ink-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .opsk-page .c-ref{ font-family:'DM Mono',ui-monospace,monospace; font-size:10.5px; color:var(--mute); }
      .opsk-page .c-top .type{ font-size:9px; letter-spacing:.05em; text-transform:uppercase; font-weight:700; padding:2px 6px; border-radius:99px; flex:0 0 auto; }
      .opsk-page .c-top .type.new{ background:var(--paper-2); color:var(--ink-3); }
      .opsk-page .c-top .type.renewal{ background:var(--sky-bg); color:var(--sky-fg); }

      .opsk-page .c-unit{ font-size:11px; color:var(--mute); margin-top:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .opsk-page .c-segs{ display:flex; align-items:center; gap:3px; margin-top:9px; }
      .opsk-page .c-segs .seg{ flex:1; height:5px; border-radius:3px; }
      .opsk-page .c-segs .c-count{ font-size:10.5px; font-weight:700; color:var(--ink-3); font-variant-numeric:tabular-nums; margin-left:4px; flex:0 0 auto; }
      .opsk-page .c-blocker{ font-size:10.5px; font-weight:700; margin-top:7px; }
      .opsk-page .c-note{ margin-top:8px; font-size:11px; color:var(--ink-3); background:var(--green-t2); border:1px solid #cfe7dc; border-radius:8px; padding:6px 9px; line-height:1.45; }
      .opsk-page .c-note.bad{ color:var(--danger-fg); background:var(--danger-bg); border-color:#f1c5c2; }

      .opsk-page .c-foot{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:10px; }
      .opsk-page .c-foot .rent{ font-size:12.5px; font-weight:700; color:var(--green-d); font-variant-numeric:tabular-nums; }
      .opsk-page .c-foot .term{ font-size:10.5px; color:var(--mute); font-variant-numeric:tabular-nums; }

      .opsk-page .c-actions{ display:flex; align-items:center; gap:7px; margin-top:10px; padding-top:9px; border-top:1px solid #f1f3f0; }
      .opsk-page .c-actions .open{ display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:600; color:var(--ink-2); text-decoration:none; padding:6px 9px; border-radius:8px; border:1px solid var(--line); background:#fff; }
      .opsk-page .c-actions .open:hover{ border-color:var(--ink-3); color:var(--ink); }
      .opsk-page .c-actions .quick{ margin-left:auto; font-size:11.5px; font-weight:700; color:var(--green-d); background:var(--green-t2); border:1px solid #cce6d8; padding:6px 10px; border-radius:8px; cursor:pointer; white-space:nowrap; }
      .opsk-page .c-actions .quick:hover:not(:disabled){ background:var(--green-t); }
      .opsk-page .c-actions .quick:disabled{ opacity:.5; cursor:not-allowed; }
      .opsk-page .c-actions .go{ margin-left:auto; display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; color:#fff; background:var(--green); border:1px solid var(--green); padding:6px 11px; border-radius:8px; cursor:pointer; text-decoration:none; white-space:nowrap; }
      .opsk-page .c-actions .go:hover:not(:disabled){ background:var(--green-d); border-color:var(--green-d); }
      .opsk-page .c-actions .go:disabled{ opacity:.5; cursor:not-allowed; }
      .opsk-page .c-actions .live{ margin-left:auto; font-size:11px; font-weight:600; color:var(--green-d); background:var(--green-t2); border:1px solid #cfe7dc; padding:6px 10px; border-radius:8px; white-space:nowrap; }
    `}</style>
  );
}
