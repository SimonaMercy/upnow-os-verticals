/**
 * PROTOTYPE ONLY — UpNow OS multi-vertical demo.
 *
 * Shared types for the mock store. Nothing here mirrors a backend contract;
 * these shapes exist so the prototype screens can be wired together with
 * local state. Do not import from production code.
 */

export type VerticalId =
  | 'spaces'
  | 'services'
  | 'experiences'
  | 'memberships'
  | 'programs'
  | 'health'
  | 'insurance';

/** How a subcategory actually operates — drives which workspace handles it. */
export type OperatingModel =
  | 'lease'
  | 'stay'
  | 'venue'
  | 'slot'
  | 'charter'
  | 'appointment'
  | 'field_job'
  | 'project_quote'
  | 'session'
  | 'subscription'
  | 'credits'
  | 'admission'
  | 'enrolment'
  | 'clinical'
  | 'insurance_quote';

export type FlowKind = 'lead' | 'booking' | 'operational';

export interface Subcategory {
  /** Namespaced key, e.g. `insurance.health` (avoids the `health` id clash). */
  key: string;
  id: string;
  vertical: VerticalId;
  label: string;
  model: OperatingModel;
  priceBasis: string;
  priceUnit: string;
  cta: string;
  flow: string[];
  licenceGate?: string;
  regulator?: string;
  /** Listing-form fields specific to this subcategory. */
  fields: { id: string; label: string; type: 'text' | 'number' | 'select'; options?: string[] }[];
  minPhotos: number;
}

export type OrgStatus = 'verified' | 'pending_review' | 'changes_requested' | 'rejected';
export type AuthStatus = 'approved' | 'submitted' | 'changes_requested' | 'rejected' | 'not_requested';

export interface VerticalAuth {
  vertical: VerticalId;
  status: AuthStatus;
  businessType: string;
  subcategories: string[]; // subcategory keys
  licences: { name: string; number: string; expires: string; status: 'valid' | 'expiring' | 'missing' }[];
  requestedAt: string;
  note?: string;
}

export type RolePreset = 'owner' | 'leasing_agent' | 'accountant' | 'front_desk';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: RolePreset;
  branch: string;
  packs: VerticalId[];
  status: 'active' | 'invited';
}

export interface Org {
  id: string;
  name: string;
  legalName: string;
  entityType: 'company' | 'individual';
  tradeLicence: string;
  emirate: string;
  status: OrgStatus;
  initials: string;
  colour: string;
  branches: { id: string; name: string; area: string; verticals: VerticalId[] }[];
  verticals: VerticalAuth[];
  members: Member[];
  documents: { name: string; status: 'verified' | 'pending' | 'expiring' | 'missing'; expires?: string }[];
}

export type ListingStatus =
  | 'draft'
  /** Submitted while the business or the vertical is not yet approved (MarketSpace `verify`). */
  | 'awaiting_verification'
  | 'awaiting_licence'
  | 'in_review'
  | 'changes_requested'
  | 'published'
  | 'rejected'
  | 'withdrawn';

export interface Listing {
  id: string;
  orgId: string;
  subKey: string;
  title: string;
  asset: string;
  price: number; // AED (whole dirhams in the prototype)
  status: ListingStatus;
  updated: string;
  photos: number;
  reviewNote?: string;
  attributes: Record<string, string>;
}

export interface Lead {
  id: string;
  orgId: string;
  subKey: string;
  customer: string;
  phone: string;
  source: 'UpNow' | 'WhatsApp' | 'Instagram' | 'Bayut' | 'Property Finder' | 'Phone' | 'Email';
  listing: string;
  received: string;
  stage: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  assignee: string;
  message: string;
  convertedTo?: string;
  /** How the customer reached the provider (MarketSpace listing page: Call · WhatsApp · Chat · enquiry form). */
  channel?: ContactChannel;
  /** Follow-up messages after the first one, both directions. */
  messages?: LeadMessage[];
  /** Listing the enquiry came from (customer-side enquiries). */
  listingId?: string;
}

export type ContactChannel = 'Chat' | 'WhatsApp' | 'Call' | 'Form';

export interface LeadMessage { from: 'customer' | 'provider'; text: string; at: string }

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  since: string;
  tags: VerticalId[];
  lifetimeValue: number;
}

export interface Invoice {
  id: string;
  orgId: string;
  vertical: VerticalId;
  customer: string;
  description: string;
  amount: number;
  due: string;
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'refunded' | 'void';
  method?: 'Cheque (PDC)' | 'Card' | 'Bank transfer' | 'Cash';
}

export interface Deposit {
  id: string;
  orgId: string;
  vertical: VerticalId;
  customer: string;
  reference: string;
  amount: number;
  status: 'held' | 'released' | 'partially_released' | 'forfeited';
}

export interface Payout {
  id: string;
  orgId: string;
  period: string;
  gross: number;
  fees: number;
  status: 'scheduled' | 'paid';
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  context: string;
  action: string;
  entity: string;
}

/** Generic workflow record used by every pipeline-style vertical module. */
export interface WorkItem {
  id: string;
  orgId: string;
  dataset: string;
  title: string;
  customer: string;
  stage: string;
  amount?: number;
  date?: string;
  time?: string;
  assignee?: string;
  meta: Record<string, string | number>;
}

export interface ProviderApplication {
  id: string;
  orgName: string;
  entityType: 'company' | 'individual';
  vertical: VerticalId;
  businessType: string;
  submitted: string;
  status: 'pending_review' | 'changes_requested' | 'approved' | 'rejected';
  documents: { name: string; ok: boolean }[];
  contact: string;
  emirate: string;
  note?: string;
}
