/**
 * Pipeline types — unifies leads and contracts into a single "Deal" model.
 *
 * Each customer × unit relationship is one Deal, regardless of whether it's
 * still in the lead-stage funnel or has progressed to a signed contract.
 * The frontend Pipeline page renders one row per Deal, with the current
 * pipelineStage driving the colour-coded badge and primary action.
 */

export type PipelineStage =
  | 'interest'
  | 'viewing'
  | 'documents'
  | 'plan'
  | 'cheques'
  | 'contract_issued'
  | 'active'
  | 'closed_lost';

export const PIPELINE_STAGE_LABEL: Record<PipelineStage, string> = {
  interest:        'Interest',
  viewing:         'Viewing',
  documents:       'Documents',
  plan:            'Plan',
  cheques:         'Cheques',
  contract_issued: 'Contract',
  active:          'Active',
  closed_lost:     'Closed lost',
};

export const PIPELINE_STAGE_CHIP: Record<PipelineStage, string> = {
  interest:        'bg-[#dbeafe] text-[#1e40af] border-[#bfdbfe]',
  viewing:         'bg-[#fef3c7] text-[#92400e] border-[#fde68a]',
  documents:       'bg-[#fff7ed] text-[#c2410c] border-[#fed7aa]',
  plan:            'bg-[#f0f9ff] text-[#0369a1] border-[#bae6fd]',
  cheques:         'bg-[#fef9c3] text-[#854d0e] border-[#fde68a]',
  contract_issued: 'bg-[#d1fae5] text-[#065f46] border-[#a7f3d0]',
  active:          'bg-[#d8f2e8] text-[#1a7a5a] border-[#a7f3d0]',
  closed_lost:     'bg-[#fee2e2] text-[#b91c1c] border-[#fecaca]',
};

/** Stage progress as a percentage — used by the progress bar on each row */
export const PIPELINE_STAGE_PROGRESS: Record<PipelineStage, number> = {
  interest:        10,
  viewing:         25,
  documents:       40,
  plan:            55,
  cheques:         70,
  contract_issued: 85,
  active:          100,
  closed_lost:     0,
};

/** Order used by the stage filter chip row */
export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  'interest', 'viewing', 'documents', 'plan',
  'cheques', 'contract_issued', 'active', 'closed_lost',
];

/** Map a raw lead.stage to its pipeline stage bucket */
export function leadStageToPipeline(stage: string): PipelineStage {
  switch (stage) {
    case 'new':
    case 'contacted':
      return 'interest';
    case 'viewing_scheduled':
      return 'viewing';
    case 'documents_collection':
    case 'interested':
    case 'offer_made':
    case 'applied':
    case 'approved':
      return 'documents';
    case 'payment_plan_shared':
      return 'plan';
    case 'cheques_submitted':
    case 'cheques_collected':
      return 'cheques';
    case 'contract_issued':
      return 'contract_issued';
    case 'converted':
      return 'active';
    case 'rejected':
      return 'closed_lost';
    default:
      return 'interest';
  }
}

/** Map a raw contract.status to a pipeline stage bucket */
export function contractStatusToPipeline(status: string): PipelineStage {
  switch (status) {
    case 'pending':
    case 'issued':
      return 'contract_issued';
    case 'active':
      return 'active';
    case 'expired':
    case 'terminated':
      return 'closed_lost';
    default:
      return 'contract_issued';
  }
}

/** Unified row item — every list row is one of these */
export interface Deal {
  /** Composite id — `lead-123` or `contract-456`; stable for React keys */
  id: string;
  kind: 'lead' | 'contract';
  pipelineStage: PipelineStage;

  // Customer
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;

  // Unit / property
  unitLabel: string;
  unitId: number | null;
  buildingName: string | null;
  rentFils: number | null;

  // Stage detail — only some are populated depending on stage
  viewingAt: Date | null;
  viewingStatus: string | null;
  docsPending: number | null;
  docsTotal: number | null;
  planChequeCount: number | null;
  chequesCollected: number | null;
  chequesTotal: number | null;

  contractRef: string | null;
  contractId: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  ejariStatus: string | null;

  // Source
  leadId: number | null;
  rawLead: unknown | null;       // for drawer detail view
  rawContract: unknown | null;
  updatedAt: Date;
}
