'use client';

/**
 * PREVIEW DATA — workflows that have no backend yet (owner decision, 16 Oct 2026).
 *
 *   • Gate 2 — vertical authorisation (per business, per vertical)
 *   • Spaces boards beside the lease: short stays, venues, courts, yacht charters
 *   • Services boards are REAL (catalog/bookings) — not here
 *   • Experiences · Memberships · Programs · Health · Protection operating boards
 *
 * Records are the Genspark Stage 2 demonstration set (os-data.js), adapted to the subcategory
 * declarations in src/lib/catalog. State lives in this browser tab (sessionStorage) only.
 * Every screen that reads from here MUST render <PreviewBanner/> (src/components/os/kit).
 * Nothing here is ever sent to the API.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { VERTICALS, type MsVerticalId } from '@/lib/catalog';

// ---------------------------------------------------------------------------- types

export type AuthState = 'granted' | 'pending' | 'refused' | 'none';
export interface VerticalAuth {
  vertical: MsVerticalId;
  state: AuthState;
  licence?: string;
  since?: string;
  requested?: string;
  note?: string;
  reason?: string;
}

/** An operating model board: Genspark "Operations" per model. */
export type ModelId =
  | 'shortstay' | 'venue' | 'court' | 'charter'
  | 'session' | 'recurring' | 'credits' | 'admissions' | 'clinical' | 'policy';

export interface BoardItem { id: string; model: ModelId; col: string; t: string; m: string; amt: string; tag?: 'hot' | 'warm'; contact: string; note: string }
export interface AuthRequest {
  id: string; business: string; vertical: MsVerticalId; licence: string; exp: string; wait: string;
  state: 'waiting' | 'granted' | 'changes' | 'refused'; note: string; own?: boolean;
}
export interface AuditRow { when: string; actor: string; gate: 1 | 2 | 3; subject: string; decision: string; ev: string }

export const MODEL_INFO: Record<ModelId, { name: string; vertical: MsVerticalId; offer: string; cols: string[]; tone: 'booking' | 'res' | 'court' | 'charter' | undefined }> = {
  shortstay:  { name: 'Short-term bookings', vertical: 'spaces', offer: 'holiday', cols: ['Request', 'Confirmed', 'In stay', 'Completed'], tone: 'booking' },
  venue:      { name: 'Venue reservations', vertical: 'spaces', offer: 'venue', cols: ['Enquiry', 'Quote sent', 'Site visit', 'Deposit paid', 'Event day'], tone: 'res' },
  court:      { name: 'Court bookings', vertical: 'spaces', offer: 'court', cols: ['Enquiry', 'Slot held', 'Confirmed', 'Blocked'], tone: 'court' },
  charter:    { name: 'Yacht charters', vertical: 'spaces', offer: 'yacht', cols: ['Enquiry', 'Crew check', 'Manifest', 'Chartered', 'Settlement'], tone: 'charter' },
  session:    { name: 'Sessions & seats', vertical: 'experiences', offer: 'safari', cols: ['Enquiry', 'Seat confirmed', 'Reminder sent', 'Attended'], tone: 'booking' },
  recurring:  { name: 'Members', vertical: 'memberships', offer: 'gym', cols: ['Enquiry', 'Free visit', 'Active', 'Renewal due', 'Frozen'], tone: undefined },
  credits:    { name: 'Credit packages', vertical: 'memberships', offer: 'credits', cols: ['Purchased', 'In use', 'Low balance', 'Expired'], tone: 'res' },
  admissions: { name: 'Admissions', vertical: 'programs', offer: 'nursery', cols: ['Enquiry', 'Tour', 'Application', 'Offer', 'Enrolled'], tone: undefined },
  clinical:   { name: 'Clinical appointments', vertical: 'health', offer: 'doctor', cols: ['Request', 'Intake & consent', 'Booked', 'Seen', 'Follow-up'], tone: 'booking' },
  policy:     { name: 'Quotes & policies', vertical: 'insurance', offer: 'motor', cols: ['Quote request', 'Risk details', 'Compared', 'Application', 'Policy issued'], tone: 'charter' },
};
export const MODELS_OF: Record<MsVerticalId, ModelId[]> = {
  spaces: ['shortstay', 'venue', 'court', 'charter'],
  services: [],
  experiences: ['session'],
  memberships: ['recurring', 'credits'],
  programs: ['admissions'],
  health: ['clinical'],
  insurance: ['policy'],
};

// ---------------------------------------------------------------------------- seed

const LICENCE_NEEDED: Record<MsVerticalId, string> = {
  spaces: 'DED / DET trade licence · DLD permit per listing',
  services: 'DED trade licence covering the service',
  experiences: 'DTCM tour operator licence',
  memberships: 'Municipality fitness-facility approval',
  programs: 'KHDA / MOE approval',
  health: 'DHA licence for clinics and practitioners',
  insurance: 'CBUAE insurer or intermediary licence',
};
export const licenceNeeded = (v: MsVerticalId) => LICENCE_NEEDED[v];

const SEED_AUTH = (): VerticalAuth[] => [
  // Spaces is granted for a verified rental provider — that part is real (its Gate 1 is the KYC
  // decision); the per-vertical record itself is preview because Gate 2 has no backend.
  { vertical: 'spaces', state: 'granted', licence: 'Trade licence on file', since: 'On verification' },
  { vertical: 'services', state: 'granted', licence: 'DED trade licence — facilities management', since: '14 Oct 2026' },
  { vertical: 'experiences', state: 'none' },
  { vertical: 'memberships', state: 'none' },
  { vertical: 'programs', state: 'none' },
  { vertical: 'health', state: 'refused', reason: 'DHA licence not supplied. A DED trade licence does not cover clinical services.' },
  { vertical: 'insurance', state: 'none' },
];

const B = (id: string, model: ModelId, col: string, t: string, m: string, amt: string, contact: string, note: string, tag?: 'hot' | 'warm'): BoardItem =>
  ({ id, model, col, t, m, amt, contact, note, tag });

const SEED_BOARD = (): BoardItem[] => [
  B('SS-1', 'shortstay', 'Request', 'Marina Gate 1BR', 'James Porter · 12–16 Oct · 4 guests', 'AED 5,600', 'James Porter', 'Asked for late check-in.', 'hot'),
  B('SS-2', 'shortstay', 'Request', 'Marina Gate 1BR', 'Anna Silva · 20–23 Oct', 'AED 4,200', 'Anna Silva', 'Two adults, one child.'),
  B('SS-3', 'shortstay', 'Confirmed', 'Downtown studio', 'Guest arriving 16 Oct · 3 nights', 'AED 2,850', 'Guest booking', 'Self check-in; code issued at 14:00.'),
  B('SS-4', 'shortstay', 'In stay', 'Palm villa 4BR', 'Checkout 17 Oct 11:00', 'AED 13,400', 'Lina Haddad', 'Pool cleaning booked mid-stay.'),
  B('SS-5', 'shortstay', 'Completed', 'JBR 2BR', 'Reviewed 4.8 · clean', 'AED 2,100', 'Mark Evans', 'Deposit released.'),
  B('VN-1', 'venue', 'Enquiry', 'Rooftop terrace', 'Hassan Ali · dinner for 80', 'AED 16,000', 'Hassan Ali', 'Corporate dinner 22 Oct, 7 PM. Catering and AV to quote.', 'warm'),
  B('VN-2', 'venue', 'Quote sent', 'Event hall', 'Product launch · 120 guests', 'AED 28,500', 'Nova Tech', 'Quote valid 7 days.'),
  B('VN-3', 'venue', 'Site visit', 'Rooftop terrace', 'Booked 18 Oct 16:00', 'AED 16,000', 'Hassan Ali', 'Bring floor plan.'),
  B('VN-4', 'venue', 'Deposit paid', 'Event hall', 'Event 2 Nov · balance due 28 Oct', 'AED 28,500', 'Nova Tech', '30% deposit received.'),
  B('VN-5', 'venue', 'Event day', 'Private dining', 'Setup 15:00 · 30 guests', 'AED 9,800', 'Sara Malik', 'Venue team on site.'),
  B('CT-1', 'court', 'Enquiry', 'Padel court A', 'Fatima Noor · recurring Tuesdays', 'AED 260 / hr', 'Fatima Noor', 'Every Tuesday 19:00–21:00 from next month.', 'warm'),
  B('CT-2', 'court', 'Slot held', 'Court B · Thu 18:00', 'Hold expires in 40 min', 'AED 260 / hr', 'Walk-in', 'Unpaid hold.'),
  B('CT-3', 'court', 'Confirmed', 'Court A · Sat 09:00', 'Pay at venue', 'AED 520', 'Omar Said', 'Two hours.'),
  B('CT-4', 'court', 'Blocked', 'Court A · 20 Oct', 'Resurfacing maintenance', '—', 'Operations', 'Whole day closed.'),
  B('CH-1', 'charter', 'Enquiry', '42 ft · 14 guests', 'Mei Lin · 25 Oct, 4 hrs', 'AED 7,200', 'Mei Lin', 'Birthday charter, needs catering.', 'hot'),
  B('CH-2', 'charter', 'Crew check', '56 ft · 20 guests', 'Captain confirmed · catering pending', 'AED 12,400', 'Gulf Events', 'Second deckhand needed.'),
  B('CH-3', 'charter', 'Manifest', '42 ft · 25 Oct', '9 of 14 guest names collected', 'AED 7,200', 'Mei Lin', 'Manifest due 24h before departure.'),
  B('CH-4', 'charter', 'Chartered', '38 ft · 19 Oct', 'Depart 16:00 Marina Walk', 'AED 5,400', 'Ravi Kumar', 'Captain and one crew.'),
  B('CH-5', 'charter', 'Settlement', '38 ft · 12 Oct', 'Balance AED 1,800 outstanding', 'AED 1,800', 'Ravi Kumar', 'Fuel surcharge added.'),
  B('EX-1', 'session', 'Enquiry', 'Evening safari · 18 Oct', 'Group of 6 · hotel pickup', 'AED 1,710', 'Priya Nair', 'Two children under 8.', 'warm'),
  B('EX-2', 'session', 'Seat confirmed', 'Pottery workshop · Sat 10:00', '8 of 12 seats sold', 'AED 1,600', 'Studio walk-ins', 'Materials included.'),
  B('EX-3', 'session', 'Reminder sent', 'Old Dubai walking tour', 'Tomorrow 08:00 · 11 guests', 'AED 1,650', 'Tour group', 'Meet at Al Fahidi.'),
  B('EX-4', 'session', 'Attended', 'Morning safari · 12 Oct', '14 attended · 1 no-show', 'AED 3,990', 'Mixed', 'Reviews requested.'),
  B('MB-1', 'recurring', 'Enquiry', 'Annual all-access', 'Ken Yamada · wants a trial', 'AED 4,800 / yr', 'Ken Yamada', 'Asked about pool hours.', 'warm'),
  B('MB-2', 'recurring', 'Free visit', 'Monthly single club', 'Visit booked Fri 18:00', 'AED 450 / mo', 'Dana Ahmed', ''),
  B('MB-3', 'recurring', 'Active', 'Annual multi-club', 'Since Mar 2026 · 3 branches', 'AED 6,200 / yr', 'Joe Martins', ''),
  B('MB-4', 'recurring', 'Renewal due', 'Monthly single club', 'Renews 1 Nov', 'AED 450 / mo', 'Leila Saad', 'Card on file expiring.'),
  B('MB-5', 'recurring', 'Frozen', 'Annual all-access', 'Frozen until 30 Nov (travel)', 'AED 4,800 / yr', 'Tom Ray', ''),
  B('CR-1', 'credits', 'Purchased', '20-credit pack', 'Bought 14 Oct · valid 3 months', 'AED 1,200', 'Maya Patel', ''),
  B('CR-2', 'credits', 'In use', '50-credit pack', '31 of 50 used', 'AED 2,600', 'Ali Raza', ''),
  B('CR-3', 'credits', 'Low balance', '10-credit pack', '2 credits left', 'AED 650', 'Nour Hamdan', 'Offer top-up.'),
  B('CR-4', 'credits', 'Expired', '20-credit pack', '6 credits unused', 'AED 1,200', 'Sam Lee', ''),
  B('PG-1', 'admissions', 'Enquiry', 'FS1 · Sep 2027 intake', 'Guardian: Rania Odeh', 'AED 42,000 / yr', 'Rania Odeh', 'Asked about bus routes.', 'warm'),
  B('PG-2', 'admissions', 'Tour', 'Nursery tour · Thu 10:00', 'Two guardians attending', '—', 'Hamad family', ''),
  B('PG-3', 'admissions', 'Application', 'FS2 · Jan 2027', 'Documents 3 of 5', 'AED 38,500 / yr', 'Chen family', 'Birth certificate missing.'),
  B('PG-4', 'admissions', 'Offer', 'Summer camp · 2 weeks', 'Offer sent 13 Oct', 'AED 3,200', 'Patel family', 'Consent form pending.'),
  B('PG-5', 'admissions', 'Enrolled', 'Football academy · Autumn', 'Term starts 1 Nov', 'AED 2,400 / term', 'Joseph Abel', ''),
  B('HL-1', 'clinical', 'Request', 'Family medicine · first visit', 'Patient details masked', 'AED 350', 'Patient #P-1042', 'Requested evening slot.'),
  B('HL-2', 'clinical', 'Intake & consent', 'Physiotherapy assessment', 'Consent form sent', 'AED 450', 'Patient #P-1043', 'Insurance: Daman.'),
  B('HL-3', 'clinical', 'Booked', 'Dental check-up · Sat 11:00', 'Dr. Haddad', 'AED 300', 'Patient #P-1044', ''),
  B('HL-4', 'clinical', 'Seen', 'Blood panel', 'Results due 48h', 'AED 520', 'Patient #P-1045', 'Lab order placed.'),
  B('HL-5', 'clinical', 'Follow-up', 'Dermatology review', 'Follow-up in 2 weeks', 'AED 400', 'Patient #P-1046', ''),
  B('IN-1', 'policy', 'Quote request', 'Motor · SUV 2024', 'Driver 32 · comprehensive', 'Quoted', 'Omar Faruk', 'Agency repair wanted.', 'hot'),
  B('IN-2', 'policy', 'Risk details', 'Home contents · villa', 'Value AED 1M–3M', 'Quoted', 'Sarah Kent', 'Waiting for inventory list.'),
  B('IN-3', 'policy', 'Compared', 'Family health · 4 members', '3 insurers compared', 'AED 18,400 / yr', 'Al Amin family', ''),
  B('IN-4', 'policy', 'Application', 'Motor · sedan', 'Sent to insurer 14 Oct', 'AED 2,150 / yr', 'Jia Wen', 'Handoff to licensed insurer.'),
  B('IN-5', 'policy', 'Policy issued', 'Motor · EV', 'Policy in force to Oct 2027', 'AED 3,300 / yr', 'Rafael Costa', ''),
];

const SEED_REQUESTS = (): AuthRequest[] => [
  { id: 'A-301', business: 'Crescent Holiday Lets', vertical: 'spaces', licence: 'DTCM holiday home permit 1030259', exp: '20 Jul 2028', wait: '1d', state: 'waiting', note: 'Permit covers holiday homes only — not long-term letting' },
  { id: 'A-302', business: 'Sahara Adventures LLC', vertical: 'experiences', licence: 'DTCM tour operator licence 88401', exp: '14 Mar 2027', wait: '2d', state: 'waiting', note: 'Licence scope covers desert safaris and guided tours' },
  { id: 'A-303', business: 'Pulse Fitness Group', vertical: 'memberships', licence: 'DED trade licence 77120', exp: '31 Dec 2026', wait: '3d', state: 'waiting', note: 'Municipality fitness-facility approval not supplied' },
  { id: 'A-304', business: 'Mirage Event Halls', vertical: 'spaces', licence: 'DED trade licence 45219', exp: '28 Feb 2027', wait: '5d', state: 'refused', note: 'Trade licence scope excludes event hosting' },
  { id: 'A-305', business: 'SecureLife Brokers', vertical: 'insurance', licence: 'CBUAE intermediary licence 2201', exp: '9 Sep 2027', wait: '8h', state: 'waiting', note: 'Intermediary licence valid; insurer appointments listed' },
  { id: 'A-306', business: 'TrueSmile Orthodontics', vertical: 'health', licence: 'DHA facility licence 55102', exp: '30 Jun 2027', wait: '1d', state: 'waiting', note: 'Professional indemnity expired 2 Sep 2026' },
  { id: 'A-307', business: 'Little Steps Nursery', vertical: 'programs', licence: 'KHDA approval E-4471', exp: '31 Aug 2027', wait: '6h', state: 'waiting', note: 'KHDA approval current; capacity 60 children' },
];

const SEED_AUDIT = (): AuditRow[] => [
  { when: '15 Oct 14:02', actor: 'Platform Admin', gate: 2, subject: 'Crescent Holiday Lets', decision: 'Granted — Spaces · Holiday homes', ev: 'DTCM permit 1030259 · exp 20 Jul 2028' },
  { when: '14 Oct 16:48', actor: 'Platform Admin', gate: 2, subject: 'Mirage Event Halls', decision: 'Refused — Venues', ev: 'Trade licence scope excludes event hosting' },
];

// ---------------------------------------------------------------------------- store

interface State { auth: VerticalAuth[]; board: BoardItem[]; requests: AuthRequest[]; audit: AuditRow[] }
const KEY = 'upnow.os.preview.v2'; // v2: Services granted in the seed
const seed = (): State => ({ auth: SEED_AUTH(), board: SEED_BOARD(), requests: SEED_REQUESTS(), audit: SEED_AUDIT() });

interface PreviewStore extends State {
  authOf: (v: MsVerticalId) => VerticalAuth;
  requestVertical: (v: MsVerticalId) => void;
  decide: (requestId: string, decision: 'granted' | 'changes' | 'refused', reason: string) => void;
  moveItem: (id: string, col: string) => void;
  addItem: (item: Omit<BoardItem, 'id'>) => void;
  reset: () => void;
}
const Ctx = createContext<PreviewStore | null>(null);

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
const nowStamp = () => new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(seed);
  // Restore after mount so server and client render the same seed first.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off restore of tab-local preview state after hydration
      if (raw) setState({ ...seed(), ...JSON.parse(raw) });
    } catch { /* storage blocked — keep seed */ }
  }, []);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }, [state]);

  const authOf = useCallback((v: MsVerticalId) => state.auth.find((a) => a.vertical === v) ?? { vertical: v, state: 'none' as const }, [state.auth]);

  const requestVertical = useCallback((v: MsVerticalId) => setState((s) => ({
    ...s,
    auth: s.auth.map((a) => (a.vertical === v && (a.state === 'none' || a.state === 'refused') ? { vertical: v, state: 'pending', requested: today(), note: `Awaiting review of: ${LICENCE_NEEDED[v]}` } : a)),
    requests: s.requests.some((r) => r.own && r.vertical === v && r.state === 'waiting') ? s.requests : [
      { id: `A-${400 + s.requests.length}`, business: 'Your business', vertical: v, licence: LICENCE_NEEDED[v], exp: '—', wait: 'just now', state: 'waiting', note: 'Submitted from the provider workspace', own: true },
      ...s.requests,
    ],
  })), []);

  const decide = useCallback((requestId: string, decision: 'granted' | 'changes' | 'refused', reason: string) => setState((s) => {
    const r = s.requests.find((x) => x.id === requestId);
    if (!r) return s;
    const label = VERTICALS.find((v) => v.id === r.vertical)?.label ?? r.vertical;
    return {
      ...s,
      requests: s.requests.map((x) => (x.id === requestId ? { ...x, state: decision, note: reason || x.note } : x)),
      // A decision on the signed-in business's own request lands on its vertical — no cascade elsewhere.
      auth: r.own ? s.auth.map((a) => (a.vertical === r.vertical
        ? decision === 'granted' ? { vertical: a.vertical, state: 'granted', since: today(), licence: r.licence }
          : decision === 'refused' ? { vertical: a.vertical, state: 'refused', reason }
          : { vertical: a.vertical, state: 'pending', requested: a.requested, note: `More evidence requested: ${reason}` }
        : a)) : s.auth,
      audit: [{ when: nowStamp(), actor: 'Platform Admin', gate: 2, subject: r.business,
        decision: `${decision === 'granted' ? 'Granted' : decision === 'refused' ? 'Refused' : 'Changes requested'} — ${label}`, ev: reason || r.licence }, ...s.audit],
    };
  }), []);

  const moveItem = useCallback((id: string, col: string) => setState((s) => ({ ...s, board: s.board.map((b) => (b.id === id ? { ...b, col } : b)) })), []);
  const addItem = useCallback((item: Omit<BoardItem, 'id'>) => setState((s) => ({ ...s, board: [{ ...item, id: `N-${Date.now()}` }, ...s.board] })), []);
  const reset = useCallback(() => setState(seed()), []);

  const value = useMemo<PreviewStore>(() => ({ ...state, authOf, requestVertical, decide, moveItem, addItem, reset }),
    [state, authOf, requestVertical, decide, moveItem, addItem, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreview(): PreviewStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePreview must be used inside <PreviewProvider> (mounted by DashboardShell for OS roles)');
  return v;
}
