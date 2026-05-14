/**
 * Rental Provider — Leads Kanban (rental-provider/dashboard/leads)
 *
 * Kanban board showing all leads across stages: New → Viewing Scheduled →
 * Viewing Completed → Offer Sent → Negotiating → Accepted → Converted.
 *
 * RP/AM can update lead stage, add notes, and create a contract directly
 * from an accepted lead. Viewings are shown inline per lead card.
 *
 * Data: GET /leads/rp/all — returns leads with embedded viewings.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, X, RefreshCw, Calendar, Phone, Mail,
  Building2, ChevronDown, ArrowRight, Clock, CheckCircle2, MessageSquare, User,
  FileText, ExternalLink, Loader2,
} from 'lucide-react';

type LeadStage = 'new' | 'contacted' | 'viewing_scheduled' | 'applied' | 'offer_made' | 'approved' | 'rejected' | 'converted';

const STAGE_ORDER: LeadStage[] = ['new', 'contacted', 'viewing_scheduled', 'applied', 'offer_made', 'approved', 'rejected', 'converted'];

const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  viewing_scheduled: 'Viewing Scheduled',
  applied: 'Applied',
  offer_made: 'Offer Made',
  approved: 'Approved',
  rejected: 'Rejected',
  converted: 'Converted',
};

const STAGE_PILL: Record<LeadStage, string> = {
  new: 'bg-[#dbeafe] text-[#1e40af]',
  contacted: 'bg-[#ede9fe] text-[#6d28d9]',
  viewing_scheduled: 'bg-[#fef3c7] text-[#92400e]',
  applied: 'bg-[#fce7f3] text-[#9d174d]',
  offer_made: 'bg-[#d8f2e8] text-[#1a7a5a]',
  approved: 'bg-[#d1fae5] text-[#065f46]',
  rejected: 'bg-[#fee2e2] text-[#b91c1c]',
  converted: 'bg-[#e0f2fe] text-[#0369a1]',
};

const PRIORITY_PILL: Record<string, string> = {
  high: 'bg-red-50 text-red-700',
  medium: 'bg-yellow-50 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
};

interface ApiViewing {
  id: number;
  scheduledAt: string;
  status: string;
  desiredMoveIn?: string | null;
  notes?: string | null;
}

interface ApiLead {
  id: number;
  stage: LeadStage;
  priority: string;
  customerName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  source: string | null;
  notes: string | null;
  createdAt: string;
  viewings?: ApiViewing[];
  convertedTenant: { id: number; user?: { name?: string; email?: string; phone?: string } } | null;
  unit: { id: number; unitNumber: string; unitName: string | null; property?: { id: number; buildingName: string } } | null;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
}

function nextStages(stage: LeadStage): LeadStage[] {
  const map: Partial<Record<LeadStage, LeadStage[]>> = {
    new: ['contacted'],
    contacted: ['viewing_scheduled'],
    // After viewing: tenant may have already applied (via app), or RP can move directly to offer
    viewing_scheduled: ['applied', 'offer_made'],
    applied: ['offer_made'],
    offer_made: ['approved'],
    rejected: ['new'], // reopen
  };
  return map[stage] ?? [];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
}

function extractOccupantsLine(notes?: string | null) {
  if (!notes) return null;
  return notes
    .split('\n')
    .map(line => line.trim())
    .find(line => line.toLowerCase().startsWith('occupants:')) ?? null;
}

/* ── Row Component ─────────────────────────────────────────────────────────── */
function LeadRow({ lead, onMoveStage, moving, onConvert, setLeads }: {
  lead: ApiLead;
  onMoveStage: (id: number, s: LeadStage) => void;
  moving: boolean;
  onConvert: (lead: ApiLead) => void;
  setLeads: React.Dispatch<React.SetStateAction<ApiLead[]>>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmLost, setConfirmLost] = useState(false);
  const [markVisitOpen, setMarkVisitOpen] = useState(false);
  const [visitRemarks, setVisitRemarks] = useState('');
  const [markingVisit, setMarkingVisit] = useState(false);
  const [visitError, setVisitError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [tenantDocs, setTenantDocs] = useState<{ id: number; documentKey: string; displayName: string | null; fileUrl: string; mimeType: string | null; status: string }[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);

  // Show Documents button whenever the tenant has a profile linked AND at least one viewing
  // has been completed — regardless of lead stage (docs are uploaded right after the visit).
  const hasCompletedViewing = lead.viewings?.some(v => ['completed', 'no_show'].includes(v.status)) ?? false;
  const canViewDocs = !!lead.convertedTenant?.id && hasCompletedViewing;

  async function loadTenantDocs() {
    if (!lead.convertedTenant?.id) return;
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/documents?ownerType=customer&ownerId=${lead.convertedTenant.id}`, { credentials: 'include' });
      if (res.ok) setTenantDocs(await res.json());
    } finally { setDocsLoading(false); }
  }

  function toggleDocs() {
    if (!docsOpen && tenantDocs === null) loadTenantDocs();
    setDocsOpen(o => !o);
  }

  const displayName = lead.convertedTenant?.user?.name ?? lead.customerName;
  const email = lead.leadEmail ?? lead.convertedTenant?.user?.email ?? null;
  const phone = lead.leadPhone ?? lead.convertedTenant?.user?.phone ?? null;
  const unitLabel = lead.unit?.unitName ?? (lead.unit ? `Unit ${lead.unit.unitNumber}` : null);
  const building = lead.unit?.property?.buildingName ?? null;

  // Most recent scheduled/confirmed viewing (past or future)
  const upcomingViewing = lead.viewings
    ?.filter(v => v.status === 'scheduled' || v.status === 'confirmed')
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0];

  const viewingInPast = upcomingViewing && new Date(upcomingViewing.scheduledAt) <= new Date();

  const nexts = nextStages(lead.stage);
  const occupantsLine = extractOccupantsLine(upcomingViewing?.notes ?? lead.notes);

  async function handleMarkVisited() {
    if (!upcomingViewing) return;
    setMarkingVisit(true); setVisitError(null);
    try {
      const res = await fetch(`/api/leads/viewings/${upcomingViewing.id}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', notes: visitRemarks.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setVisitError(body.message ?? 'Failed to mark as visited'); return; }
      setMarkVisitOpen(false); setVisitRemarks('');
      // Optimistically update viewing status in local state
      setLeads(prev => prev.map(l =>
        l.id !== lead.id ? l : {
          ...l,
          viewings: l.viewings?.map(v =>
            v.id === upcomingViewing.id ? { ...v, status: 'completed' } : v
          ),
        }
      ));
    } finally { setMarkingVisit(false); }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#f0ede8] overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">

        {/* Avatar + name + contact */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
            style={{ backgroundColor: '#2e9f82' }}
          >
            {initials(displayName)}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[#1a1916] text-base leading-snug">{displayName}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
              {email ? (
                <a href={`mailto:${email}`} className="flex items-center gap-1 text-xs text-[#2e9f82] hover:underline">
                  <Mail size={11} /> {email}
                </a>
              ) : (
                <span className="flex items-center gap-1 text-xs text-[#c8c6c0]"><Mail size={11} /> No email on file</span>
              )}
              {phone ? (
                <a href={`tel:${phone}`} className="flex items-center gap-1 text-xs text-[#2e9f82] hover:underline">
                  <Phone size={11} /> {phone}
                </a>
              ) : (
                <span className="flex items-center gap-1 text-xs text-[#c8c6c0]"><Phone size={11} /> No phone on file</span>
              )}
            </div>
          </div>
        </div>

        {/* Property */}
        <div className="sm:w-48 min-w-0">
          {unitLabel ? (
            <div className="flex items-start gap-1.5">
              <Building2 size={13} className="text-[#9b9890] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#1a1916] leading-tight">{unitLabel}</p>
                {building && <p className="text-xs text-[#9b9890] truncate">{building}</p>}
              </div>
            </div>
          ) : (
            <span className="text-xs text-[#c8c6c0]">No unit assigned</span>
          )}
        </div>

        {/* Stage + priority */}
        <div className="flex items-center gap-2 sm:w-44 flex-wrap">
          <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-1 ${STAGE_PILL[lead.stage]}`}>
            {STAGE_LABELS[lead.stage]}
          </span>
          <span className={`inline-flex items-center rounded-full text-[10px] font-semibold px-2 py-0.5 capitalize ${PRIORITY_PILL[lead.priority] ?? 'bg-gray-100 text-gray-600'}`}>
            {lead.priority}
          </span>
        </div>

        {/* Viewing date / added date */}
        <div className="sm:w-36 text-xs text-[#6b6860]">
          {upcomingViewing ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[#92400e] bg-[#fef3c7] rounded-lg px-2 py-1">
                <Clock size={11} />
                <span className="font-medium">{fmtDateTime(upcomingViewing.scheduledAt)}</span>
              </div>
              {occupantsLine && (
                <p className="text-[11px] text-[#6b6860] truncate" title={occupantsLine}>
                  {occupantsLine}
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[#9b9890]">
              <Calendar size={11} />
              <span>Added {fmtDate(lead.createdAt)}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {email && (
            <a
              href={`mailto:${email}`}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[#f4f3f0] text-[#3d3b35] hover:bg-[#e8e6e0] transition-colors font-medium"
            >
              <Mail size={12} /> Email
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[#f4f3f0] text-[#3d3b35] hover:bg-[#e8e6e0] transition-colors font-medium"
            >
              <Phone size={12} /> Call
            </a>
          )}
          {/* Mark as Visited — shown whenever a scheduled/confirmed viewing exists */}
          {upcomingViewing && (
            <button
              onClick={() => { setMarkVisitOpen(true); setVisitError(null); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[#edf7f3] text-[#2e9f82] hover:bg-[#d8f2e8] transition-colors font-medium border border-[#a7f3d0]"
            >
              <CheckCircle2 size={12} /> Mark Visited
            </button>
          )}
          {(['applied', 'offer_made', 'approved'] as LeadStage[]).includes(lead.stage) && lead.unit?.id && lead.convertedTenant?.id && (
            <button
              onClick={() => onConvert(lead)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[#2e9f82] text-white hover:bg-[#1f6655] transition-colors font-medium"
            >
              <ArrowRight size={12} /> Convert to Contract
            </button>
          )}
          {canViewDocs && (
            <button
              onClick={toggleDocs}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors font-medium ${docsOpen ? 'bg-[#edf7f3] border-[#a7f3d0] text-[#1a7a5a]' : 'bg-[#f4f3f0] border-[#e8e6e0] text-[#3d3b35] hover:bg-[#e8e6e0]'}`}
            >
              <FileText size={12} /> Documents {docsOpen ? '▲' : '▼'}
            </button>
          )}
          {/* Reject button — separate from Move, requires confirmation */}
          {lead.stage !== 'approved' && lead.stage !== 'rejected' && lead.stage !== 'converted' && (
            <button
              onClick={() => setConfirmLost(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium border border-red-100"
            >
              Reject Lead
            </button>
          )}
          {nexts.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3f0] transition-colors"
            >
              {lead.stage === 'rejected' ? 'Reopen' : 'Advance'} <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded stage advance / reopen */}
      {expanded && (
        <div className="border-t border-[#f0ede8] px-4 py-3 bg-[#fafaf8] flex flex-wrap items-center gap-3">
          <span className="text-xs text-[#9b9890] font-medium">
            {(lead.stage as string) === 'closed_lost' ? 'Reopen as:' : 'Advance to:'}
          </span>
          {nexts.map(s => (
            <button
              key={s}
              disabled={moving}
              onClick={() => { onMoveStage(lead.id, s); setExpanded(false); }}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-50 cursor-pointer ${STAGE_PILL[s]}`}
            >
              {STAGE_LABELS[s]}
            </button>
          ))}
          {lead.notes && (
            <p className="ml-auto text-xs text-[#9b9890] italic max-w-xs truncate">Note: {lead.notes}</p>
          )}
        </div>
      )}

      {/* Mark as Visited panel */}
      {markVisitOpen && upcomingViewing && (
        <div className="border-t border-[#e8f7f1] px-4 py-4 bg-[#f0faf6]">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={14} className="text-[#2e9f82]" />
            <p className="text-sm font-semibold text-[#1a1916]">Mark viewing as completed</p>
            <span className="ml-auto text-xs text-[#9b9890]">
              {fmtDateTime(upcomingViewing.scheduledAt)}
            </span>
          </div>
          <label className="block text-xs font-medium text-[#3d3b35] mb-1.5">
            <MessageSquare size={11} className="inline mr-1" />
            Remarks from tenant <span className="text-[#9b9890] font-normal">(optional)</span>
          </label>
          <textarea
            value={visitRemarks}
            onChange={e => setVisitRemarks(e.target.value)}
            rows={3}
            placeholder="e.g. Loved the view, concerned about parking, wants to negotiate rent…"
            className="w-full text-sm border border-[#c5ede2] rounded-xl px-3 py-2.5 text-[#1a1916] resize-none focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 bg-white mb-3"
          />
          {visitError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{visitError}</p>
          )}
          <div className="flex gap-2">
            <button
              disabled={markingVisit}
              onClick={handleMarkVisited}
              className="text-xs px-4 py-2 rounded-xl bg-[#2e9f82] text-white font-semibold hover:bg-[#1f6655] disabled:opacity-50 transition-colors"
            >
              {markingVisit ? 'Saving…' : 'Confirm Visit'}
            </button>
            <button
              onClick={() => { setMarkVisitOpen(false); setVisitRemarks(''); setVisitError(null); }}
              className="text-xs px-4 py-2 rounded-xl bg-white border border-[#e8e6e0] text-[#6b6860] font-medium hover:bg-[#f4f3f0] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Confirm Close Lost dialog */}
      {confirmLost && (
        <div className="border-t border-red-100 px-4 py-4 bg-red-50">
          <p className="text-sm font-semibold text-red-700 mb-1">Reject this lead?</p>
          <p className="text-xs text-red-500 mb-3">
            This means you&apos;re no longer pursuing <strong>{lead.convertedTenant?.user?.name ?? lead.customerName}</strong> for this unit.
            You can reopen the lead later if needed.
          </p>
          <div className="flex gap-2">
            <button
              disabled={moving}
              onClick={() => { onMoveStage(lead.id, 'rejected'); setConfirmLost(false); setExpanded(false); }}
              className="text-xs px-4 py-2 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Yes, reject this lead
            </button>
            <button
              onClick={() => setConfirmLost(false)}
              className="text-xs px-4 py-2 rounded-xl bg-white border border-red-200 text-red-600 font-medium hover:bg-red-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tenant KYC Documents */}
      {docsOpen && (
        <div className="border-t border-[#e8e6e0] px-4 py-4 bg-[#fafaf8]">
          <p className="text-xs font-semibold text-[#3d3b35] mb-3 flex items-center gap-1.5">
            <FileText size={12} className="text-[#2e9f82]" />
            Tenant Documents
          </p>
          {docsLoading ? (
            <p className="flex items-center gap-1.5 text-xs text-[#9b9890]"><Loader2 size={11} className="animate-spin" /> Loading documents…</p>
          ) : !tenantDocs || tenantDocs.length === 0 ? (
            <p className="text-xs text-[#9b9890]">No documents uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              {tenantDocs.map(doc => (
                <div key={doc.id} className="flex items-center gap-3 bg-white rounded-xl border border-[#e8e6e0] px-3 py-2.5">
                  <FileText size={14} className="text-[#2e9f82] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#1a1916] truncate">{doc.displayName ?? doc.documentKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                    <p className="text-[10px] text-[#9b9890] mt-0.5 capitalize">{doc.status}</p>
                  </div>
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium text-[#2e9f82] hover:underline"
                  >
                    View <ExternalLink size={10} />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<ApiLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState<'all' | LeadStage>('all');
  const [movingLead, setMovingLead] = useState<number | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/leads', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load leads (${res.status})`);
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  async function moveStage(leadId: number, stage: LeadStage) {
    setMovingLead(leadId);
    try {
      await fetch(`/api/leads/${leadId}/stage`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage } : l));
    } finally {
      setMovingLead(null);
    }
  }

  const filtered = leads.filter(l => {
    if (filterStage !== 'all' && l.stage !== filterStage) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = l.convertedTenant?.user?.name ?? l.customerName;
      const unit = l.unit?.unitName ?? l.unit?.unitNumber ?? '';
      const building = l.unit?.property?.buildingName ?? '';
      const email = (l.leadEmail ?? l.convertedTenant?.user?.email ?? '').toLowerCase();
      const phone = (l.leadPhone ?? '').toLowerCase();
      if (![name, unit, building, email, phone].some(f => f.includes(q))) return false;
    }
    return true;
  });

  const countByStage = (s: LeadStage) => leads.filter(l => l.stage === s).length;

  function handleConvert(lead: ApiLead) {
    const name = encodeURIComponent(lead.convertedTenant?.user?.name ?? lead.customerName ?? '');
    // Use the earliest desiredMoveIn from any viewing on this lead
    const moveIn = lead.viewings?.find(v => v.desiredMoveIn)?.desiredMoveIn ?? '';
    const startParam = moveIn ? `&startDate=${moveIn}` : '';
    router.push(`/rental-provider/dashboard/contracts/new?unitId=${lead.unit?.id}&tenantId=${lead.convertedTenant?.id}&leadId=${lead.id}&tenantName=${name}${startParam}`);
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Leads & Inquiries</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">{leads.length} total lead{leads.length !== 1 ? 's' : ''} · Track your rental pipeline.</p>
        </div>
        <button onClick={fetchLeads} disabled={loading} className="flex items-center gap-2 text-sm text-[#2e9f82] border border-[#2e9f82] rounded-xl px-4 py-2 hover:bg-[#f0fdf4] transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Stage filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setFilterStage('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${filterStage === 'all' ? 'bg-[#1a1916] text-white border-transparent' : 'border-[#e8e6e0] bg-white text-[#6b6860] hover:bg-[#f4f3f0]'}`}
        >
          All <span className="ml-1 opacity-70">{leads.length}</span>
        </button>
        {STAGE_ORDER.map(s => (
          <button
            key={s}
            onClick={() => setFilterStage(filterStage === s ? 'all' : s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${filterStage === s ? STAGE_PILL[s] + ' border-transparent' : 'border-[#e8e6e0] bg-white text-[#6b6860] hover:bg-[#f4f3f0]'}`}
          >
            {STAGE_LABELS[s]} <span className="ml-1 opacity-70">{countByStage(s)}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input
            type="text"
            placeholder="Search by name, email, phone, unit…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#2e9f82] bg-white"
          />
        </div>
        {(filterStage !== 'all' || search) && (
          <button onClick={() => { setFilterStage('all'); setSearch(''); }} className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1">
            <X size={12} /> Reset filters
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl h-20 animate-pulse shadow-sm border border-[#f0ede8]" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && leads.length === 0 && (
        <div className="bg-white rounded-2xl p-16 shadow-sm flex flex-col items-center text-center border border-[#f0ede8]">
          <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
            <User size={24} className="text-[#2e9f82]" />
          </div>
          <h3 className="font-semibold text-[#1a1916] mb-1">No leads yet</h3>
          <p className="text-sm text-[#6b6860] max-w-xs">Leads appear when tenants book viewings on your listed units.</p>
        </div>
      )}

      {/* No results after filter */}
      {!loading && leads.length > 0 && filtered.length === 0 && (
        <div className="bg-white rounded-2xl p-10 shadow-sm flex flex-col items-center text-center border border-[#f0ede8]">
          <p className="text-sm text-[#6b6860]">No leads match your search or filter.</p>
          <button onClick={() => { setFilterStage('all'); setSearch(''); }} className="mt-3 text-xs text-[#2e9f82] font-medium hover:underline">Clear filters</button>
        </div>
      )}

      {/* Lead list */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map(lead => (
            <LeadRow
              key={lead.id}
              lead={lead}
              onMoveStage={moveStage}
              moving={movingLead === lead.id}
              onConvert={handleConvert}
              setLeads={setLeads}
            />
          ))}
        </div>
      )}
    </div>
  );
}

