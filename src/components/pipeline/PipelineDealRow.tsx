'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * PipelineDealRow — dense, scannable single-row layout.
 *
 * Design rules:
 *  - Two lines only: identity + context. No inline progress bar (lives in
 *    the drawer where it has room to breathe).
 *  - Coloured left-edge bar = stage at a glance. The eye picks up "this is
 *    a viewing" / "this is a contract" without reading text.
 *  - Right edge is reserved for the SINGLE most relevant pill (stage label
 *    or contract ref). Actions appear on hover, not permanently.
 *  - Everything truncates cleanly. Long names, long emails, long buildings
 *    — never wraps to a third line.
 */

import {
  Phone, Mail, ArrowRight, Clock, FileText,
  CreditCard, ChevronRight,
} from 'lucide-react';
import {
  Deal,
  PIPELINE_STAGE_LABEL,
  PipelineStage,
} from './types';

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
}

function fmtTime(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE });
}

function fmtMoney(fils: number | null): string {
  if (fils == null) return '';
  const aed = fils / 100;
  if (aed >= 1000) return `AED ${(aed / 1000).toFixed(aed % 1000 === 0 ? 0 : 1)}k`;
  return `AED ${aed.toLocaleString('en-AE')}`;
}

/** Stage → coloured left-edge bar + dot inside the chip */
const STAGE_BAR: Record<PipelineStage, { bar: string; dot: string; chipBg: string; chipText: string }> = {
  interest:        { bar: 'bg-[#3b82f6]', dot: 'bg-[#3b82f6]', chipBg: 'bg-[#eff6ff]', chipText: 'text-[#1e40af]' },
  viewing:         { bar: 'bg-[#f59e0b]', dot: 'bg-[#f59e0b]', chipBg: 'bg-[#fffbeb]', chipText: 'text-[#92400e]' },
  documents:       { bar: 'bg-[#f97316]', dot: 'bg-[#f97316]', chipBg: 'bg-[#fff7ed]', chipText: 'text-[#c2410c]' },
  plan:            { bar: 'bg-[#0ea5e9]', dot: 'bg-[#0ea5e9]', chipBg: 'bg-[#f0f9ff]', chipText: 'text-[#0369a1]' },
  cheques:         { bar: 'bg-[#eab308]', dot: 'bg-[#eab308]', chipBg: 'bg-[#fefce8]', chipText: 'text-[#854d0e]' },
  contract_issued: { bar: 'bg-[#8b5cf6]', dot: 'bg-[#8b5cf6]', chipBg: 'bg-[#f5f3ff]', chipText: 'text-[#5b21b6]' },
  active:          { bar: 'bg-[#10b981]', dot: 'bg-[#10b981]', chipBg: 'bg-[#ecfdf5]', chipText: 'text-[#065f46]' },
  closed_lost:     { bar: 'bg-[#9ca3af]', dot: 'bg-[#9ca3af]', chipBg: 'bg-[#f3f4f6]', chipText: 'text-[#4b5563]' },
};

/** Return the single highest-priority context chip for this stage */
function contextChip(deal: Deal): { icon: typeof Clock; text: string; tone: string } | null {
  switch (deal.pipelineStage) {
    case 'viewing':
      return deal.viewingAt
        ? { icon: Clock, text: fmtTime(deal.viewingAt), tone: 'text-[#92400e]' }
        : null;
    case 'documents':
      if (deal.docsPending != null && deal.docsPending > 0) {
        return { icon: FileText, text: `${deal.docsPending} pending`, tone: 'text-[#c2410c]' };
      }
      if (deal.docsTotal) {
        return { icon: FileText, text: `${deal.docsTotal} ready`, tone: 'text-[#16a34a]' };
      }
      return null;
    case 'cheques':
      return deal.planChequeCount
        ? { icon: CreditCard, text: `${deal.planChequeCount} cheques`, tone: 'text-[#854d0e]' }
        : null;
    case 'plan':
      return deal.planChequeCount
        ? { icon: CreditCard, text: `${deal.planChequeCount}-cheque plan`, tone: 'text-[#0369a1]' }
        : null;
    case 'contract_issued':
    case 'active':
      if (deal.contractEnd) {
        const end = new Date(deal.contractEnd).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: '2-digit' });
        return { icon: Clock, text: `→ ${end}`, tone: 'text-[#5b21b6]' };
      }
      return null;
    default:
      return null;
  }
}

function primaryActionFor(deal: Deal): { label: string; key: string } | null {
  switch (deal.pipelineStage) {
    case 'interest':        return { label: 'Contact',    key: 'mark-contacted' };
    case 'viewing':         return { label: 'Visited',    key: 'mark-visited' };
    case 'documents':       return { label: 'Review',     key: 'review-docs' };
    case 'plan':            return { label: 'Open plan',  key: 'review-plan' };
    case 'cheques':         return { label: 'Record',     key: 'record-cheques' };
    case 'contract_issued': return { label: 'Contract',   key: 'open-contract' };
    case 'active':          return null;
    case 'closed_lost':     return { label: 'Reopen',     key: 'reopen' };
    default:                return null;
  }
}

interface Props {
  deal: Deal;
  onOpen: (deal: Deal) => void;
  onPrimary?: (deal: Deal, actionKey: string) => void;
}

export function PipelineDealRow({ deal, onOpen, onPrimary }: Props) {
  const stageStyle = STAGE_BAR[deal.pipelineStage];
  const ctx        = contextChip(deal);
  const action     = primaryActionFor(deal);
  const Icon       = ctx?.icon;

  return (
    <div
      onClick={() => onOpen(deal)}
      className="group relative bg-white border-b border-[#f0ede8] hover:bg-[#fafaf8] transition-colors cursor-pointer"
    >
      {/* Coloured left-edge bar — primary visual cue for stage */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${stageStyle.bar}`} />

      <div className="pl-4 pr-3 py-2.5 flex items-center gap-3">

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-[#f0ede8] text-[#3d3b35] flex items-center justify-center text-[10px] font-bold shrink-0">
          {initials(deal.customerName)}
        </div>

        {/* Identity column */}
        <div className="flex-1 min-w-0">

          {/* Line 1 — name + contract ref */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-[#1a1916] truncate">
              {deal.customerName}
            </span>
            {deal.contractRef && (
              <span className="text-[10px] font-mono text-[#9b9890] truncate shrink-0">
                {deal.contractRef}
              </span>
            )}
          </div>

          {/* Line 2 — unit · rent · context */}
          <div className="flex items-center gap-2 text-[11px] text-[#6b6860] mt-0.5">
            <span className="truncate">
              {deal.buildingName ? `${deal.buildingName} · ${deal.unitLabel}` : deal.unitLabel}
            </span>
            {deal.rentFils && (
              <>
                <span className="text-[#d4d0c8]">·</span>
                <span className="text-[#1a1916] font-medium shrink-0">{fmtMoney(deal.rentFils)}/yr</span>
              </>
            )}
            {ctx && Icon && (
              <>
                <span className="text-[#d4d0c8]">·</span>
                <span className={`flex items-center gap-1 ${ctx.tone} shrink-0`}>
                  <Icon size={10} />
                  {ctx.text}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Hidden contact strip (visible on hover) */}
        <div className="hidden lg:flex opacity-0 group-hover:opacity-100 transition-opacity items-center gap-2 text-[11px] text-[#9b9890] shrink-0">
          {deal.customerPhone && (
            <a
              href={`tel:${deal.customerPhone}`}
              onClick={e => e.stopPropagation()}
              className="hover:text-[#2e9f82]"
              title={deal.customerPhone}
            >
              <Phone size={12} />
            </a>
          )}
          {deal.customerEmail && (
            <a
              href={`mailto:${deal.customerEmail}`}
              onClick={e => e.stopPropagation()}
              className="hover:text-[#2e9f82]"
              title={deal.customerEmail}
            >
              <Mail size={12} />
            </a>
          )}
        </div>

        {/* Stage chip */}
        <span className={`shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${stageStyle.chipBg} ${stageStyle.chipText}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${stageStyle.dot}`} />
          {PIPELINE_STAGE_LABEL[deal.pipelineStage]}
        </span>

        {/* Primary action — hover-revealed */}
        {action ? (
          <button
            onClick={e => { e.stopPropagation(); onPrimary?.(deal, action.key); }}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-medium text-[#1a1916] bg-white border border-[#d4d0c8] rounded-md px-2 py-1 hover:bg-[#f0ede8] flex items-center gap-1 cursor-pointer"
          >
            {action.label}
            <ArrowRight size={10} />
          </button>
        ) : (
          <div className="w-6" />
        )}

        <ChevronRight size={14} className="text-[#c8c6c0] shrink-0" />
      </div>
    </div>
  );
}
