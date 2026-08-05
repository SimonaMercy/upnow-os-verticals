/**
 * Customers directory — Claude-Design "Customers" handoff.
 *
 * Shared, presentational list UI for the RP Customers page and its manager
 * mirror. Owns search / filter / view (Row · Grid) state and renders the hero,
 * KPI strip, controls and cards. The parent stays thin: it derives the customer
 * rows (lib/customersDirectory) and supplies the per-row view link + optional
 * "Add customer" handler.
 *
 * Pixel values mirror page-redesign-request/project/Customers.dc.html.
 */
'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Users, FileText, Search, Rows3, LayoutGrid, Mail, Phone, Plus, User,
} from 'lucide-react';
import s from './customersDirectory.module.css';
import { renewalDaysOf, type DirectoryCustomer } from '@/lib/customersDirectory';

const cn = (...x: Array<string | false | null | undefined>) => x.filter(Boolean).join(' ');

// Avatar tints, cycled by row position (matches the prototype palette).
const PALETTE = ['#e7f3ec|#1a7a4f', '#eaecf7|#4a5a8f', '#f3ecdd|#7a5a2e', '#e8f1f6|#3f6f8f', '#f0eaf6|#6b4a8f'];

// Row amount — whole AED (the backend carries full-precision arrears; we round
// only at display, matching the customer detail page's stored precision).
const fmt = (n: number) => 'AED ' + Math.round(n).toLocaleString('en-US');
// Card stat ("AED 55.1K") — drops the .0 on round thousands.
const fmtShort = (n: number) =>
  n < 1 ? 'AED 0' : n >= 1000 ? 'AED ' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K' : 'AED ' + Math.round(n);
function initialsOf(name: string): string {
  const w = name.replace(/L\.L\.C/gi, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return w || (name[0] ?? '').toUpperCase();
}

const typeChip = (company: boolean): CSSProperties => ({
  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
  color: company ? '#7a5a2e' : '#5a635c', background: company ? '#f3ecdd' : '#eef1ec',
});

function renewalText(c: DirectoryCustomer): string {
  const d = renewalDaysOf(c.nextRenewalEnd);
  if (d === null) return 'No renewal date';
  if (d < 0) return `Renewal overdue ${Math.abs(d)}d`;
  return `Renews in ${d}d`;
}

type Filter = 'all' | 'individual' | 'company' | 'ended';
type View = 'row' | 'grid';

export interface CustomersDirectoryProps {
  customers: DirectoryCustomer[];
  loading: boolean;
  /** When provided, shows the "Add customer" button wired to this handler. */
  onAdd?: () => void;
  /** Per-row "View" link target. */
  viewHref: (id: number) => string;
  /** Empty-state copy for a customer list that's genuinely empty (vs filtered). */
  emptySubtitle?: string;
}

export function CustomersDirectory({ customers, loading, onAdd, viewHref, emptySubtitle }: CustomersDirectoryProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('row');

  // "Ended leases" shows the customers with no counting lease left; every other
  // filter works inside the active pool.
  const scope = useMemo(
    () => customers.filter((c) => (filter === 'ended' ? !c.active : c.active)),
    [customers, filter],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scope.filter((c) => {
      if (filter === 'individual' && c.company) return false;
      if (filter === 'company' && !c.company) return false;
      return !q || `${c.name} ${c.email} ${c.phone ?? ''}`.toLowerCase().includes(q);
    });
  }, [scope, query, filter]);

  // KPIs — the active pool, on the platform's earning-lease rule (see
  // lib/customersDirectory). Independent of the filter/search in view.
  const activeCustomers = useMemo(() => customers.filter((c) => c.active), [customers]);
  const totalCustomers = activeCustomers.length;
  const activeLeases = activeCustomers.reduce((sum, c) => sum + c.activeLeaseCount, 0);

  const dash = (v: string) => (loading ? '…' : v);
  const kpis: Array<{ label: string; value: string; sub: string; icon: ReactNode; iconBg: string; iconColor: string; color: string }> = [
    { label: 'TOTAL CUSTOMERS', value: dash(String(totalCustomers)), sub: 'Holding a live lease', icon: <Users size={16} />, iconBg: '#eef6f1', iconColor: '#1a7a4f', color: '#1d2823' },
    { label: 'ACTIVE LEASES', value: dash(String(activeLeases)), sub: 'Neither ended nor terminated', icon: <FileText size={16} />, iconBg: '#eef6f1', iconColor: '#1a7a4f', color: '#1d2823' },
  ];

  const filtersDirty = !!query || filter !== 'all';

  return (
    <div className={s.app}>
      <div className={s.main}>
        {/* Hero */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#1a7a4f' }}>
              <User size={13} strokeWidth={2.2} /> DIRECTORY
            </div>
            <h1 style={{ margin: '6px 0 4px', fontSize: 30, fontWeight: 800, letterSpacing: '-.025em', color: '#1d2823' }}>Customers</h1>
            <div style={{ fontSize: 13, color: '#8a938c', maxWidth: '70ch', lineHeight: 1.5 }}>
              Active customers — anyone holding a lease that has neither ended nor been terminated, including a renewal still in flight on a unit they occupy. Switch the filter to “Ended leases” for the rest.
            </div>
          </div>
          {onAdd && (
            <button type="button" className={s.addBtn} onClick={onAdd}>
              <Plus size={17} /> Add customer
            </button>
          )}
        </div>

        {/* KPI strip */}
        <div className={s.kpiGrid}>
          {kpis.map((k) => (
            <div key={k.label} style={{ background: '#fff', border: '1px solid #e7ebe6', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: 9, background: k.iconBg, color: k.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{k.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#a0a8a1' }}>{k.label}</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', color: k.color, marginTop: 11, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
              <div style={{ fontSize: 11.5, color: '#9aa39c', marginTop: 2 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Controls — search · filter · view toggle */}
        <div className={s.controls}>
          <div className={s.search}>
            <span className={s.searchIc}><Search size={17} /></span>
            <input
              className={s.searchInput}
              type="search"
              aria-label="Search customers by name, email or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email or phone…"
            />
          </div>
          <select className={s.select} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All customers</option>
            <option value="individual">Individual</option>
            <option value="company">Companies</option>
            <option value="ended">Ended leases</option>
          </select>
          <div className={s.toggle}>
            <button type="button" title="Row view" aria-label="Row view" aria-pressed={view === 'row'} onClick={() => setView('row')}
              className={cn(s.toggleBtn, view === 'row' && s.toggleBtnActive)}><Rows3 size={17} /></button>
            <button type="button" title="Grid view" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}
              className={cn(s.toggleBtn, view === 'grid' && s.toggleBtnActive)}><LayoutGrid size={17} /></button>
          </div>
        </div>

        {/* Result count */}
        <div className={s.resultCount}>
          <strong>{loading ? '…' : list.length}</strong> of {scope.length} {filter === 'ended' ? 'ended-lease customers' : 'customers'}
        </div>

        {/* States */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '56px 20px', color: '#9aa39c', fontSize: 13.5 }}>Loading customers…</div>
        ) : customers.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyTtl}>No customers yet</div>
            <div className={s.emptySub}>{emptySubtitle ?? 'Customers appear here once you have a rental agreement.'}</div>
          </div>
        ) : list.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyTtl}>{filter === 'ended' && scope.length === 0 ? 'No ended-lease customers' : 'No customers match your search'}</div>
            <div className={s.emptySub}>
              {filter === 'ended' && scope.length === 0
                ? 'Every customer still holds a counting lease.'
                : 'Try a different name, email, or filter.'}
            </div>
            {filtersDirty && (
              <button type="button" onClick={() => { setQuery(''); setFilter('all'); }}
                style={{ marginTop: 14, fontSize: 12.5, fontWeight: 600, color: '#1a7a4f', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }}>
                Clear filters
              </button>
            )}
          </div>
        ) : view === 'row' ? (
          <RowView list={list} viewHref={viewHref} />
        ) : (
          <GridView list={list} viewHref={viewHref} />
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

// ─── Row view ─────────────────────────────────────────────
function RowView({ list, viewHref }: { list: DirectoryCustomer[]; viewHref: (id: number) => string }) {
  return (
    <div className={s.rowTable}>
      <div className={s.rowHead}>
        <div>CUSTOMER</div>
        <div className={s.colContact}>CONTACT</div>
        <div>LEASES</div>
        <div style={{ textAlign: 'right' }}>OUTSTANDING</div>
        <div style={{ textAlign: 'right' }}>ACTION</div>
      </div>
      {list.map((c, i) => {
        const [avBg, avColor] = PALETTE[i % PALETTE.length].split('|');
        const hasOut = Math.round(c.outstanding) > 0;
        return (
          <Link key={c.id} href={viewHref(c.id)} className={s.rowItem}>
            {/* Customer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <span style={{ width: 38, height: 38, flex: '0 0 38px', borderRadius: 10, background: avBg, color: avColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>{initialsOf(c.name)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1d2823', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: '#9aa39c', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={typeChip(c.company)}>{c.company ? 'Company' : 'Individual'}</span>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>· {c.leaseCount} lease{c.leaseCount === 1 ? '' : 's'}</span>
                </div>
              </div>
            </div>
            {/* Contact */}
            <div className={s.colContact} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: '#3a443d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email || '—'}</div>
              <div style={{ fontSize: 11.5, color: '#9aa39c' }}>{c.phone || '—'}</div>
            </div>
            {/* Leases */}
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#2b342e' }}>{c.leaseCount}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#1a7a4f' }}>{c.activeLeaseCount} active</div>
            </div>
            {/* Outstanding */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: hasOut ? '#b07415' : '#1a6b4d', fontVariantNumeric: 'tabular-nums' }}>{hasOut ? fmt(c.outstanding) : 'AED 0'}</div>
              <div style={{ fontSize: 11, color: '#9aa39c' }}>{!hasOut ? 'fully collected' : c.active ? 'across active units' : 'on ended leases'}</div>
            </div>
            {/* Action */}
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a7a4f' }}>View →</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Grid view ────────────────────────────────────────────
function GridView({ list, viewHref }: { list: DirectoryCustomer[]; viewHref: (id: number) => string }) {
  return (
    <div className={s.grid}>
      {list.map((c, i) => {
        const [avBg, avColor] = PALETTE[i % PALETTE.length].split('|');
        const hasOut = Math.round(c.outstanding) > 0;
        return (
          <Link key={c.id} href={viewHref(c.id)} className={s.gridCard}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 46, height: 46, flex: '0 0 46px', borderRadius: 12, background: avBg, color: avColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800 }}>{initialsOf(c.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <span style={typeChip(c.company)}>{c.company ? 'Company' : 'Individual'}</span>
                </div>
              </div>
            </div>
            {/* Contact */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 14, paddingTop: 13, borderTop: '1px solid #f1f3f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#5a635c', minWidth: 0 }}>
                <Mail size={14} style={{ color: '#a0a8a1', flex: '0 0 auto' }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email || '—'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#5a635c' }}>
                <Phone size={14} style={{ color: '#a0a8a1', flex: '0 0 auto' }} />
                {c.phone || '—'}
              </div>
            </div>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
              <div style={{ background: '#fbfcfb', border: '1px solid #eef1ec', borderRadius: 11, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: '#a0a8a1' }}>LEASES</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1d2823', marginTop: 3 }}>{c.leaseCount}</div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: '#1a7a4f' }}>{c.activeLeaseCount} active</div>
              </div>
              <div style={{ background: hasOut ? '#fdf6ea' : '#fbfcfb', border: `1px solid ${hasOut ? '#efe1bf' : '#eef1ec'}`, borderRadius: 11, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: '#a0a8a1' }}>OUTSTANDING</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: hasOut ? '#b07415' : '#1a6b4d', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtShort(c.outstanding)}</div>
                <div style={{ fontSize: 10.5, color: '#9aa39c' }}>{!hasOut ? 'fully collected' : c.active ? 'across active units' : 'on ended leases'}</div>
              </div>
            </div>
            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
              <span style={{ fontSize: 11.5, color: '#9aa39c' }}>{renewalText(c)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a7a4f' }}>View profile →</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
