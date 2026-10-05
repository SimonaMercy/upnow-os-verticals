/**
 * A customer's OTHER contacts — a second address, a family member's number, the
 * company's PRO. The customer keeps one primary email and one primary phone
 * (their record; the only ones a contract shows); these exist only so emails and
 * WhatsApp chats from them are filed under the customer.
 */
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

export type Rp = string | number | null;

export const RELATIONSHIPS = [
  { value: 'self', label: 'Customer’s own (second address / number)' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'family', label: 'Family member' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'company_staff', label: 'Company staff / PRO' },
  { value: 'other', label: 'Other' },
] as const;
export type ContactRelationship = (typeof RELATIONSHIPS)[number]['value'];

const SHORT: Record<string, string> = { self: 'Customer’s own', spouse: 'Spouse', family: 'Family member', assistant: 'Assistant', company_staff: 'Company staff / PRO', other: 'Other contact' };
export const relationshipLabel = (r: string | null | undefined) => (r ? SHORT[r] ?? 'Other contact' : 'Other contact');

/** The contact behind a conversation, as the email and WhatsApp details carry it. */
export interface ContactRef { id: number; name: string | null; relationship: string | null }

export interface CustomerContact extends ContactRef {
  tenantId: number;
  email: string | null;
  phone: string | null;
  emailConversations: number;
  whatsappChats: number;
}
export interface CustomerContactList { canEdit: boolean; items: CustomerContact[] }
export interface ContactInput { name?: string | null; relationship?: ContactRelationship | null; email?: string | null; phone?: string | null }

const scoped = (path: string, rp: Rp) => (rp == null || rp === '' ? path : `${path}${path.includes('?') ? '&' : '?'}rp=${rp}`);

export const customerContactsApi = {
  list: (rp: Rp, tenantId: number) => apiGet<CustomerContactList>(scoped(`/customer-contacts?tenantId=${tenantId}`, rp)),
  add: (rp: Rp, tenantId: number, body: ContactInput) => apiPost<CustomerContactList>(scoped('/customer-contacts', rp), { tenantId, ...body }),
  save: (rp: Rp, id: number, body: ContactInput) => apiPut<CustomerContactList>(scoped(`/customer-contacts/${id}`, rp), body),
  remove: (rp: Rp, id: number) => apiDelete<CustomerContactList>(scoped(`/customer-contacts/${id}`, rp)),
};

export function contactErrorText(err: unknown, fallback: string): string {
  const m = (err as { message?: string | string[] } | null)?.message;
  return (Array.isArray(m) ? m[0] : m) || fallback;
}
