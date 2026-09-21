/**
 * Legal & Breach Management — shared types, labels and API helpers for every
 * surface (contract Breaches section, Disputes list/detail, Operations boards,
 * badges, dashboard alerts, admin jurisdiction settings).
 *
 * Base-aware like AMC / Vendors: the landlord calls `/legal/*`, a manager
 * calls `/manager/legal/*?rp=<id>` (permission `canManageLegal`). Build every
 * path through `legalUrl(base, rp, path)` so the mirror stays one line.
 *
 * Labels mirror the backend (spec §6). The UI never shows a raw enum.
 */
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from '@/lib/api';

/* ── enums ─────────────────────────────────────────────────────────────────── */
export type BreachStage = 'reported' | 'warning_sent' | 'final_warning' | 'resolved' | 'escalated';
export type BreachCategory =
  | 'noise' | 'overstaying' | 'unauthorized_occupants' | 'conflict_with_neighbours' | 'unauthorized_subletting'
  | 'property_misuse' | 'damage' | 'house_rules' | 'other';
export type BreachReportedBy = 'staff' | 'neighbour' | 'security' | 'other';
export type BreachEventType = 'reported' | 'warning' | 'final_warning' | 'customer_response' | 'inspection' | 'resolved' | 'escalated' | 'note';

export type DisputeStage = 'notice_sent' | 'case_filed' | 'settlement' | 'decision' | 'enforcement' | 'closed';
export type DisputeType = 'non_payment' | 'breach' | 'overstaying' | 'eviction' | 'rent_increase' | 'deposit' | 'maintenance' | 'early_termination' | 'other';
export type DisputeFiledBy = 'landlord' | 'customer';
export type NoticeType = 'payment_demand' | 'breach_remedy' | 'non_renewal' | 'renewal_terms_change' | 'none';
export type DisputeOutcome = 'settled' | 'won' | 'lost' | 'withdrawn';
export type CaseEventType = 'notice' | 'filed' | 'hearing' | 'settlement_agreed' | 'decision' | 'appeal' | 'enforcement_action' | 'resolved' | 'note';
export type PaymentHeldBy = 'authority' | 'landlord' | 'representative';

export const BREACH_STAGES: BreachStage[] = ['reported', 'warning_sent', 'final_warning', 'resolved', 'escalated'];
export const DISPUTE_STAGES: DisputeStage[] = ['notice_sent', 'case_filed', 'settlement', 'decision', 'enforcement', 'closed'];
/** Open stages — the lease is "in legal" and shows on the Legal tab only. */
export const LEGAL_OPEN_STAGES: DisputeStage[] = ['notice_sent', 'case_filed', 'settlement', 'decision', 'enforcement'];

/* ── labels (spec §6) ──────────────────────────────────────────────────────── */
export const BREACH_STAGE_LABELS: Record<BreachStage, string> = {
  reported: 'Reported', warning_sent: 'Warning issued', final_warning: 'Final warning', resolved: 'Resolved', escalated: 'Escalated to legal',
};
export const BREACH_CATEGORY_LABELS: Record<BreachCategory, string> = {
  noise: 'Noise', overstaying: 'Overstaying', unauthorized_occupants: 'Extra occupants', conflict_with_neighbours: 'Conflict with neighbours',
  unauthorized_subletting: 'Subletting', property_misuse: 'Misuse of property', damage: 'Damage', house_rules: 'House rules', other: 'Other',
};
export const BREACH_REPORTED_BY_LABELS: Record<BreachReportedBy, string> = { staff: 'Staff', neighbour: 'Neighbour', security: 'Security', other: 'Other' };
export const DISPUTE_STAGE_LABELS: Record<DisputeStage, string> = {
  notice_sent: 'Notice sent', case_filed: 'Case filed', settlement: 'Settlement talks', decision: 'Decision received', enforcement: 'Enforcing decision', closed: 'Closed',
};
export const DISPUTE_TYPE_LABELS: Record<DisputeType, string> = {
  non_payment: 'Unpaid rent', breach: 'Breach of agreement', overstaying: 'Overstaying', eviction: 'Eviction', rent_increase: 'Rent increase',
  deposit: 'Deposit', maintenance: 'Maintenance', early_termination: 'Early termination', other: 'Other',
};
export const NOTICE_TYPE_LABELS: Record<NoticeType, string> = {
  payment_demand: 'Payment reminder (legal)', breach_remedy: 'Fix-it notice', non_renewal: 'Move-out notice', renewal_terms_change: 'Renewal terms notice', none: 'No notice',
};
export const DISPUTE_OUTCOME_LABELS: Record<DisputeOutcome, string> = {
  settled: 'Resolved by agreement', won: 'Decided in your favour', lost: 'Decided against you', withdrawn: 'Withdrawn',
};
export const PAYMENT_HELD_BY_LABELS: Record<PaymentHeldBy, string> = { authority: 'Held by authority', landlord: 'With landlord', representative: 'With representative' };
export const CASE_EVENT_TYPE_LABELS: Record<CaseEventType, string> = {
  notice: 'Notice', filed: 'Filed', hearing: 'Hearing', settlement_agreed: 'Settlement agreed', decision: 'Decision', appeal: 'Appeal',
  enforcement_action: 'Enforcement action', resolved: 'Resolved', note: 'Note',
};
export const BREACH_EVENT_TYPE_LABELS: Record<BreachEventType, string> = {
  reported: 'Reported', warning: 'Warning issued', final_warning: 'Final warning', customer_response: 'Customer response', inspection: 'Inspection',
  resolved: 'Resolved', escalated: 'Escalated to legal', note: 'Note',
};

/* ── shapes (what the API returns) ─────────────────────────────────────────── */
export interface LeaseSummary {
  id: number; status: string; startDate: string; endDate: string; annualRent: number | null; registrationNumber: string | null;
  customerName: string | null; customerUserId: number | null; unitId: number | null; unitNumber: string | null;
  /** The customer record and whether it is a company or a person. */
  customerId?: number | null; customerType?: string | null;
  propertyId: number | null; buildingName: string | null;
}
export interface LegalDoc { id: number; key: string; name: string; fileUrl: string; mimeType: string | null; category: string; createdAt: string }
/** One of the customer's own KYC papers, read live from the customer record. */
export interface CustomerKycDoc extends LegalDoc { documentNumber: string | null; expiryDate: string | null; expired: boolean }
export interface LegalAlert { key: string; text: string }

export interface BreachRow {
  id: number; leaseId: number; openedDate: string; category: BreachCategory; categoryLabel: string; description: string | null;
  reportedBy: BreachReportedBy; stage: BreachStage; stageLabel: string; warningSentDate: string | null; correctionDeadline: string | null;
  finalWarningDate: string | null; finalDeadline: string | null; resolvedDate: string | null; disputeId: number | null; notes: string | null;
  createdAt: string; updatedAt: string; hint: string; nextDate: string | null; alert: LegalAlert | null;
  actions: { issueWarning: boolean; issueFinalWarning: boolean; resolve: boolean; escalate: boolean };
  lease: LeaseSummary | null;
  /** Who acted last on the breach — the stakeholder holding it now. */
  handler?: string | null;
}
export interface BreachEvent {
  id: number; date: string; type: BreachEventType; description: string | null; documentId: number | null; document: LegalDoc | null;
  actorUserId: number | null; createdAt: string;
}
export interface BreachDetail extends BreachRow { correctionDays: number; events: BreachEvent[]; documents: LegalDoc[] }

export interface DisputeRow {
  id: number; leaseId: number; filedBy: DisputeFiledBy; filedByLabel: string; type: DisputeType; typeLabel: string;
  breachReasons: BreachCategory[]; breachReasonLabels: string[]; breachId: number | null; stage: DisputeStage; stageLabel: string;
  noticeType: NoticeType; noticeTypeLabel: string; noticeServedDate: string | null; noticeDeadline: string | null; noticeProofDocumentId: number | null;
  authorityCaseNumber: string | null; filingDate: string | null; nextHearingDate: string | null; decisionDate: string | null; appealDeadline: string | null;
  claimAmount: number | null; filingFee: number | null; contactName: string | null; contactPhone: string | null; outcome: DisputeOutcome | null;
  outcomeLabel: string | null; closedDate: string | null; notes: string | null; createdAt: string; updatedAt: string; inLegal: boolean;
  automationFrozen: boolean; hint: string; nextDate: string | null; alert: LegalAlert | null;
  actions: { resolve: boolean; nextStages: DisputeStage[] };
  lease: LeaseSummary | null;
  /** Who acted last on the case, and the named representative (lawyer), if any. */
  handler?: string | null; representative?: string | null;
  /** List rows carry the case's cost totals (0287) and how many fee-book lines are not recorded yet. */
  costTotals?: CostTotals;
  missingCostsCount?: number; missingCostsTotal?: number;
}
export interface CaseEvent {
  id: number; date: string; type: CaseEventType; description: string | null; amount: number | null; documentId: number | null;
  document: LegalDoc | null; actorUserId: number | null; createdAt: string;
}
export interface DisputePayment {
  id: number; description: string | null; amount: number; vatAmount: number; paymentType: string | null; paymentMethod: string | null;
  chequeNumber: string | null; transactionDate: string | null; chequeStatus: string; heldBy: PaymentHeldBy | null; heldByLabel: string | null;
  collectedByName: string | null; documentId: number | null;
}
/* ── Fee book + costs on a case (0287) ─────────────────────────────────────── */
export type FeeStage = 'any' | DisputeStage;
export type FeePayee = 'typist' | 'authority' | 'court_notary' | 'courier' | 'lawyer' | 'other';
export const FEE_PAYEE_LABELS: Record<FeePayee, string> = {
  typist: 'Typist', authority: 'Rental authority', court_notary: 'Court & notary', courier: 'Courier', lawyer: 'Lawyer', other: 'Other',
};
export const FEE_STAGE_LABELS: Record<FeeStage, string> = { any: 'Any stage', ...DISPUTE_STAGE_LABELS };
export interface FeeItem {
  id: number; stage: FeeStage; stageLabel: string; payee: FeePayee; payeeLabel: string; label: string;
  amount: number | null; percentOfRent: number | null; recoverable: boolean; sortOrder: number;
}
export interface FeeItemInput {
  id?: number; stage: FeeStage; payee: FeePayee; label: string; amount?: number | null; percentOfRent?: number | null; recoverable?: boolean; sortOrder?: number;
}
export interface CaseCost {
  id: number; feeItemId: number | null; stage: FeeStage; stageLabel: string; payee: FeePayee; payeeLabel: string; label: string;
  expectedAmount: number; actualAmount: number | null; status: 'expected' | 'paid'; paidOn: string | null; receiptDocumentId: number | null;
  recoverable: boolean; chargePaymentId: number | null; notes: string | null; createdAt: string;
}
export interface CostTotals { lines: number; expected: number; paid: number; recoverableCharged: number }
/** A fee-book line for a stage the case has reached that nobody recorded on the case. */
export interface MissingCost { feeItemId: number; stage: FeeStage; stageLabel: string; payee: FeePayee; payeeLabel: string; label: string; expectedAmount: number; recoverable: boolean }

/* ── Breach & Legal templates (0288) ───────────────────────────────────────── */
export type TemplateKind = 'breach_warning' | 'breach_final_warning' | 'notice_payment_demand' | 'notice_breach_remedy' | 'notice_non_renewal' | 'notice_renewal_terms_change' | 'custom';
export type TemplateGroup = 'breach' | 'legal';
export const TEMPLATE_GROUP_LABELS: Record<TemplateGroup, string> = { breach: 'Breach', legal: 'Legal' };
export const TEMPLATE_KINDS: TemplateKind[] = ['breach_warning', 'breach_final_warning', 'notice_payment_demand', 'notice_breach_remedy', 'notice_non_renewal', 'notice_renewal_terms_change'];
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  breach_warning: 'Warning letter', breach_final_warning: 'Final warning letter', notice_payment_demand: 'Payment reminder (legal)',
  notice_breach_remedy: 'Fix-it notice', notice_non_renewal: 'Move-out notice', notice_renewal_terms_change: 'Renewal terms notice', custom: 'Custom',
};
/** The notice template for a notice type; 'none' has no letter. */
export const NOTICE_TEMPLATE_KIND: Record<Exclude<NoticeType, 'none'>, TemplateKind> = {
  payment_demand: 'notice_payment_demand', breach_remedy: 'notice_breach_remedy', non_renewal: 'notice_non_renewal', renewal_terms_change: 'notice_renewal_terms_change',
};
export interface LegalTemplate {
  id: number; kind: TemplateKind; kindLabel: string; group: TemplateGroup; name: string; subject: string; body: string;
  /** own = the landlord's version of a fixed kind · platform = the starter · custom = the landlord's own extra template */
  source: 'own' | 'platform' | 'custom'; sortOrder: number; updatedAt: string;
}
export interface RenderedTemplate {
  id: number; kind: TemplateKind; kindLabel: string; group: TemplateGroup; source: 'own' | 'platform' | 'custom'; name: string; subject: string; body: string;
  values: { days: number; deadline: string; date: string; fields: Record<string, string> };
}
export interface RenderQuery { breachId?: number; disputeId?: number; leaseId?: number; date?: string; deadline?: string; days?: number; amount?: number; reasons?: string; contact?: string }

export interface DisputeDetail extends DisputeRow {
  config: { authorityDisplayName: string; mediationRequired: boolean; registrationRequiredToFile: boolean; appealWindowDays: number };
  noticeProofDocument: LegalDoc | null; events: CaseEvent[]; documents: LegalDoc[]; customerDocuments?: CustomerKycDoc[]; payments: DisputePayment[];
  bouncedSettlementOffer: 'enforcement' | null; breach: BreachDetail | null;
  costs: CaseCost[]; costTotals: CostTotals;
  missingCosts: MissingCost[]; missingCostsTotal: number;
}
export interface JurisdictionConfig {
  id: number; breachCorrectionDays: number; paymentCurePeriodDays: number; breachRemedyPeriodDays: number; renewalTermsNoticeDays: number;
  nonRenewalNoticeDays: number; appealWindowDays: number;
  filingFeeFormula: { percent_of_annual_rent?: number; min_fee?: number; max_fee?: number; flat_fee?: number };
  mediationRequired: boolean; registrationRequiredToFile: boolean; authorityDisplayName: string; updatedAt: string;
  /** 0286 — null on the platform default, the landlord's id on their own row. */
  rentalProviderId?: number | null;
  /** GET /legal/config only: whether the landlord is on their own set or the platform default. */
  source?: 'own' | 'platform';
}
export interface LeaseFlag { breach: { id: number; stage: BreachStage; label: string } | null; dispute: { id: number; stage: DisputeStage; label: string } | null }
export type LeaseFlags = Record<string, LeaseFlag>;
export interface ClaimSuggestion {
  leaseId: number; total: number;
  lines: { kind: 'settlement_balance' | 'bounced_cheque' | 'overdue_instalment'; label: string; amount: number; date: string | null; paymentId: number | null }[];
}
/** An open breach or case as the dashboard lists it — the unit and its last state. */
export interface OpenRecord {
  id: number; leaseId: number; unitNumber: string | null; buildingName: string | null; customerName: string | null;
  label: string; stage: string; stageLabel: string; nextDate: string | null;
}
export interface AlertItem { key: string; text: string; href: string; leaseId: number; customerName: string | null; unitNumber: string | null; date: string | null }

/* ── API ───────────────────────────────────────────────────────────────────── */
/** `base` = '/legal' (landlord) or '/manager/legal' (manager, with `rp`). */
export function legalUrl(base: string, rp: number | undefined, path: string, query: Record<string, string | number | undefined> = {}): string {
  const q = new URLSearchParams();
  if (rp != null) q.set('rp', String(rp));
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') q.set(k, String(v));
  const qs = q.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

export const legalApi = {
  config: (base: string, rp?: number) => apiGet<JurisdictionConfig>(legalUrl(base, rp, '/config')),
  /** Landlord: save their own periods / fee rule (created from the platform values the first time). */
  updateRpConfig: (body: Partial<Omit<JurisdictionConfig, 'id' | 'updatedAt'>>) => apiPatch<JurisdictionConfig>('/legal/config', body),
  /** Landlord: back to the platform default. */
  resetRpConfig: () => apiDelete<JurisdictionConfig>('/legal/config'),
  leaseFlags: (base: string, rp: number | undefined, leaseIds?: number[]) =>
    apiGet<LeaseFlags>(legalUrl(base, rp, '/lease-flags', { leaseIds: leaseIds?.length ? leaseIds.join(',') : undefined })),
  alerts: (base: string, rp?: number) => apiGet<{ items: AlertItem[]; counts: { breaches: number; disputes: number }; open?: { breaches: OpenRecord[]; cases: OpenRecord[] } }>(legalUrl(base, rp, '/alerts')),
  /** What the ledger says the customer owes — settlement balance, bounced cheques, overdue instalments. */
  claimSuggestion: (base: string, rp: number | undefined, leaseId: number) => apiGet<ClaimSuggestion>(legalUrl(base, rp, '/claim-suggestion', { leaseId })),

  breaches: (base: string, rp: number | undefined, q: { leaseId?: number; stage?: string; open?: boolean } = {}) =>
    apiGet<{ items: BreachRow[]; counts: Record<string, number> }>(legalUrl(base, rp, '/breaches', { leaseId: q.leaseId, stage: q.stage, open: q.open ? '1' : undefined })),
  breach: (base: string, rp: number | undefined, id: number) => apiGet<BreachDetail>(legalUrl(base, rp, `/breaches/${id}`)),
  reportBreach: (base: string, rp: number | undefined, body: { leaseId: number; category: BreachCategory; description?: string; reportedBy?: BreachReportedBy; openedDate?: string; documentId?: number | null }) =>
    apiPost<BreachDetail>(legalUrl(base, rp, '/breaches'), body),
  updateBreach: (base: string, rp: number | undefined, id: number, body: { notes?: string | null; description?: string | null }) =>
    apiPatch<BreachDetail>(legalUrl(base, rp, `/breaches/${id}`), body),
  breachWarning: (base: string, rp: number | undefined, id: number, body: { date?: string; description?: string | null; documentId?: number | null }) =>
    apiPost<BreachDetail>(legalUrl(base, rp, `/breaches/${id}/warning`), body),
  breachFinalWarning: (base: string, rp: number | undefined, id: number, body: { date?: string; description?: string | null; documentId?: number | null }) =>
    apiPost<BreachDetail>(legalUrl(base, rp, `/breaches/${id}/final-warning`), body),
  breachResolve: (base: string, rp: number | undefined, id: number, body: { date?: string; description?: string | null } = {}) =>
    apiPost<BreachDetail>(legalUrl(base, rp, `/breaches/${id}/resolve`), body),
  breachEscalate: (base: string, rp: number | undefined, id: number, body: { customerStillOccupying?: boolean; description?: string | null } = {}) =>
    apiPost<{ breach: BreachDetail; dispute: DisputeDetail }>(legalUrl(base, rp, `/breaches/${id}/escalate`), body),
  breachEvent: (base: string, rp: number | undefined, id: number, body: { type: 'customer_response' | 'inspection' | 'note'; date?: string; description?: string | null; documentId?: number | null }) =>
    apiPost<BreachDetail>(legalUrl(base, rp, `/breaches/${id}/events`), body),

  disputes: (base: string, rp: number | undefined, q: { leaseId?: number; stage?: string; type?: string; filedBy?: string; open?: boolean } = {}) =>
    apiGet<{ items: DisputeRow[]; counts: Record<string, number> }>(legalUrl(base, rp, '/disputes', { leaseId: q.leaseId, stage: q.stage, type: q.type, filedBy: q.filedBy, open: q.open ? '1' : undefined })),
  dispute: (base: string, rp: number | undefined, id: number) => apiGet<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}`)),
  caseFile: (base: string, rp: number | undefined, id: number) => apiGet<CaseFile>(legalUrl(base, rp, `/disputes/${id}/case-file`)),
  createDispute: (base: string, rp: number | undefined, body: CreateDisputeBody) => apiPost<DisputeDetail>(legalUrl(base, rp, '/disputes'), body),
  updateDispute: (base: string, rp: number | undefined, id: number, body: Partial<CreateDisputeBody> & { authorityCaseNumber?: string | null; filingDate?: string | null; nextHearingDate?: string | null; decisionDate?: string | null }) =>
    apiPatch<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}`), body),
  advanceDispute: (base: string, rp: number | undefined, id: number, body: AdvanceBody) => apiPost<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/advance`), body),
  resolveDispute: (base: string, rp: number | undefined, id: number, body: { date?: string; outcome?: DisputeOutcome; description?: string | null } = {}) =>
    apiPost<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/resolve`), body),
  caseEvent: (base: string, rp: number | undefined, id: number, body: { type: CaseEventType; date?: string; description?: string | null; amount?: number | null; documentId?: number | null }) =>
    apiPost<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/events`), body),
  linkPayment: (base: string, rp: number | undefined, id: number, body: { paymentId?: number; amount?: number; chequeNumber?: string | null; transactionDate?: string | null; description?: string | null; heldBy?: PaymentHeldBy | null; collectedByName?: string | null }) =>
    apiPost<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/payments`), body),
  updatePayment: (base: string, rp: number | undefined, id: number, paymentId: number, body: { chequeStatus?: 'pending' | 'cleared' | 'bounced' | 'cancelled'; heldBy?: PaymentHeldBy | null; collectedByName?: string | null }) =>
    apiPatch<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/payments/${paymentId}`), body),
  unlinkPayment: (base: string, rp: number | undefined, id: number, paymentId: number) =>
    apiDelete<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/payments/${paymentId}`)),

  // fee book (landlord edits; manager reads)
  feeBook: (base: string, rp?: number) => apiGet<{ source: 'own' | 'platform'; items: FeeItem[] }>(legalUrl(base, rp, '/fee-book')),
  saveFeeBook: (items: FeeItemInput[]) => apiPut<{ source: 'own' | 'platform'; items: FeeItem[] }>('/legal/fee-book', { items }),
  resetFeeBook: () => apiDelete<{ source: 'own' | 'platform'; items: FeeItem[] }>('/legal/fee-book'),
  // costs on a case
  addCosts: (base: string, rp: number | undefined, id: number, body: { feeItemIds?: number[]; custom?: FeeItemInput }) =>
    apiPost<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/costs`), body),
  updateCost: (base: string, rp: number | undefined, id: number, costId: number, body: { label?: string; payee?: FeePayee; expectedAmount?: number; actualAmount?: number | null; paidOn?: string | null; receiptDocumentId?: number | null; recoverable?: boolean; notes?: string | null }) =>
    apiPatch<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/costs/${costId}`), body),
  markCostPaid: (base: string, rp: number | undefined, id: number, costId: number, body: { actualAmount?: number; paidOn?: string; receiptDocumentId?: number | null }) =>
    apiPost<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/costs/${costId}/paid`), body),
  deleteCost: (base: string, rp: number | undefined, id: number, costId: number) => apiDelete<DisputeDetail>(legalUrl(base, rp, `/disputes/${id}/costs/${costId}`)),

  // templates (landlord edits; manager reads + renders)
  templates: (base: string, rp?: number) => apiGet<{ fields: string[]; items: LegalTemplate[] }>(legalUrl(base, rp, '/templates')),
  saveTemplate: (kind: TemplateKind, body: { name: string; subject: string; body: string }) => apiPut<LegalTemplate>(`/legal/templates/${kind}`, body),
  resetTemplate: (kind: TemplateKind) => apiDelete<LegalTemplate | null>(`/legal/templates/${kind}`),
  /** The landlord's own extra template on a tab (any number). */
  createTemplate: (body: { group: TemplateGroup; name: string; subject: string; body: string; sortOrder?: number }) => apiPost<LegalTemplate>('/legal/templates', body),
  updateTemplate: (id: number, body: { name?: string; subject?: string; body?: string; sortOrder?: number }) => apiPatch<LegalTemplate>(`/legal/templates/id/${id}`, body),
  deleteTemplate: (id: number) => apiDelete<{ ok: boolean }>(`/legal/templates/id/${id}`),
  /** `ref` = a fixed kind or a template id. Fills the letter from the breach / case / lease; `values.fields` carries every merge value for live previews. */
  renderTemplate: (base: string, rp: number | undefined, ref: TemplateKind | number, q: RenderQuery) =>
    apiGet<RenderedTemplate>(legalUrl(base, rp, `/templates/${ref}/render`, q as Record<string, string | number | undefined>)),

  // admin
  adminConfig: () => apiGet<JurisdictionConfig>('/admin/legal/config'),
  adminUpdateConfig: (body: Partial<Omit<JurisdictionConfig, 'id' | 'updatedAt'>>) => apiPatch<JurisdictionConfig>('/admin/legal/config', body),
};

export interface CreateDisputeBody {
  leaseId: number; filedBy?: DisputeFiledBy; type: DisputeType; breachReasons?: BreachCategory[]; noticeType?: NoticeType;
  noticeServedDate?: string | null; noticeProofDocumentId?: number | null; claimAmount?: number | null; filingFee?: number | null;
  contactName?: string | null; contactPhone?: string | null; notes?: string | null; checklist?: string[];
  /** Record a case already in progress at its real stage (never 'closed'). */
  stage?: Exclude<DisputeStage, 'closed'>; authorityCaseNumber?: string | null; filingDate?: string | null;
  nextHearingDate?: string | null; decisionDate?: string | null; outcome?: DisputeOutcome | null;
}
export interface AdvanceBody {
  to: DisputeStage; date?: string; description?: string | null; documentId?: number | null;
  authorityCaseNumber?: string | null; filingDate?: string | null; nextHearingDate?: string | null; filingFee?: number | null;
  amount?: number | null; settlementDueDate?: string | null; decisionDate?: string | null; outcome?: DisputeOutcome | null;
  /** Filing before the notice deadline — the reason goes on the timeline; proof stays mandatory. */
  fileEarlyReason?: string | null;
}
export interface CaseFile {
  generatedAt: string; dispute: DisputeDetail; lease: LeaseSummary | null; registration: { number: string | null };
  leaseDocuments: LegalDoc[]; notice: { type: string; servedDate: string | null; deadline: string | null; proof: LegalDoc | null };
  paymentHistory: DisputePayment[];
  statementOfAccount: { annualRent: number | null; collected: number; bounced: number; pending: number; claimAmount: number | null };
  breach: BreachDetail | null; caseDocuments: LegalDoc[]; timeline: CaseEvent[];
}

/* ── helpers for the surfaces ──────────────────────────────────────────────── */
/** Days from today (Asia/Dubai calendar) to an ISO date; negative when passed. */
export function daysFromToday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: process.env.NEXT_PUBLIC_APP_TIME_ZONE || 'Asia/Dubai' });
  const a = new Date(`${today}T00:00:00Z`).getTime();
  const b = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Pill colours per stage — one place, both pipelines. */
export function breachStageTone(stage: BreachStage): { bg: string; fg: string } {
  switch (stage) {
    case 'reported': return { bg: '#fff4e0', fg: '#9a5b00' };
    case 'warning_sent': return { bg: '#fdecd2', fg: '#8a4b00' };
    case 'final_warning': return { bg: '#fde2e1', fg: '#a32d2d' };
    case 'resolved': return { bg: '#e6f4ef', fg: '#1a7a5a' };
    case 'escalated': return { bg: '#ece9fd', fg: '#5b3fbf' };
  }
}
export function disputeStageTone(stage: DisputeStage): { bg: string; fg: string } {
  switch (stage) {
    case 'notice_sent': return { bg: '#fff4e0', fg: '#9a5b00' };
    case 'case_filed': return { bg: '#e0f2fe', fg: '#0369a1' };
    case 'settlement': return { bg: '#ece9fd', fg: '#5b3fbf' };
    case 'decision': return { bg: '#e0f2fe', fg: '#0369a1' };
    case 'enforcement': return { bg: '#fde2e1', fg: '#a32d2d' };
    case 'closed': return { bg: '#eeefed', fg: '#5b615e' };
  }
}
