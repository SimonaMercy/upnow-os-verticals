'use client';

/**
 * "Get Job-Ready" Setup Guide — the SP operational profile (onboarding v3 §3C).
 *
 * Five cards, any order, each independently savable. All completion logic is
 * SERVER-computed: this component renders the `complete` flags returned by
 * GET /service-provider/job-ready and never re-derives a rule. Every mutating
 * endpoint returns the fresh status, so the shell updates after each save.
 *
 * Design source: claude.ai/design project "UpNow SP Onboarding" (screens
 * 1m–1v) — internal flow only, rendered inside the existing dashboard shell.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlarmClock, AlertTriangle, Camera, Check, ChevronDown, ChevronLeft,
  ChevronRight, Clock, FileText, Loader2, MapPin, MessageCircle, Plus,
  Route, Search, Shield, Trash2, Truck, Users, X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';

/* ── Types (mirror the backend contract) ─────────────────────────────────── */

interface JobReadyStatus {
  jobReady: boolean;
  jobReadyAt: string | null;
  cards: {
    coverage: { complete: boolean; zoneCount: number };
    team: {
      complete: boolean; adoptedCategories: string[]; coveredCategories: string[];
      missingCategories: string[]; activeTechnicians: number; leadCapable: number;
    };
    fleet: {
      complete: boolean; vehicles: number; derivedMaxConcurrentJobs: number;
      maxConcurrentJobs: number | null; effectiveMaxConcurrentJobs: number;
    };
    hours: { complete: boolean; daysConfigured: number };
    rules: {
      complete: boolean; acceptedAt: string | null; minNoticeHours: number;
      opsContactName: string | null; opsContactPhone: string | null; opsContactWhatsapp: boolean;
    };
  };
}
interface CoverageOption { communityId: number; nameEn: string; nameAr: string | null; selected: boolean }
interface Tech { id: number; name: string; status: string; isLeadCapable: boolean; photoUrl: string | null; skills: string[] }
interface Vehicle { id: number; vehicleType: string; label: string | null; categories: string[] | null; isActive: boolean }
interface HoursRow { weekday: number; opensAt: string; closesAt: string }
interface TimeOff { id: number; startsOn: string; endsOn: string; reason: string | null }

const CAT_LABELS: Record<string, string> = {
  home_cleaning: 'Cleaning', ac_services: 'AC', plumbing: 'Plumbing',
  electrical: 'Electrical', handyman: 'Handyman', painting: 'Painting',
  pest_control: 'Pest control', car_vehicle: 'Car & vehicle',
  landscaping_outdoor: 'Landscaping', commercial_services: 'Commercial',
};
const catLabel = (c: string) => CAT_LABELS[c] ?? c.replace(/_/g, ' ');

/* Community grouping for the coverage picker (display-only; matching is
   server-side via polygons). Unlisted names fall into "Outer Dubai". */
const COMMUNITY_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: 'Marina & New Dubai', names: ['Marsa Dubai (Dubai Marina)', 'Bluewaters Island', 'Emaar Beachfront', 'Palm Jumeirah', 'Jumeirah Lakes Towers (JLT)', 'Al Sufouh', 'Dubai Internet City', 'Dubai Media City', 'Dubai Knowledge Park', 'The Greens', 'The Views', 'Emirates Hills', 'The Lakes', 'The Meadows', 'The Springs', 'Jumeirah Islands', 'Jumeirah Park', 'Jumeirah Golf Estates', 'Al Furjan', 'Discovery Gardens'] },
  { label: 'JVC belt & Dubailand West', names: ['Jumeirah Village Circle (JVC)', 'Jumeirah Village Triangle (JVT)', 'Dubai Sports City', 'Motor City', 'Dubai Studio City', 'Dubai Production City (IMPZ)', 'Arjan', 'Remraam', 'Mudon', 'Damac Hills', 'Damac Hills 2 (Akoya)', 'Town Square', 'Arabian Ranches', 'Arabian Ranches 2', 'Arabian Ranches 3', 'Sustainable City'] },
  { label: 'Central & Sheikh Zayed Rd', names: ['Al Barsha', 'Al Barsha South', 'Umm Suqeim', 'Al Manara', 'Umm Al Sheif', 'Al Quoz', 'Al Safa', 'Al Wasl', 'Jumeirah', 'Jumeirah 1', 'City Walk', 'La Mer', 'Downtown Dubai', 'Business Bay', 'Dubai International Financial Centre (DIFC)', 'Trade Centre', 'Zabeel', 'Al Satwa', 'Al Kifaf', 'Dubai Hills Estate', 'Hadaeq Sheikh Mohammed Bin Rashid (MBR City)', 'Meydan', 'Nad Al Sheba', 'Ras Al Khor', 'Ras Al Khor Industrial'] },
  { label: 'Bur Dubai', names: ['Al Mankhool', 'Al Raffa', 'Al Souk Al Kabir', 'Al Hudaiba', 'Al Jafiliya', 'Al Karama', 'Oud Metha', 'Umm Hurair', 'Al Jaddaf'] },
  { label: 'Deira & Creek', names: ['Al Murqabat', 'Al Rega', 'Naif', 'Al Muteena', 'Abu Hail', 'Hor Al Anz', 'Al Mamzar', 'Al Baraha', 'Port Saeed', 'Al Garhoud', 'Umm Ramool', 'Dubai Festival City', 'Dubai Creek Harbour'] },
  { label: 'East & Airport', names: ['Al Nahda', 'Al Qusais', 'Al Twar', 'Muhaisnah', 'Al Rashidiya', 'Mirdif', 'Al Warqaa', 'Al Mizhar', 'Al Khawaneej', 'Nad Al Hammar', 'International City', 'Al Warsan', 'Dubai Silicon Oasis (DSO)', 'Academic City', 'Liwan'] },
  { label: 'Outer Dubai', names: ['Jebel Ali', 'Dubai South (DWC)', 'Dubai Investment Park (DIP)', 'Dubailand', 'The Villa'] },
];
const groupOf = (name: string) =>
  COMMUNITY_GROUPS.find((g) => g.names.includes(name))?.label ?? 'Outer Dubai';

/* ── Tiny shared atoms ───────────────────────────────────────────────────── */

const GREEN = '#0B7A4E';
const GREEN_DARK = '#08603D';
const INK = '#182420';

function StatusPill({ state }: { state: 'done' | 'progress' | 'todo' }) {
  if (state === 'done')
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: '#E3F2EA', color: GREEN_DARK }}><Check size={11} strokeWidth={3} /> Done</span>;
  if (state === 'progress')
    return <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: '#FDF3DC', color: '#9A6A00' }}>In progress</span>;
  return <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: '#EEF0EF', color: '#55645B' }}>To do</span>;
}

function ProgressRing({ done, total, size = 52, dark = false }: { done: number; total: number; size?: number; dark?: boolean }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'rgba(255,255,255,.25)' : '#E5E9E6'} strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? '#7BD8A8' : GREEN} strokeWidth={6}
        strokeLinecap="round" strokeDasharray={`${(done / total) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle"
        style={{ font: `700 ${size / 4}px sans-serif`, fill: dark ? '#fff' : INK }}>{done}/{total}</text>
    </svg>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label ?? 'toggle'} disabled={disabled} onClick={() => onChange(!on)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40"
      style={{ background: on ? GREEN : '#D5DAD6' }}>
      <span className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: on ? 'translateX(22px)' : 'translateX(2px)' }} />
    </button>
  );
}

/** Inline pre-confirm shown before a destructive save that would revoke job-ready. */
function RevokeWarning({ body, keepLabel, proceedLabel, onKeep, onProceed }: {
  body: string; keepLabel: string; proceedLabel: string; onKeep: () => void; onProceed: () => void;
}) {
  return (
    <div className="rounded-2xl border p-4" style={{ background: '#FEF7EA', borderColor: '#F2D9A6' }}>
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: '#B45309' }}>
          <AlertTriangle size={16} className="text-white" />
        </span>
        <div>
          <p className="text-sm font-bold" style={{ color: '#7C3E06' }}>You&apos;ll stop receiving new jobs until this is fixed</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: '#8A5A1E' }}>{body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onKeep} className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: GREEN }}>{keepLabel}</button>
            <button onClick={onProceed} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold" style={{ color: '#B42318', borderColor: '#E5D5C0' }}>{proceedLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardHeader({ title, sub, onBack, right }: { title: string; sub: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <button onClick={onBack} aria-label="Back" className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border bg-white hover:bg-neutral-50" style={{ borderColor: 'rgba(0,0,0,.1)' }}>
          <ChevronLeft size={18} />
        </button>
        <div>
          <h2 className="text-lg font-bold" style={{ color: INK }}>{title}</h2>
          <p className="text-[13px]" style={{ color: '#55645B' }}>{sub}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */

type View = 'list' | 'coverage' | 'team' | 'vehicles' | 'hours' | 'rules';

export function SpJobReady() {
  const router = useRouter();
  const [status, setStatus] = useState<JobReadyStatus | null>(null);
  const [view, setView] = useState<View>('list');
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevReady = useRef<boolean | null>(null);

  const absorb = useCallback((s: JobReadyStatus) => {
    if (prevReady.current === false && s.jobReady) setFlipped(true);
    prevReady.current = s.jobReady;
    setStatus(s);
  }, []);

  useEffect(() => {
    apiGet<JobReadyStatus>('/service-provider/job-ready')
      .then((s) => { prevReady.current = s.jobReady; setStatus(s); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <div className="rounded-2xl bg-white p-6 text-sm text-red-700">{error}</div>;
  if (!status) {
    return (
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white" />)}
      </div>
    );
  }

  const c = status.cards;
  const doneCount = Object.values(c).filter((x) => x.complete).length;
  const leftLabels: string[] = [
    !c.coverage.complete && 'Coverage', !c.team.complete && 'Team', !c.fleet.complete && 'Vehicles',
    !c.hours.complete && 'Hours', !c.rules.complete && 'Job rules',
  ].filter(Boolean) as string[];

  if (flipped) return <FlipCelebration status={status} onDashboard={() => router.push('/dashboard/service-provider')} onSettings={() => setFlipped(false)} />;

  const common = { status, absorb, back: () => setView('list') };
  if (view === 'coverage') return <CoverageCard {...common} />;
  if (view === 'team') return <TeamCard {...common} />;
  if (view === 'vehicles') return <VehiclesCard {...common} />;
  if (view === 'hours') return <HoursCard {...common} />;
  if (view === 'rules') return <RulesCard {...common} />;

  /* ── the shell (list) ── */
  const rows: Array<{ key: View; icon: React.ReactNode; title: string; sub: string; state: 'done' | 'progress' | 'todo' }> = [
    { key: 'coverage', icon: <MapPin size={18} />, title: 'Where you work',
      sub: c.coverage.complete ? `Coverage · ${c.coverage.zoneCount} areas` : 'Pick the Dubai areas your team serves',
      state: c.coverage.complete ? 'done' : 'todo' },
    { key: 'team', icon: <Users size={18} />, title: 'Your team',
      sub: c.team.complete ? `${c.team.activeTechnicians} technicians · ${c.team.leadCapable} lead-capable`
        : c.team.missingCategories.length ? `Missing a ${c.team.missingCategories.map(catLabel).join(', ')} lead`
        : c.team.adoptedCategories.length ? 'Give each technician skills — jobs go to skilled, free crews' : 'Adopt a service first, then skill your team',
      state: c.team.complete ? 'done' : (c.team.activeTechnicians > 0 ? 'progress' : 'todo') },
    { key: 'vehicles', icon: <Truck size={18} />, title: 'Your vehicles',
      sub: c.fleet.complete ? `${c.fleet.vehicles} vehicle${c.fleet.vehicles === 1 ? '' : 's'} · ${c.fleet.effectiveMaxConcurrentJobs} crew${c.fleet.effectiveMaxConcurrentJobs === 1 ? '' : 's'} on the road at once`
        : c.fleet.vehicles > 0 ? 'Add a lead technician to activate your crews' : 'Vehicles + lead techs = how many jobs at once',
      state: c.fleet.complete ? 'done' : (c.fleet.vehicles > 0 ? 'progress' : 'todo') },
    { key: 'hours', icon: <Clock size={18} />, title: 'When you work',
      sub: c.hours.complete ? `${c.hours.daysConfigured} days a week` : 'Set your working week and days off',
      state: c.hours.complete ? 'done' : 'todo' },
    { key: 'rules', icon: <FileText size={18} />, title: 'Job rules',
      sub: c.rules.complete ? `Accepted · min notice ${c.rules.minNoticeHours === 0 ? 'same-day' : `${c.rules.minNoticeHours}h`}`
        : 'The handshake: response times, travel buffer, emergency passes',
      state: c.rules.complete ? 'done' : 'todo' },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      {/* progress header */}
      <div className="mb-4 rounded-2xl p-5" style={status.jobReady
        ? { background: GREEN_DARK, color: '#fff' }
        : { background: '#fff', boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center gap-4">
          <ProgressRing done={doneCount} total={5} dark={status.jobReady} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{status.jobReady ? 'You’re job-ready ✓' : 'Get job-ready'}</h1>
            <p className="mt-0.5 text-[13px] leading-snug" style={{ color: status.jobReady ? 'rgba(255,255,255,.85)' : '#55645B' }}>
              {status.jobReady
                ? 'Bookings in your areas reach you. These five cards are now your settings — change anything, anytime.'
                : `${doneCount} of 5 done — bookings unlock automatically when the last card completes. Any order, ~10 minutes total.`}
            </p>
          </div>
          {!status.jobReady && leftLabels.length > 0 && (
            <div className="hidden text-right sm:block">
              <p className="text-[11px] font-medium" style={{ color: '#8B978F' }}>Left to do</p>
              <p className="text-[13px] font-bold" style={{ color: INK }}>{leftLabels.join(' · ')}</p>
            </div>
          )}
        </div>
      </div>

      {/* card rows */}
      <div className="space-y-3">
        {rows.map((r) => (
          <button key={r.key} onClick={() => setView(r.key)}
            className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left transition-shadow hover:shadow-md"
            style={{ boxShadow: 'var(--shadow-sm)', border: r.state === 'progress' ? '1px solid #F2D9A6' : '1px solid transparent' }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: r.state === 'done' ? '#E3F2EA' : r.state === 'progress' ? '#FDF3DC' : '#EEF0EF',
                color: r.state === 'done' ? GREEN_DARK : r.state === 'progress' ? '#9A6A00' : '#55645B' }}>
              {r.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold" style={{ color: INK }}>{r.title}</span>
              <span className="block truncate text-[13px]" style={{ color: r.state === 'progress' ? '#9A6A00' : '#55645B' }}>{r.sub}</span>
            </span>
            <StatusPill state={r.state} />
            <ChevronRight size={16} className="shrink-0 text-neutral-400" />
          </button>
        ))}
      </div>

      <p className="mt-5 text-center text-xs" style={{ color: '#8B978F' }}>
        Bookings unlock automatically the moment all five are done — no review, no waiting.
      </p>
    </div>
  );
}

/* ── Flip celebration ────────────────────────────────────────────────────── */

function FlipCelebration({ status, onDashboard, onSettings }: { status: JobReadyStatus; onDashboard: () => void; onSettings: () => void }) {
  const c = status.cards;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-3xl p-8 text-center text-white sm:p-12" style={{ background: GREEN_DARK }}>
        <div className="text-5xl">🎉</div>
        <h1 className="mt-4 text-3xl font-extrabold">You&apos;re job-ready</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px]" style={{ color: 'rgba(255,255,255,.85)' }}>
          Bookings in your {c.coverage.zoneCount} areas now reach you. First offers usually arrive within days.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {[`${c.coverage.zoneCount} areas`, `${c.fleet.effectiveMaxConcurrentJobs} crews at once`, `${c.hours.daysConfigured} days a week`].map((chip) => (
            <span key={chip} className="rounded-full px-3.5 py-1.5 text-[13px] font-semibold" style={{ background: 'rgba(255,255,255,.14)' }}>{chip}</span>
          ))}
        </div>
        <button onClick={onDashboard} className="mt-7 w-full rounded-2xl bg-white py-3.5 text-[15px] font-bold sm:w-auto sm:px-12" style={{ color: INK }}>
          Go to dashboard
        </button>
        <p className="mt-4 text-xs" style={{ color: 'rgba(255,255,255,.7)' }}>
          These 5 cards now live as your <button onClick={onSettings} className="underline">settings</button> — change anything, anytime.
        </p>
      </div>
    </div>
  );
}

/* ── Card ① · Where you work ─────────────────────────────────────────────── */

interface CardProps { status: JobReadyStatus; absorb: (s: JobReadyStatus) => void; back: () => void }

function CoverageCard({ status, absorb, back }: CardProps) {
  const [options, setOptions] = useState<CoverageOption[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    apiGet<CoverageOption[]>('/service-provider/coverage/options').then((rows) => {
      setOptions(rows);
      setSelected(new Set(rows.filter((r) => r.selected).map((r) => r.communityId)));
      const withSel = new Set(rows.filter((r) => r.selected).map((r) => groupOf(r.nameEn)));
      setOpenGroups(withSel.size ? withSel : new Set([COMMUNITY_GROUPS[0].label]));
    });
  }, []);

  const groups = useMemo(() => {
    if (!options) return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? options.filter((o) => o.nameEn.toLowerCase().includes(q)) : options;
    const byGroup = new Map<string, CoverageOption[]>();
    for (const o of filtered) {
      const g = groupOf(o.nameEn);
      byGroup.set(g, [...(byGroup.get(g) ?? []), o]);
    }
    const order = [...COMMUNITY_GROUPS.map((g) => g.label), 'Outer Dubai'];
    return [...new Set(order)].filter((g) => byGroup.has(g)).map((g) => ({ label: g, items: byGroup.get(g)! }));
  }, [options, query]);

  const save = async (ids: number[]) => {
    setSaving(true);
    try { absorb(await apiPut<JobReadyStatus>('/service-provider/coverage', { communityIds: ids })); back(); }
    finally { setSaving(false); }
  };
  const onSave = () => {
    if (selected.size === 0 && status.jobReady && status.cards.coverage.zoneCount > 0) { setConfirmRevoke(true); return; }
    void save([...selected]);
  };

  if (!options) return <CardSkeleton back={back} title="Where you work" />;
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <CardHeader title="Where you work" sub="Wider area = more jobs. Change anytime." onBack={back} />

      <div className="relative mb-3">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search communities…"
          className="w-full rounded-2xl border bg-white py-3 pl-10 pr-4 text-sm outline-none focus:ring-2"
          style={{ borderColor: 'rgba(0,0,0,.1)' }} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setSelected(new Set(options.map((o) => o.communityId)))}
          className="rounded-full border bg-white px-3.5 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.12)' }}>
          Select all Dubai
        </button>
        <span className="rounded-full px-3.5 py-1.5 text-[13px] font-bold text-white" style={{ background: INK }}>
          {selected.size} areas
        </span>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[13px] font-semibold" style={{ color: '#B42318' }}>Clear all</button>
        )}
      </div>

      {confirmRevoke && (
        <div className="mb-4">
          <RevokeWarning
            body="Clearing every area takes you below job-ready. Dispatch pauses immediately and resumes the moment coverage is back."
            keepLabel="Keep my areas" proceedLabel="Clear anyway"
            onKeep={() => setConfirmRevoke(false)}
            onProceed={() => { setConfirmRevoke(false); void save([]); }} />
        </div>
      )}

      <div className="space-y-2.5">
        {groups.map((g) => {
          const selCount = g.items.filter((i) => selected.has(i.communityId)).length;
          const open = openGroups.has(g.label) || Boolean(query.trim());
          return (
            <div key={g.label} className="overflow-hidden rounded-2xl bg-white" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="flex w-full items-center gap-2 px-4 py-3">
                <button className="flex flex-1 items-center gap-2 text-left"
                  onClick={() => setOpenGroups((s) => { const n = new Set(s); if (n.has(g.label)) n.delete(g.label); else n.add(g.label); return n; })}>
                  <ChevronDown size={15} className="text-neutral-400 transition-transform" style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
                  <span className="text-[14px] font-bold" style={{ color: INK }}>{g.label}</span>
                  <span className="text-[13px]" style={{ color: '#8B978F' }}>· {selCount} of {g.items.length}</span>
                </button>
                <button className="text-[13px] font-semibold" style={{ color: GREEN }}
                  onClick={() => setSelected((s) => { const n = new Set(s); const all = g.items.every((i) => n.has(i.communityId)); g.items.forEach((i) => { if (all) n.delete(i.communityId); else n.add(i.communityId); }); return n; })}>
                  {g.items.every((i) => selected.has(i.communityId)) ? 'Clear' : `Select all ${g.items.length}`}
                </button>
              </div>
              {open && (
                <div className="border-t" style={{ borderColor: 'rgba(0,0,0,.06)' }}>
                  {g.items.map((o) => {
                    const on = selected.has(o.communityId);
                    return (
                      <button key={o.communityId} onClick={() => toggle(o.communityId)}
                        className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-neutral-50"
                        style={{ borderColor: 'rgba(0,0,0,.04)' }}>
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
                          style={{ background: on ? GREEN : '#fff', borderColor: on ? GREEN : 'rgba(0,0,0,.2)' }}>
                          {on && <Check size={13} strokeWidth={3} className="text-white" />}
                        </span>
                        <span className="flex-1 text-[14px] font-medium" style={{ color: INK }}>{o.nameEn}</span>
                        {o.nameAr && <span className="text-[13px]" dir="rtl" style={{ color: '#A6B0A9' }}>{o.nameAr}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur" style={{ borderColor: 'rgba(0,0,0,.08)' }}>
        <div className="mx-auto flex max-w-2xl gap-3">
          <button onClick={back} className="rounded-2xl border bg-white px-6 py-3 text-sm font-semibold" style={{ borderColor: 'rgba(0,0,0,.12)' }}>Cancel</button>
          <button onClick={onSave} disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-60"
            style={{ background: GREEN_DARK }}>
            {saving && <Loader2 size={15} className="animate-spin" />} Save · {selected.size} areas
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Card ② · Your team ──────────────────────────────────────────────────── */

function TeamCard({ status, absorb, back }: CardProps) {
  const [techs, setTechs] = useState<Tech[] | null>(null);
  const t = status.cards.team;

  useEffect(() => { apiGet<Tech[]>('/service-provider/technicians').then(setTechs); }, []);

  const patch = async (tech: Tech, changes: { isLeadCapable?: boolean; skillCategories?: string[] }) => {
    setTechs((list) => list?.map((x) => x.id === tech.id
      ? { ...x, isLeadCapable: changes.isLeadCapable ?? x.isLeadCapable, skills: changes.skillCategories ?? x.skills }
      : x) ?? null);
    absorb(await apiPatch<JobReadyStatus>(`/service-provider/technicians/${tech.id}/profile`, changes));
  };

  if (!techs) return <CardSkeleton back={back} title="Your team" />;

  return (
    <div className="mx-auto max-w-2xl">
      <CardHeader title="Your team" sub="Jobs go to skilled, free, lead-capable crews" onBack={back}
        right={<span className="mt-2 hidden items-center gap-1 text-xs sm:flex" style={{ color: '#8B978F' }}><Check size={12} /> Saves as you go</span>} />

      <div className="mb-4 rounded-2xl border p-4" style={{ background: '#FEF9EC', borderColor: '#F2E3B8' }}>
        <p className="text-[13px] leading-relaxed" style={{ color: '#7C5A10' }}>
          Each category you offer needs <b>at least one lead-capable technician</b> with that skill.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <span className="rounded-full border bg-white px-3 py-1 text-[12px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.08)', color: INK }}>{t.activeTechnicians} technician{t.activeTechnicians === 1 ? '' : 's'}</span>
          <span className="rounded-full border bg-white px-3 py-1 text-[12px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.08)', color: INK }}>{t.leadCapable} lead-capable</span>
          {t.missingCategories.map((m) => (
            <span key={m} className="rounded-full px-3 py-1 text-[12px] font-bold" style={{ background: '#FCE8E6', color: '#B42318' }}>Missing: {catLabel(m)}</span>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {techs.map((tech) => {
          const needsSkill = tech.skills.length === 0;
          const needsPhoto = !tech.photoUrl;
          return (
            <div key={tech.id} className="rounded-2xl bg-white p-4" style={{ boxShadow: 'var(--shadow-sm)', border: needsSkill ? '1px solid #F2D9A6' : '1px solid transparent' }}>
              <div className="flex items-center gap-3">
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  style={{ background: needsPhoto ? '#FDF3DC' : '#E3F2EA', color: needsPhoto ? '#9A6A00' : GREEN_DARK, border: needsPhoto ? '1.5px dashed #E0B75C' : 'none' }}>
                  {needsPhoto ? <Camera size={17} /> : tech.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  {!needsPhoto && <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ background: GREEN }}><Check size={9} strokeWidth={4} /></span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold" style={{ color: INK }}>{tech.name}</p>
                  <p className="text-[12.5px]" style={{ color: needsSkill || needsPhoto ? '#9A6A00' : '#55645B' }}>
                    {needsSkill ? 'Pick at least one skill so they count'
                      : needsPhoto ? 'Add photo — required before their first job'
                      : 'Photo ✓ · ready for jobs'}
                  </p>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <Toggle on={tech.isLeadCapable} onChange={(v) => void patch(tech, { isLeadCapable: v })} label={`${tech.name} lead`} />
                  <span className="text-[9.5px] font-bold tracking-wider" style={{ color: tech.isLeadCapable ? GREEN_DARK : '#A6B0A9' }}>LEAD</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {t.adoptedCategories.map((cat) => {
                  const on = tech.skills.includes(cat);
                  return (
                    <button key={cat}
                      onClick={() => void patch(tech, { skillCategories: on ? tech.skills.filter((s) => s !== cat) : [...tech.skills, cat] })}
                      className="rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors"
                      style={on ? { background: '#E3F2EA', borderColor: GREEN, color: GREEN_DARK } : { background: '#fff', borderColor: 'rgba(0,0,0,.12)', color: '#55645B' }}>
                      {catLabel(cat)}{on && ' ✓'}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[12.5px]" style={{ color: '#8B978F' }}>
        Lead techs are sent as the responsible person on a job — your lead count sets how many jobs run at once.
      </p>

      <Link href="/dashboard/service-provider/team"
        className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-dashed bg-white py-3.5 text-sm font-bold"
        style={{ borderColor: GREEN, color: GREEN_DARK }}>
        <Plus size={16} /> Invite technicians — opens your roster
      </Link>
    </div>
  );
}

/* ── Card ③ · Your vehicles ──────────────────────────────────────────────── */

const VEHICLE_TYPES = [
  { value: 'van', label: 'Van' }, { value: 'pickup', label: 'Pickup' }, { value: 'car', label: 'Car' },
  { value: 'motorbike', label: 'Motorbike' }, { value: 'none_needed', label: 'No vehicle needed' },
];

function VehiclesCard({ status, absorb, back }: CardProps) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('van');
  const [newLabel, setNewLabel] = useState('');
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitValue, setLimitValue] = useState('');
  const [pendingRemove, setPendingRemove] = useState<Vehicle | null>(null);

  const refetch = useCallback(() =>
    apiGet<{ vehicles: Vehicle[] }>('/service-provider/vehicles').then((r) => setVehicles(r.vehicles)), []);
  useEffect(() => { void refetch(); }, [refetch]);

  const f = status.cards.fleet;
  const leads = status.cards.team.leadCapable;

  const add = async () => {
    const r = await apiPost<{ status: JobReadyStatus }>('/service-provider/vehicles',
      { vehicleType: newType, ...(newLabel.trim() ? { label: newLabel.trim() } : {}) });
    absorb(r.status); setAdding(false); setNewLabel(''); void refetch();
  };
  const setActive = async (v: Vehicle, isActive: boolean) => {
    const r = await apiPatch<{ status: JobReadyStatus }>(`/service-provider/vehicles/${v.id}`, { isActive });
    absorb(r.status); void refetch();
  };
  const remove = async (v: Vehicle) => {
    absorb(await apiDelete<JobReadyStatus>(`/service-provider/vehicles/${v.id}`)); void refetch();
  };
  const requestRemove = (v: Vehicle) => {
    const activeLeft = (vehicles ?? []).filter((x) => x.isActive && x.id !== v.id).length;
    if (status.jobReady && activeLeft === 0) { setPendingRemove(v); return; }
    void remove(v);
  };
  const saveLimit = async (val: number | null) => {
    absorb(await apiPatch<JobReadyStatus>('/service-provider/operational-profile', { maxConcurrentJobs: val }));
    setEditingLimit(false);
  };

  if (!vehicles) return <CardSkeleton back={back} title="Your vehicles" />;

  return (
    <div className="mx-auto max-w-2xl">
      <CardHeader title="Your vehicles" sub="Vehicles + lead techs = how many jobs at once" onBack={back} />

      {/* hero: derived capacity */}
      <div className="mb-4 rounded-2xl p-5 text-white" style={{ background: GREEN_DARK }}>
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9FD9BC' }}>Crews on the road at once</p>
        <div className="mt-2 flex items-center gap-5">
          <span className="text-6xl font-extrabold leading-none">{f.effectiveMaxConcurrentJobs}</span>
          <div className="space-y-1 text-[13.5px]">
            <p className="flex items-center gap-2"><Users size={14} className="opacity-70" /> <b>{leads}</b> lead technician{leads === 1 ? '' : 's'}</p>
            <p className="flex items-center gap-2"><Truck size={14} className="opacity-70" /> <b>{f.vehicles}</b> active vehicle{f.vehicles === 1 ? '' : 's'}</p>
            <p className="border-t pt-1 font-semibold" style={{ borderColor: 'rgba(255,255,255,.2)' }}>
              → <b>{f.effectiveMaxConcurrentJobs} crew{f.effectiveMaxConcurrentJobs === 1 ? '' : 's'}</b>{f.maxConcurrentJobs == null && ' — the smaller number wins'}
            </p>
          </div>
        </div>
        <p className="mt-3 rounded-xl px-3.5 py-2.5 text-[13px]" style={{ background: 'rgba(255,255,255,.12)' }}>
          We&apos;ll <b>never</b> book you for more than {f.effectiveMaxConcurrentJobs} job{f.effectiveMaxConcurrentJobs === 1 ? '' : 's'} at the same time.
        </p>
        <div className="mt-2.5 flex items-center justify-between text-[12.5px]">
          <span style={{ color: 'rgba(255,255,255,.75)' }}>More leads in card ② = more crews</span>
          {editingLimit ? (
            <span className="flex items-center gap-2">
              <input type="number" min={1} max={200} value={limitValue} onChange={(e) => setLimitValue(e.target.value)}
                className="w-16 rounded-lg border-0 px-2 py-1 text-center text-sm font-bold" style={{ color: INK }} />
              <button onClick={() => { const n = parseInt(limitValue, 10); if (n >= 1) void saveLimit(n); }} className="font-bold underline">Save</button>
              <button onClick={() => setEditingLimit(false)} className="opacity-75">Cancel</button>
            </span>
          ) : f.maxConcurrentJobs != null ? (
            <span className="flex items-center gap-2">
              <span style={{ color: '#F3D48A' }}>Overridden — derived would be {f.derivedMaxConcurrentJobs}</span>
              <button onClick={() => void saveLimit(null)} className="font-bold underline">Reset</button>
            </span>
          ) : (
            <button onClick={() => { setLimitValue(String(f.effectiveMaxConcurrentJobs || 1)); setEditingLimit(true); }} className="font-bold underline" style={{ color: '#9FD9BC' }}>
              Set a different limit
            </button>
          )}
        </div>
      </div>

      {pendingRemove && (
        <div className="mb-4">
          <RevokeWarning
            body="Removing your last active vehicle takes you below job-ready. Dispatch pauses immediately and resumes when a vehicle is back."
            keepLabel="Keep my vehicle" proceedLabel="Remove anyway"
            onKeep={() => setPendingRemove(null)}
            onProceed={() => { const v = pendingRemove; setPendingRemove(null); if (v) void remove(v); }} />
        </div>
      )}

      <div className="space-y-3">
        {vehicles.map((v) => (
          <div key={v.id} className="flex items-center gap-3 rounded-2xl bg-white p-4" style={{ boxShadow: 'var(--shadow-sm)', opacity: v.isActive ? 1 : 0.55 }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: '#E3F2EA', color: GREEN_DARK }}>
              <Truck size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-bold" style={{ color: INK }}>
                {v.label || VEHICLE_TYPES.find((t) => t.value === v.vehicleType)?.label}
                {!v.isActive && <span className="ml-2 text-[12px] font-medium" style={{ color: '#8B978F' }}>· off the road</span>}
              </p>
              <p className="truncate text-[12.5px]" style={{ color: '#55645B' }}>
                {VEHICLE_TYPES.find((t) => t.value === v.vehicleType)?.label}
                {' · '}{v.categories?.length ? `${v.categories.map(catLabel).join(', ')} only` : 'used for all categories'}
              </p>
            </div>
            <button onClick={() => requestRemove(v)} aria-label="Remove vehicle" className="rounded-lg p-2 text-neutral-300 hover:text-red-600"><Trash2 size={15} /></button>
            <Toggle on={v.isActive} onChange={(on) => {
              if (!on && status.jobReady && vehicles.filter((x) => x.isActive).length === 1) { setPendingRemove(v); return; }
              void setActive(v, on);
            }} label={`${v.label ?? v.vehicleType} active`} />
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-3 rounded-2xl bg-white p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex flex-wrap gap-2">
            {VEHICLE_TYPES.filter((t) => t.value !== 'none_needed').map((t) => (
              <button key={t.value} onClick={() => setNewType(t.value)}
                className="rounded-full border px-3.5 py-1.5 text-[13px] font-semibold"
                style={newType === t.value ? { background: '#E3F2EA', borderColor: GREEN, color: GREEN_DARK } : { borderColor: 'rgba(0,0,0,.12)', color: '#55645B' }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder='Label — "Van 1", plate… (optional)'
              className="flex-1 rounded-xl border px-3.5 py-2.5 text-sm outline-none" style={{ borderColor: 'rgba(0,0,0,.12)' }} />
            <button onClick={() => void add()} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ background: GREEN }}>Add</button>
            <button onClick={() => setAdding(false)} className="rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: 'rgba(0,0,0,.12)' }}><X size={15} /></button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed bg-white py-3.5 text-sm font-bold"
          style={{ borderColor: GREEN, color: GREEN_DARK }}>
          <Plus size={16} /> Add a vehicle
        </button>
      )}

      <p className="mt-3 text-center text-[13px]" style={{ color: '#55645B' }}>
        My team travels without a company vehicle →{' '}
        <button onClick={async () => {
          const r = await apiPost<{ status: JobReadyStatus }>('/service-provider/vehicles', { vehicleType: 'none_needed', label: 'No vehicle needed' });
          absorb(r.status); void refetch();
        }} className="font-bold" style={{ color: GREEN_DARK }}>No vehicle needed</button>
      </p>
    </div>
  );
}

/* ── Card ④ · When you work ──────────────────────────────────────────────── */

const DAY_ORDER = [
  { d: 1, label: 'Mon' }, { d: 2, label: 'Tue' }, { d: 3, label: 'Wed' }, { d: 4, label: 'Thu' },
  { d: 5, label: 'Fri' }, { d: 6, label: 'Sat' }, { d: 0, label: 'Sun' },
];
const HOLIDAY_SUGGESTIONS = [
  { label: 'Eid al-Etihad · 2–3 Dec', startsOn: '2026-12-02', endsOn: '2026-12-03', reason: 'Eid al-Etihad' },
];
const hhmm = (t: string) => t.slice(0, 5);

function HoursCard({ absorb, back }: CardProps) {
  type DayState = { on: boolean; blocks: Array<{ opensAt: string; closesAt: string }> };
  const [days, setDays] = useState<Record<number, DayState> | null>(null);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [pickingDates, setPickingDates] = useState(false);
  const [offStart, setOffStart] = useState(''); const [offEnd, setOffEnd] = useState(''); const [offReason, setOffReason] = useState('');
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(() =>
    apiGet<{ rows: HoursRow[]; timeOff: TimeOff[] }>('/service-provider/working-hours').then(({ rows, timeOff }) => {
      const next: Record<number, DayState> = {};
      for (const { d } of DAY_ORDER) next[d] = { on: false, blocks: [{ opensAt: '08:00', closesAt: '20:00' }] };
      for (const r of rows) {
        const day = next[r.weekday];
        const block = { opensAt: hhmm(r.opensAt), closesAt: hhmm(r.closesAt) };
        if (!day.on) { day.on = true; day.blocks = [block]; } else day.blocks.push(block);
      }
      // fresh SP: prefill the design default Mon–Sat 08:00–20:00 (not yet saved)
      if (rows.length === 0) for (const { d } of DAY_ORDER) if (d !== 0) next[d].on = true;
      setDays(next); setTimeOff(timeOff);
    }), []);
  useEffect(() => { void refetch(); }, [refetch]);

  const save = async () => {
    if (!days) return;
    setSaving(true);
    try {
      const rows = DAY_ORDER.flatMap(({ d }) => days[d].on ? days[d].blocks.map((b) => ({ weekday: d, ...b })) : []);
      absorb(await apiPut<JobReadyStatus>('/service-provider/working-hours', { rows }));
      back();
    } finally { setSaving(false); }
  };
  const addOff = async (payload: { startsOn: string; endsOn: string; reason?: string }) => {
    await apiPost('/service-provider/time-off', payload);
    setPickingDates(false); setOffStart(''); setOffEnd(''); setOffReason('');
    void refetch();
  };

  if (!days) return <CardSkeleton back={back} title="When you work" />;
  const upd = (d: number, fn: (s: DayState) => DayState) => setDays((prev) => prev ? { ...prev, [d]: fn(prev[d]) } : prev);

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <CardHeader title="When you work" sub="Only promise hours you can serve" onBack={back} />

      <div className="space-y-2.5">
        {DAY_ORDER.map(({ d, label }) => {
          const s = days[d];
          return (
            <div key={d} className="rounded-2xl bg-white px-4 py-3" style={{ boxShadow: 'var(--shadow-sm)', opacity: s.on ? 1 : 0.6 }}>
              <div className="flex items-center gap-3">
                <span className="w-10 text-[14px] font-bold" style={{ color: INK }}>{label}</span>
                <Toggle on={s.on} onChange={(on) => upd(d, (x) => ({ ...x, on }))} label={`${label} open`} />
                {s.on ? (
                  <div className="flex flex-1 items-center justify-end gap-1.5">
                    <input type="time" value={s.blocks[0].opensAt} onChange={(e) => upd(d, (x) => ({ ...x, blocks: x.blocks.map((b, i) => i === 0 ? { ...b, opensAt: e.target.value } : b) }))}
                      className="rounded-lg border px-2 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.1)', color: INK }} />
                    <span className="text-neutral-400">–</span>
                    <input type="time" value={s.blocks[0].closesAt} onChange={(e) => upd(d, (x) => ({ ...x, blocks: x.blocks.map((b, i) => i === 0 ? { ...b, closesAt: e.target.value } : b) }))}
                      className="rounded-lg border px-2 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.1)', color: INK }} />
                    {s.blocks.length === 1 && (
                      <button aria-label={`${label} add split shift`} onClick={() => upd(d, (x) => ({ ...x, blocks: [...x.blocks, { opensAt: '13:30', closesAt: '20:00' }] }))}
                        className="ml-1 rounded-lg p-1.5 text-neutral-300 hover:text-neutral-600"><Plus size={15} /></button>
                    )}
                  </div>
                ) : (
                  <span className="flex-1 text-right text-[13px]" style={{ color: '#8B978F' }}>Closed</span>
                )}
              </div>
              {s.on && s.blocks.length > 1 && (
                <div className="mt-2 flex items-center gap-1.5 pl-10">
                  <span className="mr-1 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider" style={{ background: '#EEF0EF', color: '#55645B' }}>SPLIT</span>
                  <input type="time" value={s.blocks[1].opensAt} onChange={(e) => upd(d, (x) => ({ ...x, blocks: x.blocks.map((b, i) => i === 1 ? { ...b, opensAt: e.target.value } : b) }))}
                    className="rounded-lg border px-2 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.1)', color: INK }} />
                  <span className="text-neutral-400">–</span>
                  <input type="time" value={s.blocks[1].closesAt} onChange={(e) => upd(d, (x) => ({ ...x, blocks: x.blocks.map((b, i) => i === 1 ? { ...b, closesAt: e.target.value } : b) }))}
                    className="rounded-lg border px-2 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.1)', color: INK }} />
                  <button onClick={() => upd(d, (x) => ({ ...x, blocks: [x.blocks[0]] }))} className="ml-auto text-[13px] font-semibold" style={{ color: '#B42318' }}>Remove</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-right text-[12px]" style={{ color: '#8B978F' }}>&quot;+&quot; adds a second block to any day</p>

      {/* days off */}
      <h3 className="mb-2 mt-5 text-[14px] font-bold" style={{ color: INK }}>Days off</h3>
      <div className="flex flex-wrap gap-2">
        {timeOff.map((o) => (
          <span key={o.id} className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-white" style={{ background: INK }}>
            {o.reason || 'Time off'} · {new Date(o.startsOn + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}
            {o.endsOn !== o.startsOn && `–${new Date(o.endsOn + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}`}
            <button aria-label="Remove time off" onClick={async () => { await apiDelete(`/service-provider/time-off/${o.id}`); void refetch(); }}><X size={13} /></button>
          </span>
        ))}
        {HOLIDAY_SUGGESTIONS.filter((h) => !timeOff.some((o) => o.startsOn === h.startsOn)).map((h) => (
          <button key={h.startsOn} onClick={() => void addOff(h)}
            className="rounded-full border bg-white px-3.5 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.12)', color: '#55645B' }}>
            + {h.label}
          </button>
        ))}
        <button onClick={() => setPickingDates((v) => !v)} className="rounded-full border bg-white px-3.5 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.12)', color: '#55645B' }}>
          + Pick dates
        </button>
      </div>
      {pickingDates && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <input type="date" value={offStart} onChange={(e) => setOffStart(e.target.value)} className="rounded-lg border px-2.5 py-2 text-[13px]" style={{ borderColor: 'rgba(0,0,0,.12)' }} />
          <span className="text-neutral-400">–</span>
          <input type="date" value={offEnd} onChange={(e) => setOffEnd(e.target.value)} className="rounded-lg border px-2.5 py-2 text-[13px]" style={{ borderColor: 'rgba(0,0,0,.12)' }} />
          <input value={offReason} onChange={(e) => setOffReason(e.target.value)} placeholder="Reason (optional)" className="min-w-32 flex-1 rounded-lg border px-2.5 py-2 text-[13px]" style={{ borderColor: 'rgba(0,0,0,.12)' }} />
          <button disabled={!offStart || !offEnd || offEnd < offStart}
            onClick={() => void addOff({ startsOn: offStart, endsOn: offEnd, ...(offReason.trim() ? { reason: offReason.trim() } : {}) })}
            className="rounded-xl px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: GREEN }}>Add</button>
        </div>
      )}
      <p className="mt-2.5 text-[12.5px]" style={{ color: '#8B978F' }}>We never penalize declared time off.</p>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur" style={{ borderColor: 'rgba(0,0,0,.08)' }}>
        <div className="mx-auto max-w-2xl">
          <button onClick={() => void save()} disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-60" style={{ background: GREEN_DARK }}>
            {saving && <Loader2 size={15} className="animate-spin" />} Save hours
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Card ⑤ · Job rules ──────────────────────────────────────────────────── */

const NOTICE_OPTIONS = [
  { value: 0, label: 'Same-day OK', sub: 'most jobs' },
  { value: 4, label: '4 hours', sub: 'balanced', isDefault: true },
  { value: 24, label: 'Next-day only', sub: 'fewer jobs' },
];

function RulesCard({ status, absorb, back }: CardProps) {
  const r = status.cards.rules;
  const [notice, setNotice] = useState<number>(r.minNoticeHours ?? 4);
  const [saving, setSaving] = useState(false);
  const [editContact, setEditContact] = useState(false);
  const [cName, setCName] = useState(r.opsContactName ?? '');
  const [cPhone, setCPhone] = useState(r.opsContactPhone ?? '');
  const [cWa, setCWa] = useState(r.opsContactWhatsapp);

  const agree = async () => {
    setSaving(true);
    try { absorb(await apiPost<JobReadyStatus>('/service-provider/job-rules/accept', { minNoticeHours: notice })); }
    finally { setSaving(false); }
  };
  const saveContact = async () => {
    await apiPatch('/profiles/service-provider/me', {
      opsContactName: cName.trim(), opsContactPhone: cPhone.trim(), opsContactWhatsapp: cWa,
    });
    absorb(await apiGet<JobReadyStatus>('/service-provider/job-ready'));
    setEditContact(false);
  };

  const bullets = [
    { icon: <AlarmClock size={17} />, body: <><b>Accept new offers within 2 hours</b> — 30 minutes for same-day jobs. After that, the offer moves on.</> },
    { icon: <Route size={17} />, body: <><b>30 minutes of travel time</b> is added between your jobs — no impossible back-to-backs.</> },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <CardHeader title="Job rules" sub="How dispatch works — fair both ways" onBack={back} />

      <div className="space-y-3">
        {bullets.map((b, i) => (
          <div key={i} className="flex items-start gap-3.5 rounded-2xl bg-white p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: '#E3F2EA', color: GREEN_DARK }}>{b.icon}</span>
            <p className="text-[14px] leading-relaxed" style={{ color: INK }}>{b.body}</p>
          </div>
        ))}

        {/* customer queries + ops contact */}
        <div className="rounded-2xl bg-white p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex items-start gap-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: '#E3F2EA', color: GREEN_DARK }}><MessageCircle size={17} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-relaxed" style={{ color: INK }}><b>Reply to customer queries within 2 working hours.</b></p>
              {editContact ? (
                <div className="mt-2.5 space-y-2">
                  <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Contact name" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(0,0,0,.12)' }} />
                  <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="Mobile (05x…)" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(0,0,0,.12)' }} />
                  <label className="flex items-center gap-2 text-[13px]" style={{ color: '#55645B' }}>
                    <Toggle on={cWa} onChange={setCWa} label="WhatsApp" /> Available on WhatsApp
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => void saveContact()} className="rounded-xl px-4 py-2 text-[13px] font-bold text-white" style={{ background: GREEN }}>Save contact</button>
                    <button onClick={() => setEditContact(false)} className="rounded-xl border px-3.5 py-2 text-[13px] font-semibold" style={{ borderColor: 'rgba(0,0,0,.12)' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: '#F3F5F3' }}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: INK }}>
                    {(r.opsContactName ?? 'S P').split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: INK }}>
                    {r.opsContactName ?? 'Add a contact'}{r.opsContactPhone && ` · ${r.opsContactPhone}`}{r.opsContactWhatsapp && r.opsContactPhone && ' · WhatsApp ✓'}
                  </span>
                  <button onClick={() => setEditContact(true)} className="text-[13px] font-bold" style={{ color: GREEN_DARK }}>Edit</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3.5 rounded-2xl bg-white p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: '#E3F2EA', color: GREEN_DARK }}><Shield size={17} /></span>
          <p className="text-[14px] leading-relaxed" style={{ color: INK }}>
            <b>3 emergency passes a month</b> for genuine last-minute cancellations. Beyond that your reliability score drops; repeated no-shows can suspend the account. <b>No cash penalties — ever.</b>
          </p>
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-[14px] font-bold" style={{ color: INK }}>Minimum notice for a new booking</h3>
      <div className="grid grid-cols-3 gap-2.5">
        {NOTICE_OPTIONS.map((o) => {
          const on = notice === o.value;
          return (
            <button key={o.value} onClick={() => setNotice(o.value)}
              className="relative rounded-2xl border-2 bg-white px-2 py-3.5 text-center"
              style={{ borderColor: on ? GREEN : 'rgba(0,0,0,.08)', background: on ? '#F2F9F5' : '#fff' }}>
              {o.isDefault && <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider text-white" style={{ background: on ? GREEN : '#A6B0A9' }}>DEFAULT</span>}
              <span className="block text-[14px] font-bold" style={{ color: on ? GREEN_DARK : INK }}>{o.label}</span>
              <span className="block text-[11.5px]" style={{ color: '#8B978F' }}>{o.sub}</span>
            </button>
          );
        })}
      </div>

      <button onClick={() => void agree()} disabled={saving}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-bold text-white disabled:opacity-60" style={{ background: GREEN_DARK }}>
        {saving && <Loader2 size={16} className="animate-spin" />}
        {r.complete ? 'Update my job rules' : 'I agree — start receiving jobs'}
      </button>
      <p className="mt-2.5 text-center text-[12px]" style={{ color: '#8B978F' }}>
        Timestamped with your account · re-read anytime in Settings
      </p>
    </div>
  );
}

/* ── Skeleton for card sub-views ─────────────────────────────────────────── */

function CardSkeleton({ back, title }: { back: () => void; title: string }) {
  return (
    <div className="mx-auto max-w-2xl">
      <CardHeader title={title} sub="Loading…" onBack={back} />
      <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-white" />)}</div>
    </div>
  );
}
