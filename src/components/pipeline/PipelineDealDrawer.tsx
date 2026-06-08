'use client';

/**
 * PipelineDealDrawer — right-side panel showing the full journey for one Deal.
 *
 * Renders the 8-step journey identical to the customer-facing /spaces/v2
 * view so RP and customer share the same mental model. Each step shows
 * complete/in-progress/upcoming status, and the active step exposes the
 * primary action plus links into the existing detail pages (leads, contract).
 */

import { useEffect } from 'react';
import {
  X, Phone, Mail, Building2, CheckCircle2, Circle, Clock,
  CreditCard, FileText, FileSignature, Sparkles, ExternalLink,
  ArrowRight, AlertCircle,
} from 'lucide-react';
import {
  Deal,
  PIPELINE_STAGE_LABEL,
  PIPELINE_STAGE_ORDER,
  PIPELINE_STAGE_PROGRESS,
  PipelineStage,
} from './types';

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
}

function fmtMoney(fils: number | null): string {
  if (fils == null) return '—';
  return `AED ${(fils / 100).toLocaleString('en-AE')}`;
}

interface StepDef {
  stage: PipelineStage;
  icon: typeof CheckCircle2;
  description: string;
}

const STEPS: StepDef[] = [
  { stage: 'interest',        icon: Sparkles,       description: 'Customer registered interest in the unit.' },
  { stage: 'viewing',         icon: Clock,          description: 'Property viewing scheduled with the customer.' },
  { stage: 'documents',       icon: FileText,       description: 'Collecting KYC and financial documents.' },
  { stage: 'plan',            icon: CreditCard,     description: 'Payment plan shared and under review by the customer.' },
  { stage: 'cheques',         icon: CreditCard,     description: 'Customer is submitting cheques / payments for collection.' },
  { stage: 'contract_issued', icon: FileSignature,  description: 'Contract issued — awaiting signature and Ejari registration.' },
  { stage: 'active',          icon: CheckCircle2,   description: 'Tenant has moved in. Contract is active.' },
];

function stepStatus(stepIdx: number, currentStage: PipelineStage): 'complete' | 'current' | 'upcoming' | 'lost' {
  if (currentStage === 'closed_lost') return stepIdx === 0 ? 'lost' : 'upcoming';
  const currentIdx = PIPELINE_STAGE_ORDER.indexOf(currentStage);
  if (stepIdx < currentIdx) return 'complete';
  if (stepIdx === currentIdx) return 'current';
  return 'upcoming';
}

interface Props {
  deal: Deal | null;
  onClose: () => void;
  onPrimary?: (deal: Deal, actionKey: string) => void;
}

export function PipelineDealDrawer({ deal, onClose, onPrimary }: Props) {

  // Close on Escape
  useEffect(() => {
    if (!deal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deal, onClose]);

  if (!deal) return null;

  const progress = PIPELINE_STAGE_PROGRESS[deal.pipelineStage];
  const isLost   = deal.pipelineStage === 'closed_lost';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 z-40 animate-in fade-in"
      />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 bottom-0 w-full max-w-[560px] bg-white z-50 shadow-2xl flex flex-col">

        {/* Header */}
        <div className="border-b border-[#ede9e3] p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#d8f2e8] to-[#a7f3d0] text-[#1a7a5a] flex items-center justify-center text-sm font-bold shrink-0">
                {initials(deal.customerName)}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-[#1a1916] truncate">{deal.customerName}</h2>
                <p className="text-xs text-[#9b9890] flex items-center gap-1 truncate">
                  <Building2 size={11} />
                  {deal.buildingName ?? '—'} · {deal.unitLabel}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[#f4f3ef] flex items-center justify-center text-[#6b6860] cursor-pointer shrink-0"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Contact + finance row */}
          <div className="flex items-center flex-wrap gap-3 text-xs text-[#6b6860] mb-3">
            {deal.customerPhone && (
              <a href={`tel:${deal.customerPhone}`} className="flex items-center gap-1 hover:text-[#2e9f82]">
                <Phone size={11} /> {deal.customerPhone}
              </a>
            )}
            {deal.customerEmail && (
              <a href={`mailto:${deal.customerEmail}`} className="flex items-center gap-1 hover:text-[#2e9f82] truncate">
                <Mail size={11} /> <span className="truncate">{deal.customerEmail}</span>
              </a>
            )}
            {deal.rentFils && (
              <span className="text-[#1a1916] font-semibold">{fmtMoney(deal.rentFils)}/yr</span>
            )}
          </div>

          {/* Stage banner */}
          <div className="bg-[#fafaf8] border border-[#ede9e3] rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890]">
                Current stage
              </span>
              <span className="text-[10px] font-bold text-[#1a7a5a]">{progress}%</span>
            </div>
            <p className="text-sm font-semibold text-[#1a1916] mb-2">
              {PIPELINE_STAGE_LABEL[deal.pipelineStage]}
            </p>
            <div className="h-1.5 bg-[#f0ede8] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isLost ? 'bg-[#fca5a5]'
                  : deal.pipelineStage === 'active' ? 'bg-[#10b981]'
                  : 'bg-[#2e9f82]'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Journey timeline */}
        <div className="flex-1 overflow-y-auto p-5">

          {isLost && (
            <div className="mb-4 flex items-start gap-2 bg-[#fee2e2] border border-[#fecaca] rounded-xl p-3 text-xs text-[#991b1b]">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">This deal is closed</p>
                <p>The customer did not proceed. Reopen if circumstances change.</p>
              </div>
            </div>
          )}

          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890] mb-3">
            Journey
          </h3>

          <div className="relative space-y-3">
            {/* Vertical line behind icons */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-[#ede9e3]" aria-hidden="true" />

            {STEPS.map((step, idx) => {
              const status = stepStatus(idx, deal.pipelineStage);
              const Icon = step.icon;
              return (
                <div key={step.stage} className="relative flex items-start gap-3">
                  <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    status === 'complete' ? 'bg-[#10b981] text-white'
                    : status === 'current'  ? 'bg-[#2e9f82] text-white ring-4 ring-[#d8f2e8]'
                    : status === 'lost'     ? 'bg-[#ef4444] text-white'
                    : 'bg-white border-2 border-[#ede9e3] text-[#c8c6c0]'
                  }`}>
                    {status === 'complete' ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                  </div>
                  <div className="flex-1 pb-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-semibold ${
                        status === 'upcoming' ? 'text-[#c8c6c0]' : 'text-[#1a1916]'
                      }`}>
                        {PIPELINE_STAGE_LABEL[step.stage]}
                      </p>
                      {status === 'current' && (
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-[#2e9f82] text-white px-1.5 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 ${
                      status === 'upcoming' ? 'text-[#c8c6c0]' : 'text-[#6b6860]'
                    }`}>
                      {step.description}
                    </p>
                    {status === 'current' && (
                      <StageDetail deal={deal} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer — actions */}
        <div className="border-t border-[#ede9e3] p-4 bg-white flex items-center gap-2">
          {deal.leadId && (
            <a
              href={`/rental-provider/dashboard/leads`}
              className="flex-1 text-center text-xs font-medium text-[#6b6860] border border-[#e8e6e0] rounded-lg py-2 hover:bg-[#f4f3ef]"
            >
              Open in Leads
            </a>
          )}
          {deal.contractId && (
            <a
              href={`/rental-provider/dashboard/contracts/${deal.contractId}/v2`}
              className="flex-1 text-center text-xs font-medium text-[#1a1916] border border-[#1a1916] rounded-lg py-2 hover:bg-[#f4f3ef] flex items-center justify-center gap-1"
            >
              Open contract <ExternalLink size={11} />
            </a>
          )}
          {!deal.contractId && deal.leadId && deal.pipelineStage === 'cheques' && (
            <a
              href={`/rental-provider/dashboard/contracts/new?leadId=${deal.leadId}`}
              className="flex-1 text-center text-xs font-medium text-white bg-[#2e9f82] rounded-lg py-2 hover:bg-[#268a72] flex items-center justify-center gap-1"
            >
              Issue contract <ArrowRight size={11} />
            </a>
          )}
        </div>
      </aside>
    </>
  );
}

/* ─── Inline panel showing actionable detail for the CURRENT stage ──── */

function StageDetail({ deal }: { deal: Deal }) {

  if (deal.pipelineStage === 'viewing' && deal.viewingAt) {
    return (
      <div className="mt-2 bg-[#fef3c7] border border-[#fde68a] rounded-lg p-2.5 text-xs text-[#854d0e]">
        <p className="font-semibold mb-0.5 flex items-center gap-1">
          <Clock size={11} />
          {deal.viewingAt.toLocaleString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}
        </p>
        <p>Status: <strong className="capitalize">{deal.viewingStatus ?? 'scheduled'}</strong></p>
      </div>
    );
  }

  if (deal.pipelineStage === 'documents' && deal.docsTotal != null) {
    const pending = deal.docsPending ?? 0;
    return (
      <div className="mt-2 bg-[#fff7ed] border border-[#fed7aa] rounded-lg p-2.5 text-xs text-[#c2410c]">
        <p className="font-semibold mb-0.5 flex items-center gap-1">
          <FileText size={11} />
          {pending > 0
            ? `${pending} of ${deal.docsTotal} documents pending`
            : `All ${deal.docsTotal} documents uploaded`}
        </p>
        <p>{pending > 0 ? 'Review uploaded documents to proceed.' : 'Ready to share payment plan.'}</p>
      </div>
    );
  }

  if (deal.pipelineStage === 'plan' && deal.planChequeCount) {
    return (
      <div className="mt-2 bg-[#f0f9ff] border border-[#bae6fd] rounded-lg p-2.5 text-xs text-[#0369a1]">
        <p className="font-semibold mb-0.5 flex items-center gap-1">
          <CreditCard size={11} />
          {deal.planChequeCount} cheque payment plan shared
        </p>
        <p>Awaiting customer confirmation.</p>
      </div>
    );
  }

  if (deal.pipelineStage === 'cheques') {
    return (
      <div className="mt-2 bg-[#fef9c3] border border-[#fde68a] rounded-lg p-2.5 text-xs text-[#854d0e]">
        <p className="font-semibold mb-0.5 flex items-center gap-1">
          <CreditCard size={11} />
          {deal.planChequeCount ?? 0} cheques to collect
        </p>
        <p>Record each cheque as you receive it. When all are in hand, issue the contract.</p>
      </div>
    );
  }

  if (deal.pipelineStage === 'contract_issued' && deal.contractRef) {
    return (
      <div className="mt-2 bg-[#d1fae5] border border-[#a7f3d0] rounded-lg p-2.5 text-xs text-[#065f46]">
        <p className="font-semibold mb-0.5 flex items-center gap-1">
          <FileSignature size={11} />
          Contract {deal.contractRef}
        </p>
        <p>
          {deal.contractStart && deal.contractEnd
            ? `${new Date(deal.contractStart).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' })} → ${new Date(deal.contractEnd).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' })}`
            : 'Awaiting signature.'}
        </p>
      </div>
    );
  }

  if (deal.pipelineStage === 'active' && deal.contractRef) {
    return (
      <div className="mt-2 bg-[#d8f2e8] border border-[#a7f3d0] rounded-lg p-2.5 text-xs text-[#1a7a5a]">
        <p className="font-semibold flex items-center gap-1">
          <CheckCircle2 size={11} />
          Active tenant · {deal.contractRef}
        </p>
      </div>
    );
  }

  return null;
}

// Keep tree-shaker happy
void Circle;
