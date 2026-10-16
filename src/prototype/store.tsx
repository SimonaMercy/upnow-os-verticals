'use client';

/**
 * PROTOTYPE ONLY — in-memory demo store.
 *
 * Holds the seeded dummy data and every simulated status change. No network
 * calls. State is mirrored to sessionStorage (one namespaced key, this browser
 * tab only) so a full reload keeps the demo where it was; "Reset" clears it
 * back to the seed. Nothing is shared with production code or other tabs.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from './toast';
import * as seed from './seed';
import type {
  AuditEvent, AuthStatus, Customer, Deposit, Invoice, Lead, Listing, Member, Org, Payout,
  ProviderApplication, RolePreset, VerticalAuth, VerticalId, WorkItem,
} from './types';
import { settleListings } from './rules';

interface State {
  orgs: Org[];
  context: 'personal' | string;
  role: RolePreset;
  /** Who is browsing in the Personal (customer) context. */
  persona: 'self' | 'guest';
  listings: Listing[];
  leads: Lead[];
  customers: Customer[];
  invoices: Invoice[];
  deposits: Deposit[];
  payouts: Payout[];
  audit: AuditEvent[];
  applications: ProviderApplication[];
  work: WorkItem[];
}

const initial = (): State => ({
  orgs: structuredClone(seed.ORGS),
  context: 'o1',
  role: 'owner',
  persona: 'self',
  listings: structuredClone(seed.LISTINGS),
  leads: structuredClone(seed.LEADS),
  customers: structuredClone(seed.CUSTOMERS),
  invoices: structuredClone(seed.INVOICES),
  deposits: structuredClone(seed.DEPOSITS),
  payouts: structuredClone(seed.PAYOUTS),
  audit: structuredClone(seed.AUDIT),
  applications: structuredClone(seed.APPLICATIONS),
  work: structuredClone(seed.WORK),
});

type Collection = 'listings' | 'leads' | 'invoices' | 'deposits' | 'work' | 'applications' | 'customers';
type ItemOf<C extends Collection> = State[C][number];

interface Store extends State {
  org: Org | null;
  setContext: (c: 'personal' | string) => void;
  setRole: (r: RolePreset) => void;
  setPersona: (p: 'self' | 'guest') => void;
  patch: <C extends Collection>(c: C, id: string, p: Partial<ItemOf<C>>, msg?: string, actor?: string) => void;
  add: <C extends Collection>(c: C, item: ItemOf<C>, msg?: string, actor?: string) => void;
  setVertical: (orgId: string, v: VerticalId, p: Partial<VerticalAuth>, msg?: string, actor?: string) => void;
  patchOrg: (orgId: string, p: Partial<Org>, msg?: string, actor?: string) => void;
  requestVertical: (orgId: string, auth: VerticalAuth) => void;
  addMember: (orgId: string, m: Member) => void;
  addOrg: (o: Org) => void;
  nextId: (prefix: string) => string;
  reset: () => void;
  approvedVerticals: (o: Org | null) => VerticalId[];
  authStatus: (o: Org | null, v: VerticalId) => AuthStatus;
}

const Ctx = createContext<Store | null>(null);

function stamp() {
  const d = new Date();
  return `${seed.TODAY} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** New org list + listings re-settled against it (waiting listings move on when unblocked). */
function withOrgs(st: State, orgs: Org[]): Pick<State, 'orgs' | 'listings'> {
  return { orgs, listings: settleListings(st.listings, orgs) };
}

// ── Tab-scoped persistence (sessionStorage) ─────────────────────────────────
const STORAGE_KEY = 'upnow-prototype:demo-state';
const STORAGE_VERSION = 2; // v2: persona, lead messages, multi-vertical onboarding
const FIRST_ID = 1000;

interface Snapshot { v: number; counter: number; state: State }

function readSnapshot(): Snapshot | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    // Ignore snapshots from an older shape of the demo data.
    if (snap?.v !== STORAGE_VERSION || !Array.isArray(snap.state?.orgs) || !Array.isArray(snap.state?.work)) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return snap;
  } catch {
    return null; // storage blocked or corrupt — fall back to the seed
  }
}

function writeSnapshot(snap: Snapshot) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    // storage full or blocked — the demo keeps working in memory
  }
}

export function PrototypeProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State>(initial);
  const [restored, setRestored] = useState(false);
  const counter = useRef(FIRST_ID);

  // Restore after mount, never during render, so server and client render the
  // same seed first (no hydration mismatch).
  useEffect(() => {
    const snap = readSnapshot();
    if (snap) {
      counter.current = Math.max(FIRST_ID, snap.counter);
      setS(snap.state); // eslint-disable-line react-hooks/set-state-in-effect -- one-time sync from browser storage
    }
    setRestored(true);
  }, []);

  // Save every change once the restore has happened.
  useEffect(() => {
    if (restored) writeSnapshot({ v: STORAGE_VERSION, counter: counter.current, state: s });
  }, [s, restored]);

  const nextId = useCallback((prefix: string) => `${prefix}-${++counter.current}`, []);

  const log = useCallback((st: State, action: string, entity: string, actor?: string): AuditEvent[] => {
    const org = st.orgs.find((o) => o.id === st.context);
    const ev: AuditEvent = {
      id: `A-${++counter.current}`,
      at: stamp(),
      actor: actor ?? seed.DEMO_PERSON.name,
      context: actor?.startsWith('UpNow Admin') ? 'Admin' : org?.name ?? 'Personal',
      action,
      entity,
    };
    return [ev, ...st.audit];
  }, []);

  const patch = useCallback(<C extends Collection>(c: C, id: string, p: Partial<ItemOf<C>>, msg?: string, actor?: string) => {
    setS((st) => {
      const list = (st[c] as ItemOf<C>[]).map((x) => ((x as { id: string }).id === id ? { ...x, ...p } : x));
      return { ...st, [c]: list, audit: msg ? log(st, msg, id, actor) : st.audit };
    });
    if (msg) toast.success(msg, { description: `${id} · simulated, nothing was saved` });
  }, [log]);

  const add = useCallback(<C extends Collection>(c: C, item: ItemOf<C>, msg?: string, actor?: string) => {
    setS((st) => ({
      ...st,
      [c]: [item, ...(st[c] as ItemOf<C>[])],
      audit: msg ? log(st, msg, (item as { id: string }).id, actor) : st.audit,
    }));
    if (msg) toast.success(msg, { description: 'Simulated — prototype data only' });
  }, [log]);

  const setVertical = useCallback((orgId: string, v: VerticalId, p: Partial<VerticalAuth>, msg?: string, actor?: string) => {
    setS((st) => ({
      ...st,
      ...withOrgs(st, st.orgs.map((o) => (o.id !== orgId ? o : {
        ...o, verticals: o.verticals.map((a) => (a.vertical === v ? { ...a, ...p } : a)),
      }))),
      audit: msg ? log(st, msg, `${orgId}:${v}`, actor) : st.audit,
    }));
    if (msg) toast.success(msg, { description: 'Simulated — prototype data only' });
  }, [log]);

  const patchOrg = useCallback((orgId: string, p: Partial<Org>, msg?: string, actor?: string) => {
    setS((st) => ({
      ...st,
      ...withOrgs(st, st.orgs.map((o) => (o.id === orgId ? { ...o, ...p } : o))),
      audit: msg ? log(st, msg, orgId, actor) : st.audit,
    }));
    if (msg) toast.success(msg, { description: 'Simulated — prototype data only' });
  }, [log]);

  const requestVertical = useCallback((orgId: string, auth: VerticalAuth) => {
    setS((st) => ({
      ...st,
      orgs: st.orgs.map((o) => (o.id !== orgId ? o : {
        ...o, verticals: [...o.verticals.filter((a) => a.vertical !== auth.vertical), auth],
      })),
      audit: log(st, `Requested access to ${auth.vertical}`, auth.vertical),
    }));
    toast.success('Access request submitted', { description: 'It now appears in the Admin → Vertical access queue' });
  }, [log]);

  const addMember = useCallback((orgId: string, m: Member) => {
    setS((st) => ({
      ...st,
      orgs: st.orgs.map((o) => (o.id === orgId ? { ...o, members: [...o.members, m] } : o)),
      audit: log(st, `Invited ${m.name} as ${m.role}`, m.id),
    }));
    toast.success(`Invitation sent to ${m.email}`, { description: 'Simulated — no email was sent' });
  }, [log]);

  const addOrg = useCallback((o: Org) => {
    setS((st) => ({
      ...st,
      orgs: [...st.orgs, o],
      context: o.id,
      applications: [{
        id: `APP-${++counter.current}`, orgName: o.name, entityType: o.entityType,
        vertical: o.verticals[0]?.vertical ?? 'spaces', businessType: o.verticals.map((a) => a.businessType).join(' · '),
        submitted: seed.TODAY, status: 'pending_review', contact: seed.DEMO_PERSON.name, emirate: o.emirate,
        documents: o.documents.map((d) => ({ name: d.name, ok: d.status !== 'missing' })),
      }, ...st.applications],
      audit: log(st, 'Created business and submitted for verification', o.id),
    }));
    toast.success(`${o.name} submitted for verification`, { description: 'Visible in Admin → Provider verification' });
  }, [log]);

  const reset = useCallback(() => {
    counter.current = FIRST_ID;
    setS(initial());
    toast.message('Demo data reset to the original seed');
  }, []);

  const value = useMemo<Store>(() => {
    const org = s.orgs.find((o) => o.id === s.context) ?? null;
    return {
      ...s,
      org,
      setContext: (c) => setS((st) => ({ ...st, context: c })),
      setRole: (r) => setS((st) => ({ ...st, role: r })),
      setPersona: (p) => setS((st) => ({ ...st, persona: p })),
      patch, add, setVertical, patchOrg, requestVertical, addMember, addOrg, nextId, reset,
      approvedVerticals: (o) => (o ? o.verticals.filter((a) => a.status === 'approved').map((a) => a.vertical) : []),
      authStatus: (o, v) => o?.verticals.find((a) => a.vertical === v)?.status ?? 'not_requested',
    };
  }, [s, patch, add, setVertical, patchOrg, requestVertical, addMember, addOrg, nextId, reset]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProto(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProto must be used inside <PrototypeProvider>');
  return v;
}

/** Work items for the active org + dataset. */
export function useWork(dataset: string) {
  const { work, context } = useProto();
  return work.filter((w) => w.dataset === dataset && w.orgId === context);
}

export const ADMIN_ACTOR = 'UpNow Admin · Sara';
