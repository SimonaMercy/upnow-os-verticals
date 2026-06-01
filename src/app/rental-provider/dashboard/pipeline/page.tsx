'use client';

/**
 * Pipeline — unified deal flow for rental providers.
 *
 * Draft v2 — denser, more scannable. List view is a single tightly-packed
 * surface (no per-row card chrome). Summary numbers ride on top of the
 * search bar as compact pills, not full-width tiles. Stage filter chips
 * stay above the list. Drawer (right side) carries the rich detail view.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, X, RefreshCw, Filter, Sparkles, Calendar, ListFilter,
} from 'lucide-react';
import { useDeals } from '@/components/pipeline/useDeals';
import { PipelineDealRow } from '@/components/pipeline/PipelineDealRow';
import { PipelineDealDrawer } from '@/components/pipeline/PipelineDealDrawer';
import { LeadsCalendarView } from '@/components/leads/LeadsCalendarView';
import {
  Deal,
  PIPELINE_STAGE_LABEL,
  PIPELINE_STAGE_ORDER,
  PipelineStage,
} from '@/components/pipeline/types';

type StageFilter = 'all' | 'open' | 'closed' | PipelineStage;

const STAGE_FILTERS: { key: StageFilter; label: string }[] = [
  { key: 'all',             label: 'All' },
  { key: 'open',            label: 'Open' },
  ...PIPELINE_STAGE_ORDER.map(s => ({ key: s, label: PIPELINE_STAGE_LABEL[s] })),
];

const PAGE_SIZE = 50;

function matchesFilter(deal: Deal, filter: StageFilter): boolean {
  if (filter === 'all')     return true;
  if (filter === 'open')    return deal.pipelineStage !== 'closed_lost' && deal.pipelineStage !== 'active';
  if (filter === 'closed')  return deal.pipelineStage === 'closed_lost';
  return deal.pipelineStage === filter;
}

export default function PipelinePage() {
  const router = useRouter();
  const { deals, loading, error, refetch } = useDeals();

  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<StageFilter>('open');
  const [view, setView]       = useState<'list' | 'calendar'>('list');
  const [openDeal, setDeal]   = useState<Deal | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    return deals.filter(d => {
      if (!matchesFilter(d, filter)) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [
          d.customerName, d.customerPhone, d.customerEmail,
          d.unitLabel, d.buildingName, d.contractRef,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [deals, filter, search]);

  // Reset visible window when filter/search changes
  useMemo(() => { setVisible(PAGE_SIZE); return null; }, [filter, search]);

  const stageCount = useMemo(() => {
    const counts: Record<PipelineStage, number> = {
      interest: 0, viewing: 0, documents: 0, plan: 0,
      cheques: 0, contract_issued: 0, active: 0, closed_lost: 0,
    };
    for (const d of deals) counts[d.pipelineStage]++;
    return counts;
  }, [deals]);

  const openCount = useMemo(
    () => deals.filter(d => d.pipelineStage !== 'closed_lost' && d.pipelineStage !== 'active').length,
    [deals],
  );

  const calendarLeads = useMemo(() => {
    return deals
      .filter(d => d.viewingAt && d.rawLead)
      .map(d => d.rawLead as Parameters<typeof LeadsCalendarView>[0]['leads'][number]);
  }, [deals]);

  function handlePrimary(deal: Deal, actionKey: string) {
    switch (actionKey) {
      case 'mark-contacted':
      case 'mark-visited':
      case 'review-docs':
      case 'review-plan':
      case 'record-cheques':
      case 'reopen':
        if (deal.leadId) router.push('/rental-provider/dashboard/leads');
        break;
      case 'open-contract':
        if (deal.contractId) router.push(`/rental-provider/dashboard/contracts/${deal.contractId}`);
        break;
    }
  }

  const visibleDeals = filtered.slice(0, visible);
  const hasMore      = visible < filtered.length;

  return (
    <div className="p-5 sm:p-6 max-w-6xl mx-auto">

      {/* ─── Header strip ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-[#1a1916] flex items-center gap-2">
            Pipeline
            <span className="text-[9px] font-bold uppercase tracking-wider bg-[#fef3c7] text-[#854d0e] border border-[#fde68a] rounded-full px-1.5 py-0.5">
              Beta
            </span>
          </h1>
          {!loading && (
            <div className="flex items-center gap-1.5 text-xs text-[#9b9890]">
              <span className="font-semibold text-[#1a1916]">{deals.length}</span>
              deals
              <span className="text-[#d4d0c8]">·</span>
              <span className="font-semibold text-[#1a1916]">{openCount}</span>
              open
              <span className="text-[#d4d0c8]">·</span>
              <span className="font-semibold text-[#1a1916]">{stageCount.active}</span>
              active
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex bg-[#f4f3ef] rounded-md p-0.5 border border-[#e8e6e0]">
            <button
              onClick={() => setView('list')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded cursor-pointer transition-colors ${
                view === 'list' ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860]'
              }`}
            >
              <ListFilter size={11} className="inline mr-1" /> List
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded cursor-pointer transition-colors ${
                view === 'calendar' ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860]'
              }`}
            >
              <Calendar size={11} className="inline mr-1" /> Calendar
            </button>
          </div>
          <button
            onClick={refetch}
            disabled={loading}
            className="flex items-center gap-1 text-[11px] text-[#6b6860] border border-[#e8e6e0] rounded-md px-2.5 py-1 hover:bg-[#f4f3ef] disabled:opacity-50 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── Calendar view ────────────────────────────────────────────── */}
      {view === 'calendar' && (
        <LeadsCalendarView
          leads={calendarLeads}
          onOpenLead={(id) => {
            const match = deals.find(d => d.leadId === id);
            if (match) { setView('list'); setDeal(match); }
          }}
        />
      )}

      {/* ─── List view ────────────────────────────────────────────────── */}
      {view === 'list' && (
        <>
          {/* Stage filter chips */}
          <div className="flex gap-1 overflow-x-auto pb-1 mb-3 scrollbar-none">
            {STAGE_FILTERS.map(f => {
              const isActive = filter === f.key;
              const count =
                f.key === 'all'    ? deals.length :
                f.key === 'open'   ? openCount :
                f.key === 'closed' ? stageCount.closed_lost :
                stageCount[f.key as PipelineStage];
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-[#1a1916] text-white'
                      : 'text-[#6b6860] hover:bg-[#f4f3ef]'
                  }`}
                >
                  {f.label}
                  {!loading && (
                    <span className={`text-[10px] font-bold ${
                      isActive ? 'text-white/70' : 'text-[#9b9890]'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search bar */}
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8c6c0]" />
            <input
              type="text"
              placeholder="Search name, unit, building, contract ref…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-[#e8e6e0] rounded-lg pl-8 pr-9 py-2 text-[13px] focus:outline-none focus:border-[#2e9f82] bg-white"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9b9890] hover:text-[#3d3b35] cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-3 rounded-lg px-3 py-2 text-xs bg-red-50 text-red-700 border border-red-200">
              {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="bg-white rounded-xl border border-[#ede9e3] overflow-hidden">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-12 border-b border-[#f0ede8] animate-pulse bg-[#fafaf8]" />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && deals.length === 0 && (
            <div className="bg-white rounded-xl p-12 flex flex-col items-center text-center border border-[#ede9e3]">
              <div className="w-10 h-10 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-2">
                <Sparkles size={16} className="text-[#2e9f82]" />
              </div>
              <p className="font-semibold text-[#1a1916] text-sm mb-1">No deals yet</p>
              <p className="text-xs text-[#9b9890] max-w-xs">
                Customer × unit deals appear here as soon as leads or contracts are created.
              </p>
            </div>
          )}

          {/* Filtered empty */}
          {!loading && deals.length > 0 && filtered.length === 0 && (
            <div className="bg-white rounded-xl p-10 flex flex-col items-center text-center border border-[#ede9e3]">
              <Filter size={18} className="text-[#c8c6c0] mb-2" />
              <p className="text-xs text-[#9b9890]">No deals match this filter.</p>
              <button
                onClick={() => { setFilter('all'); setSearch(''); }}
                className="mt-2 text-xs text-[#2e9f82] hover:underline cursor-pointer"
              >
                Show all
              </button>
            </div>
          )}

          {/* Dense list */}
          {!loading && visibleDeals.length > 0 && (
            <div className="bg-white rounded-xl border border-[#ede9e3] overflow-hidden">
              {visibleDeals.map(deal => (
                <PipelineDealRow
                  key={deal.id}
                  deal={deal}
                  onOpen={setDeal}
                  onPrimary={handlePrimary}
                />
              ))}

              {hasMore && (
                <button
                  onClick={() => setVisible(v => v + PAGE_SIZE)}
                  className="w-full py-2.5 text-xs font-medium text-[#2e9f82] bg-[#fafaf8] hover:bg-[#f0ede8] border-t border-[#f0ede8] cursor-pointer"
                >
                  Show {Math.min(PAGE_SIZE, filtered.length - visible)} more
                  <span className="text-[#9b9890] ml-1">({filtered.length - visible} hidden)</span>
                </button>
              )}
            </div>
          )}

          {/* Result count footer */}
          {!loading && filtered.length > 0 && (
            <p className="text-[11px] text-[#9b9890] text-center mt-2">
              Showing {visibleDeals.length} of {filtered.length}
              {filtered.length !== deals.length && ` · ${deals.length - filtered.length} hidden by filter`}
            </p>
          )}
        </>
      )}

      {/* Detail drawer */}
      <PipelineDealDrawer
        deal={openDeal}
        onClose={() => setDeal(null)}
        onPrimary={handlePrimary}
      />
    </div>
  );
}
