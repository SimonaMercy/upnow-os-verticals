'use client';

/**
 * Manager — Leads. Matches the RP Leads list design exactly (header + stage
 * tabs + search + lead rows), consuming /manager/viewings, scoped by the
 * LandlordSwitcher and gated by canManageViewings.
 */

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Loader2, Lock, Clock, Calendar, Building2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { LandlordSwitcher } from '@/components/dashboard/LandlordSwitcher';

interface Lead {
  id: number;
  stage: string;
  customerName: string | null;
  createdAt: string | null;
  convertedTenant?: { user?: { name?: string; email?: string; phone?: string } } | null;
  unit?: { id: number; unitNumber: string; property?: { buildingName: string; rentalProviderId: number } } | null;
  viewings?: { id: number; scheduledAt: string; status: string }[];
}

const STAGE_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', viewing_scheduled: 'Viewing', offer_made: 'Offer Made',
  applied: 'Applied', approved: 'Approved', documents_collection: 'Docs Collection',
  payment_plan_shared: 'Plan Shared', interested: 'Interested', cheques_submitted: 'Cheques Ready',
  cheques_collected: 'Cheques Collected', contract_issued: 'Contract Issued',
  rejected: 'Rejected', converted: 'Converted',
};
const STAGE_PILL: Record<string, string> = {
  new: 'bg-[#dbeafe] text-[#1e40af]', contacted: 'bg-[#ede9fe] text-[#6d28d9]',
  viewing_scheduled: 'bg-[#fef3c7] text-[#92400e]', offer_made: 'bg-[#d8f2e8] text-[#1a7a5a]',
  applied: 'bg-[#fce7f3] text-[#9d174d]', approved: 'bg-[#d1fae5] text-[#065f46]',
  documents_collection: 'bg-[#fff7ed] text-[#c2410c]', payment_plan_shared: 'bg-[#f0f9ff] text-[#0369a1]',
  interested: 'bg-[#d8f2e8] text-[#1f5a3f]', cheques_submitted: 'bg-[#fef9c3] text-[#854d0e]',
  cheques_collected: 'bg-[#d8f2e8] text-[#1a7a5a]', contract_issued: 'bg-[#d1fae5] text-[#065f46]',
  rejected: 'bg-[#fee2e2] text-[#b91c1c]', converted: 'bg-[#e0f2fe] text-[#0369a1]',
};
const TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'new', label: 'New' }, { key: 'contacted', label: 'Contacted' },
  { key: 'viewing_scheduled', label: 'Viewing' }, { key: 'documents_collection', label: 'Docs' },
  { key: 'payment_plan_shared', label: 'Plan Shared' }, { key: 'interested', label: 'Interested' },
  { key: 'cheques_submitted', label: 'Cheques Ready' }, { key: 'cheques_collected', label: 'Collected' },
  { key: 'contract_issued', label: 'Contract' }, { key: 'converted', label: 'Converted' },
];

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
}
function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
}

export default function ManagerLeadsPage() {
  const { can, loading: permsLoading } = useManagerPermissions();
  const params   = useSearchParams();
  const rpFilter = params.get('rp') ? Number(params.get('rp')) : null;
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ['manager-viewings'],
    queryFn:  () => apiGet<Lead[]>('/manager/viewings'),
  });

  const scoped = useMemo(
    () => leads.filter(l => !rpFilter || l.unit?.property?.rentalProviderId === rpFilter),
    [leads, rpFilter],
  );

  const tabCount = (key: string) => key === 'all' ? scoped.length : scoped.filter(l => l.stage === key).length;

  const filtered = scoped.filter(l => {
    if (activeTab !== 'all' && l.stage !== activeTab) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const name = l.convertedTenant?.user?.name ?? l.customerName ?? '';
      return (
        name.toLowerCase().includes(q) ||
        (l.convertedTenant?.user?.email ?? '').toLowerCase().includes(q) ||
        (l.unit?.property?.buildingName ?? '').toLowerCase().includes(q) ||
        (l.unit?.unitNumber ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (!permsLoading && !can('canManageViewings')) {
    return (
      <div className="p-5 sm:p-6 max-w-5xl mx-auto">
        <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Lock size={20} className="text-amber-500" />
          </div>
          <p className="text-base font-semibold text-[#1a1916] mb-1">Permission Required</p>
          <p className="text-sm text-[#9b9890]">You need the <strong>Manage Viewings</strong> permission. Ask your landlord to update your access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Leads</h1>
          <p className="text-sm text-[#9b9890] mt-0.5">
            {scoped.length} lead{scoped.length !== 1 ? 's' : ''} in pipeline
          </p>
        </div>
        <LandlordSwitcher />
      </div>

      {/* Stage tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-5 scrollbar-none">
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                isActive ? 'bg-[#1a1916] text-white' : 'bg-white text-[#6b6860] border border-[#e8e6e0] hover:bg-[#f4f3ef]'
              }`}
            >
              {tab.label}
              {!isLoading && (
                <span className={`rounded-full px-1.5 py-0.5 font-bold text-[10px] ${isActive ? 'bg-white/20 text-white' : 'bg-[#f0ede8] text-[#9b9890]'}`}>
                  {tabCount(tab.key)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8c6c0]" />
          <input
            type="text"
            placeholder="Search name, email, phone, unit…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82] bg-white"
          />
        </div>
        {search && (
          <button onClick={() => setSearch('')} className="text-xs text-[#9b9890] hover:text-[#3d3b35] flex items-center gap-1 cursor-pointer">
            <X size={12} /> Clear
          </button>
        )}
        <span className="text-xs text-[#9b9890] ml-auto">{filtered.length} results</span>
      </div>

      {/* List */}
      {isLoading || permsLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#9b9890]">
          <Loader2 size={16} className="animate-spin" /> Loading leads…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <p className="text-sm font-medium text-[#1a1916]">No leads found</p>
          <p className="text-xs text-[#9b9890] mt-1">{search || activeTab !== 'all' ? 'Try a different search or filter.' : 'Customer enquiries will appear here.'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(l => {
            const name = l.convertedTenant?.user?.name ?? l.customerName ?? 'Prospect';
            const email = l.convertedTenant?.user?.email ?? null;
            const phone = l.convertedTenant?.user?.phone ?? null;
            const unitLabel = l.unit?.unitNumber ? `Unit ${l.unit.unitNumber}` : null;
            const building = l.unit?.property?.buildingName ?? null;
            const viewing = l.viewings?.find(v => v.status === 'scheduled') ?? l.viewings?.[0];
            return (
              <div key={l.id} className="bg-white rounded-xl flex items-center justify-between" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div className="flex items-center gap-3 py-3 pl-4 min-w-0 flex-1">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: '#2e9f82' }}>
                    {initials(name)}
                  </div>
                  {/* Name + contact */}
                  <div className="min-w-0" style={{ width: 190 }}>
                    <p className="text-sm font-semibold text-[#1a1916] truncate">{name}</p>
                    <p className="text-xs text-[#9b9890] truncate mt-0.5">{email ?? 'No email'}{phone ? ` · ${phone}` : ''}</p>
                  </div>
                  {/* Property */}
                  <div className="min-w-0 hidden sm:block" style={{ width: 155 }}>
                    {unitLabel ? (
                      <>
                        <p className="text-sm text-[#1a1916] font-medium truncate flex items-center gap-1">
                          <Building2 size={11} className="text-[#c8c6c0] shrink-0" />{unitLabel}
                        </p>
                        {building && <p className="text-xs text-[#9b9890] truncate pl-4">{building}</p>}
                      </>
                    ) : <span className="text-xs text-[#c8c6c0]">No unit</span>}
                  </div>
                  {/* Stage */}
                  <div style={{ width: 108 }} className="shrink-0 hidden md:block">
                    <span className={`inline-flex items-center rounded-full text-[11px] font-semibold px-2.5 py-1 ${STAGE_PILL[l.stage] ?? 'bg-[#f0ede8] text-[#6b6860]'}`}>
                      {STAGE_LABELS[l.stage] ?? l.stage}
                    </span>
                  </div>
                  {/* Date */}
                  <div style={{ width: 150 }} className="shrink-0 hidden lg:block">
                    {viewing ? (
                      <div className={`flex items-center gap-1.5 text-xs font-medium ${new Date(viewing.scheduledAt) <= new Date() ? 'text-amber-600' : 'text-[#6b6860]'}`}>
                        <Clock size={11} className="shrink-0" /> {fmtDateTime(viewing.scheduledAt)}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-[#9b9890]">
                        <Calendar size={11} className="shrink-0" /> {fmtDate(l.createdAt)}
                      </div>
                    )}
                  </div>
                </div>
                {/* Right: stage pill on mobile */}
                <div className="flex items-center gap-2 pr-4 pl-2 shrink-0 md:hidden">
                  <span className={`inline-flex items-center rounded-full text-[11px] font-semibold px-2.5 py-1 ${STAGE_PILL[l.stage] ?? 'bg-[#f0ede8] text-[#6b6860]'}`}>
                    {STAGE_LABELS[l.stage] ?? l.stage}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
