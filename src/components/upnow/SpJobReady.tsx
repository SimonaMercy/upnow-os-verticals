'use client';

/**
 * "Get Job-Ready" Setup Guide — the SP operational profile (onboarding v3 §3C).
 *
 * Five cards, any order, each independently savable. All completion logic is
 * SERVER-computed: this component renders the `complete` flags returned by
 * GET /service-provider/job-ready and never re-derives a rule. Every mutating
 * endpoint returns the fresh status, so the shell updates after each save.
 *
 * Visuals follow the claude.ai/design project "UpNow SP Onboarding" screens
 * 1m–1v TO THE TOKEN: #F7F8F6 canvas · white cards, border #EEF0EC, radius
 * 14 · icon tiles 38px r11 (#E9F4EE green / #FEF6E7 amber / #F0F2EF grey) ·
 * circled-number titles · desktop rows expand INLINE with a summary strip +
 * black "Open card" button; mobile rows open the card directly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlarmClock, AlertTriangle, Camera, Check, ChevronDown,
  Clock, FileText, Info, Loader2, MapPin, MessageCircle, Plus,
  Route, Search, Shield, Trash2, Truck, Users, X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';

/* ── Types (mirror the backend contract) ─────────────────────────────────── */

export interface JobReadyStatus {
  jobReady: boolean;
  jobReadyAt: string | null;
  cards: {
    coverage: { complete: boolean; zoneCount: number };
    team: {
      complete: boolean; adoptedCategories: string[]; coveredCategories: string[];
      missingCategories: string[]; activeTechnicians: number; leadCapable: number;
      uncoveredServices: { id: number; name: string; category: string }[];
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
interface CoverageOption { communityId: number; nameEn: string; nameAr: string | null; emirate?: string; selected: boolean }
interface Tech { id: number; name: string; status: string; isLeadCapable: boolean; photoUrl: string | null; skills: string[]; serviceSkillIds: number[] }
interface SpService { id: number; name: string; category: string }
interface Vehicle { id: number; vehicleType: string; label: string | null; categories: string[] | null; isActive: boolean }
interface HoursRow { weekday: number; opensAt: string; closesAt: string }
interface TimeOff { id: number; startsOn: string; endsOn: string; reason: string | null }

const CAT_LABELS: Record<string, string> = {
  home_cleaning: 'Cleaning', ac_services: 'AC', plumbing: 'Plumbing',
  electrical: 'Electrical', handyman: 'Handyman', painting: 'Painting',
  pest_control: 'Pest control', car_vehicle: 'Car & vehicle',
  landscaping_outdoor: 'Landscaping', commercial_services: 'Commercial',
};
export const catLabel = (c: string) => CAT_LABELS[c] ?? c.replace(/_/g, ' ');

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

/* Abu Dhabi divisions — names match communities.name_en (migr 0133). */
const AUH_COMMUNITY_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: 'City Centre & Corniche', names: ['Al Markaziyah (Downtown)', 'Corniche Area', 'Al Khalidiyah', 'Al Bateen', 'Al Zaab', 'Al Gurm', 'Madinat Zayed', 'Al Zahiyah (Tourist Club Area)', 'Al Manhal', 'Al Karamah', 'Al Rowdah', 'Al Nahyan', 'Al Dhafrah', 'Al Aman', 'Al Mushrif', 'Hadbat Al Zaafran'] },
  { label: 'Reem & Maryah Islands', names: ['Al Reem Island', 'Al Maryah Island', 'Makers District', 'Reem Hills'] },
  { label: 'Saadiyat Island', names: ['Saadiyat Island', 'Louvre Abu Dhabi District', 'Mamsha Al Saadiyat', 'Grove at Saadiyat', 'Hidd Al Saadiyat', 'Saadiyat Lagoons', 'Saadiyat Reserve'] },
  { label: 'Yas & North Islands', names: ['Yas Island', 'Yas Acres', 'Yas Golf Collection', 'Noya on Yas Island', 'Lea at Yas Island', 'Mayan on Yas Island', 'The Sustainable City – Yas Island', 'Al Fahid Island', 'Al Jubail Island', 'Jubail Island', 'Samaliyah Island', 'Nurai Island', 'Hudayriyat Island'] },
  { label: 'Maqtaa & Grand Mosque', names: ['Al Maqtaa', 'Between Two Bridges (Bain Al Jessrain)', 'Bloom Gardens', 'Capital Centre'] },
  { label: 'Khalifa City & Al Raha', names: ['Khalifa City', 'Masdar City', 'Al Raha Beach', 'Al Raha Gardens', 'Al Raha Lofts', 'Al Reef'] },
  { label: 'Mussafah & Mainland South', names: ['Mussafah', 'ICAD (Industrial City of Abu Dhabi)', 'Mohammed Bin Zayed City (MBZ City)', 'Shakhbout City', 'Baniyas', 'Bloom Living', 'Al Wathba', 'Al Shamkha', 'Al Reeman'] },
  { label: 'KIZAD & North', names: ['Kizad', 'Al Ghadeer'] },
];

/* Sharjah divisions — names match communities.name_en (migr 0134). */
const SHJ_COMMUNITY_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: 'City Centre & Corniche', names: ['Rolla', 'Al Gharb', 'Al Shuwaihean', 'Al Mareija', 'Al Jubail', 'Al Layyah', 'Al Sharq', 'Al Gulaya', 'Al Qasimia', 'Al Yarmook', 'Al Mahatta', 'Abu Shagara', 'Al Manakh', 'Al Ghafia', 'Al Fisht'] },
  { label: 'Al Majaz & Al Khan', names: ['Al Majaz', 'Al Khan', 'Al Taawun', 'Al Nud', 'Al Nahda (Sharjah)'] },
  { label: 'Central Residential', names: ['Al Falaj', 'Al Goaz', 'Al Khezamia', 'Bu Tina', 'Al Nasserya', 'Al Qadisiya', 'Halwan', 'Bukhamseen', 'Al Ramla', 'Al Ramtha', 'Al Hazana', 'Al Jazzat', 'Al Azra', 'Al Darari', 'Wasit'] },
  { label: 'New Sharjah & University City', names: ['Muwaileh', 'University City', 'Al Qarayen', 'Al Nouf', 'Al Zahia', 'Aljada', 'Al Rahmaniya', 'Nasma Residences', 'Sharjah Sustainable City', 'Al Suyoh', 'Al Tai', 'Tilal City'] },
  { label: 'Industrial & North', names: ['Al Sajaa Industrial', 'Sajaa', 'Al Hamriyah', 'Hamriyah Free Zone'] },
];

/* Ajman divisions (migr 0134). */
const AJM_COMMUNITY_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: 'Ajman City & Corniche', names: ['Ajman Corniche', 'Al Bustan', 'Al Rumaila', 'Al Owan', 'Al Rashidiya (Ajman)', 'Al Nuaimiya', 'Musheiref'] },
  { label: 'Central Ajman', names: ['Al Rawda', 'Al Mowaihat', 'Al Hamidiya', 'Al Zahra', 'Al Jurf', 'Al Muntazi Park Area', 'Ajman Industrial Area', 'Al Helio'] },
  { label: 'Emirates Road & South', names: ['Ajman Uptown', 'Al Amerah', 'Al Ittihad Village', 'Al Tallah', 'Al Yasmeen', 'Al Zahya', 'City of Arabia', 'Emirates City', 'Garden City'] },
  { label: 'Manama & Masfout', names: ['Al Manama', 'Masfout'] },
];

/* Umm Al Quwain divisions (migr 0134). */
const UAQ_COMMUNITY_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: 'UAQ City', names: ['Old Town (UAQ)', 'Al Raas (UAQ)', 'Al Khor', 'Al Maidan', 'Al Haditha', 'Al Raudah', 'Al Surra', 'Al Aahad', 'Al Salamah', 'Al Humrah', 'Umm Al Quwain Free Trade Zone'] },
  { label: 'Coast & Marina', names: ['Um Al Quwain Marina', 'White Bay', 'Barracuda Beach Resort Area', 'Dreamland Area'] },
  { label: 'Falaj Al Mualla', names: ['Falaj Al Mualla'] },
];

/* Ras Al Khaimah divisions (migr 0134). */
const RAK_COMMUNITY_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: 'RAK City & Nakheel', names: ['Al Nakheel', 'Al Hudaibah', 'Al Mairid', 'Al Mamourah', 'Dafan Al Nakheel', 'Julphar', 'Al Karama (RAK)', 'Al Qurm', 'Ras Al Khaimah City Centre', 'Khuzam'] },
  { label: 'Al Dhait & Inland', names: ['Al Dhait', 'Al Dhait North', 'Al Dhait South', 'Al Turfa', 'Al Seer', 'Seih Al Uraibi', 'Yasmin Village', 'Al Kharran', 'Digdaga'] },
  { label: 'Mina Al Arab & Coast', names: ['Mina Al Arab', 'Hayat Island', 'Bay Village', 'Cove by RAK Properties'] },
  { label: 'Al Hamra & Marjan', names: ['Al Hamra Village', 'Al Hamra Mall Area', 'Al Jazeera Al Hamra', 'Al Marjan Island', 'Waldorf Astoria Residences'] },
  { label: 'North & Mountains', names: ['Al Rams', 'Ghalilah', "Sha'am", 'Wadi Shah', 'Jebel Jais area'] },
];

/* Fujairah divisions (migr 0134). */
const FUJ_COMMUNITY_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: 'Fujairah City', names: ['Fujairah City Centre', 'Al Faseel', 'Al Gurfa', 'Merashid', 'Zubarah', 'Sakamkam', 'Fujairah Free Zone', 'Rugaylat', 'Al Hail (Fujairah)', 'Al Hayl Industrial'] },
  { label: 'East Coast North', names: ['Al Aqah', 'Al Bidyah', 'Dadna', 'Sharm', 'Mirbah', 'Qidfa'] },
  { label: 'Masafi & Inland', names: ['Masafi', 'Al Tawyeen'] },
];

/* Per-city division sets — keys match emirates.name_en from the coverage API.
   A city without one renders as a single flat group named after the city. */
const CITY_GROUPS: Record<string, Array<{ label: string; names: string[] }>> = {
  Dubai: COMMUNITY_GROUPS,
  'Abu Dhabi': AUH_COMMUNITY_GROUPS,
  Sharjah: SHJ_COMMUNITY_GROUPS,
  Ajman: AJM_COMMUNITY_GROUPS,
  'Umm Al Quwain': UAQ_COMMUNITY_GROUPS,
  'Ras Al Khaimah': RAK_COMMUNITY_GROUPS,
  Fujairah: FUJ_COMMUNITY_GROUPS,
};

const groupOf = (o: { nameEn: string; emirate?: string }) => {
  const city = o.emirate ?? 'Dubai';
  const divisions = CITY_GROUPS[city];
  if (!divisions) return city;
  return divisions.find((g) => g.names.includes(o.nameEn))?.label ?? `Outer ${city}`;
};

/* ── Design tokens (from the .dc.html, screens 1m–1v) ────────────────────── */

const GREEN = '#0B7A4E';
const GREEN_DARK = '#08603D';
const INK = '#182420';
const MUTE = '#55645B';
const FAINT = '#8A968D';
const CARD_BORDER = '1px solid #EEF0EC';
const INNER_BORDER = '1px solid #E4E7E2';
const TINT_GREEN = '#E9F4EE';
const TINT_AMBER = '#FEF6E7';
const TINT_GREY = '#F0F2EF';
const AMBER_TEXT = '#92400E';
const RED = '#B42318';

const card = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: '#fff', border: CARD_BORDER, borderRadius: 14, ...extra,
});

function ProgressRing({ done, total, size = 64, dark = false }: { done: number; total: number; size?: number; dark?: boolean }) {
  const r = size * 26 / 64;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'rgba(255,255,255,.25)' : '#E4E7E2'} strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? '#7FD6A9' : GREEN} strokeWidth={7}
        strokeLinecap="round" strokeDasharray={`${(done / total) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="55%" textAnchor="middle" fontSize={15} fontWeight={700} fill={dark ? '#fff' : INK}>{done}/{total}</text>
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
    <div className="rounded-[14px] border p-4" style={{ background: '#FEF7EA', borderColor: '#F2D9A6' }}>
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: '#C77D0A' }}>
          <AlertTriangle size={16} className="text-white" />
        </span>
        <div>
          <p className="text-sm font-bold" style={{ color: '#7C3E06' }}>You&apos;ll stop receiving new jobs until this is fixed</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: '#8A5A1E' }}>{body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onKeep} className="rounded-[10px] px-4 py-2 text-sm font-semibold text-white" style={{ background: GREEN }}>{keepLabel}</button>
            <button onClick={onProceed} className="rounded-[10px] border bg-white px-4 py-2 text-sm font-semibold" style={{ color: RED, borderColor: '#E5D5C0' }}>{proceedLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// onBack is accepted (cards still pass their reset callback) but no arrow is
// rendered — sections live under always-visible sub-tabs, so there is no
// "list" to go back to.
function CardHeader({ title, sub, right }: { title: string; sub: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[19px] font-bold tracking-tight" style={{ color: INK }}>{title}</h2>
        <p className="text-[13px]" style={{ color: MUTE }}>{sub}</p>
      </div>
      {right}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */

// Team is NOT a Rules section — skills live with the roster in Settings →
// Team (SpTeamSkills below) so "Team" exists in exactly one place.
type View = 'coverage' | 'vehicles' | 'hours' | 'rules';

const CARD_TABS: { key: View; label: string; icon: typeof MapPin }[] = [
  { key: 'coverage', label: 'Coverage', icon: MapPin },
  { key: 'vehicles', label: 'Vehicles', icon: Truck },
  { key: 'hours', label: 'Hours', icon: Clock },
  { key: 'rules', label: 'Job rules', icon: FileText },
];

/** Per-section completion state driving the sub-tab pills. */
const cardStates = (s: JobReadyStatus): Record<View, 'done' | 'progress' | 'todo'> => ({
  coverage: s.cards.coverage.complete ? 'done' : 'todo',
  vehicles: s.cards.fleet.complete ? 'done' : s.cards.fleet.vehicles > 0 ? 'progress' : 'todo',
  hours: s.cards.hours.complete ? 'done' : 'todo',
  rules: s.cards.rules.complete ? 'done' : 'todo',
});

export function SpJobReady() {
  const router = useRouter();
  const [status, setStatus] = useState<JobReadyStatus | null>(null);
  // Every section is a directly-open sub-tab — no list/expand indirection.
  const [view, setView] = useState<View>('coverage');
  // Bumped to remount the active card: "Cancel" resets edits and a completed
  // save re-reads fresh server state.
  const [remount, setRemount] = useState(0);
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
      .then((s) => {
        prevReady.current = s.jobReady;
        setStatus(s);
        // Land on the ?card= deep link when given, else the first unfinished
        // section so a new SP configures in order.
        const param = new URLSearchParams(window.location.search).get('card');
        if (param && CARD_TABS.some((t) => t.key === param)) { setView(param as View); return; }
        const st = cardStates(s);
        const firstTodo = CARD_TABS.find((t) => st[t.key] !== 'done');
        if (firstTodo) setView(firstTodo.key);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  const selectCard = (k: View) => {
    setView(k);
    setRemount((r) => r + 1);
    // Keep the active section in the URL (?card=) — refresh-safe + deep-linkable.
    const url = new URL(window.location.href);
    url.searchParams.set('card', k);
    window.history.replaceState(null, '', url.toString());
  };

  if (error) return <div className="rounded-[14px] bg-white p-6 text-sm" style={{ border: CARD_BORDER, color: RED }}>{error}</div>;
  if (!status) {
    return (
      <div className="mx-auto max-w-3xl space-y-2.5">
        {[...Array(6)].map((_, i) => <div key={i} className="h-[70px] animate-pulse rounded-[14px] bg-white" style={{ border: CARD_BORDER }} />)}
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

  const states = cardStates(status);
  const common = { status, absorb, back: () => setRemount((r) => r + 1) };

  // One-line context per section, shown under the sub-tabs.
  const hints: Record<View, string> = {
    coverage: 'Wider area = more jobs. A booking must fall inside one of your areas to reach you.',
    vehicles: "We'll never book you for more than your crew count at the same time.",
    hours: 'Only promise hours you can serve — declared time off is never penalized.',
    rules: 'Fair both ways: offers expire after 2 hours, travel time is padded, 3 emergency passes a month.',
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* progress header (1m) */}
      <div className="flex items-center gap-5 px-6 py-5" style={status.jobReady ? { ...card(), background: GREEN_DARK, border: 'none', color: '#fff' } : card()}>
        <ProgressRing done={doneCount} total={5} dark={status.jobReady} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-bold tracking-tight">{status.jobReady ? 'You’re job-ready ✓' : 'Get job-ready'}</h1>
          <p className="mt-0.5 text-[13.5px] leading-snug" style={{ color: status.jobReady ? 'rgba(255,255,255,.85)' : MUTE }}>
            {status.jobReady
              ? 'Bookings in your areas reach you. These five sections are now your settings — change anything, anytime.'
              : `${doneCount} of 5 done — bookings unlock automatically when the last section completes. Any order, ~10 minutes total.`}
          </p>
        </div>
        {!status.jobReady && leftLabels.length > 0 && (
          <div className="hidden text-right text-[12px] sm:block" style={{ color: FAINT }}>
            Left to do<br />
            <b className="text-[13px]" style={{ color: INK }}>{leftLabels.join(' · ')}</b>
          </div>
        )}
      </div>

      {/* Section sub-tabs — every editor one click away, open directly below
          (replaces the old collapsed rows + "Open card" indirection). Same
          construction as the RP/SP settings tab bars so tab bars read as one
          system across both portals. */}
      <div className="mt-4 flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm border border-[#e8e6e0]">
        {CARD_TABS.map(({ key, label, icon: Icon }) => {
          const active = view === key;
          const st = states[key];
          return (
            <button key={key} onClick={() => selectCard(key)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                active ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
              }`}>
              <Icon size={14} /> {label}
              {st === 'done'
                ? <Check size={13} strokeWidth={3} className={active ? 'text-white' : 'text-[#2e9f82]'} />
                : <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: st === 'progress' ? '#C77D0A' : active ? 'rgba(255,255,255,.6)' : '#C7CFC8' }} />}
            </button>
          );
        })}
      </div>
      <p className="mb-4 mt-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: MUTE }}>
        <Info size={13} className="shrink-0" style={{ color: FAINT }} /> {hints[view]}
      </p>

      {/* Active section — the editor itself, open and ready. Remount key makes
          Cancel reset edits and a save re-read fresh state. */}
      <div key={remount}>
        {view === 'coverage' && <CoverageCard {...common} />}
        {view === 'vehicles' && <VehiclesCard {...common} />}
        {view === 'hours' && <HoursCard {...common} />}
        {view === 'rules' && <RulesCard {...common} />}
      </div>
    </div>
  );
}

/* ── Flip celebration (1t) ───────────────────────────────────────────────── */

function FlipCelebration({ status, onDashboard, onSettings }: { status: JobReadyStatus; onDashboard: () => void; onSettings: () => void }) {
  const c = status.cards;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="relative overflow-hidden rounded-[16px] p-8 text-center text-white sm:p-12" style={{ background: GREEN_DARK }}>
        {/* confetti dots (design: #F5C451 / #7FD6A9 squares) */}
        {[['12%', '18%', '#F5C451'], ['85%', '14%', '#7FD6A9'], ['8%', '68%', '#7FD6A9'], ['90%', '60%', '#F5C451'], ['22%', '85%', '#F5C451'], ['74%', '88%', '#7FD6A9']].map(([l, t, bg], i) => (
          <span key={i} className="absolute h-2 w-2 rounded-[2px]" style={{ left: l as string, top: t as string, background: bg as string, transform: `rotate(${i * 33}deg)` }} />
        ))}
        <div className="text-5xl">🎉</div>
        <h1 className="mt-4 text-[44px] font-extrabold leading-none tracking-tight sm:text-[56px]">You&apos;re job-ready</h1>
        <p className="mx-auto mt-3 max-w-md text-[15.5px]" style={{ color: 'rgba(255,255,255,.85)' }}>
          Bookings in your {c.coverage.zoneCount} areas now reach you. First offers usually arrive within days.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {[`${c.coverage.zoneCount} areas`, `${c.fleet.effectiveMaxConcurrentJobs} crew${c.fleet.effectiveMaxConcurrentJobs === 1 ? '' : 's'} at once`, `${c.hours.daysConfigured} days a week`].map((chip) => (
            <span key={chip} className="rounded-full px-3.5 py-1.5 text-[13px] font-semibold" style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.22)' }}>{chip}</span>
          ))}
        </div>
        <button onClick={onDashboard} className="mt-7 w-full rounded-[13px] bg-white py-3.5 text-[15px] font-bold sm:w-auto sm:px-12" style={{ color: INK }}>
          Go to dashboard
        </button>
        <p className="mt-4 text-[12px]" style={{ color: 'rgba(255,255,255,.7)' }}>
          These 5 cards now live as your <button onClick={onSettings} className="underline">settings</button> — change anything, anytime.
        </p>
      </div>
    </div>
  );
}

/* ── Card ① · Where you work (1o) ────────────────────────────────────────── */

interface CardProps { status: JobReadyStatus; absorb: (s: JobReadyStatus) => void; back: () => void;
  /** When embedded in the onboarding wizard, save bars render inline (not fixed) and the Cancel button is hidden. */
  embedded?: boolean }

const cityOf = (o: CoverageOption) => o.emirate ?? 'Dubai';

export function CoverageCard({ status, absorb, back, embedded }: CardProps) {
  const [options, setOptions] = useState<CoverageOption[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  // Active city tab — every emirate the SP serves gets its own top-level tab
  // so a second city (e.g. Abu Dhabi) is never buried under Dubai's groups.
  const [city, setCity] = useState<string>('Dubai');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    apiGet<CoverageOption[]>('/service-provider/coverage/options').then((rows) => {
      setOptions(rows);
      setSelected(new Set(rows.filter((r) => r.selected).map((r) => r.communityId)));
      // Land on the first city that has a selection, else the first served city.
      // All division dropdowns start CLOSED — the "n of m" header counts show
      // where selections live; expanding is one click.
      const cityList = [...new Set(rows.map(cityOf))];
      setCity(cityList.find((c) => rows.some((r) => r.selected && cityOf(r) === c)) ?? cityList[0] ?? 'Dubai');
    });
  }, []);

  const cities = useMemo(() => {
    if (!options) return [];
    return [...new Set(options.map(cityOf))];
  }, [options]);

  const groups = useMemo(() => {
    if (!options) return [];
    const q = query.trim().toLowerCase();
    // Searching looks across every served city; browsing shows the active city.
    const pool = q
      ? options.filter((o) => o.nameEn.toLowerCase().includes(q))
      : options.filter((o) => cityOf(o) === city);
    const byGroup = new Map<string, CoverageOption[]>();
    for (const o of pool) {
      const g = groupOf(o);
      byGroup.set(g, [...(byGroup.get(g) ?? []), o]);
    }
    // Order: each served city's divisions (then its Outer bucket), cities in
    // server order; a city without curated divisions is its own single group.
    const order = [...new Set(options.map(cityOf))].flatMap((c) =>
      CITY_GROUPS[c] ? [...CITY_GROUPS[c].map((g) => g.label), `Outer ${c}`] : [c]);
    return [...new Set(order)].filter((g) => byGroup.has(g)).map((g) => ({ label: g, items: byGroup.get(g)! }));
  }, [options, query, city]);

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
    <div className={`mx-auto max-w-2xl ${embedded ? '' : 'pb-24'}`}>
      <CardHeader title="Where you work" sub="Wider area = more jobs. Change anytime." onBack={back} />

      {/* City tabs — one per served emirate, with that city's selected count */}
      {cities.length > 1 && (
        <div className="mb-3 flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm border border-[#e8e6e0]">
          {cities.map((c) => {
            const cityOpts = options.filter((o) => cityOf(o) === c);
            const selInCity = cityOpts.filter((o) => selected.has(o.communityId)).length;
            const active = c === city && !query.trim();
            return (
              <button key={c}
                onClick={() => {
                  setCity(c); setQuery('');
                  setOpenGroups(new Set()); // divisions start closed
                }}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  active ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
                }`}>
                {c}
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                  active ? 'bg-white/20 text-white' : selInCity ? 'bg-[#2e9f82]/10 text-[#2e9f82]' : 'bg-[#f4f3ef] text-[#9b9890]'
                }`}>
                  {selInCity}/{cityOpts.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="relative mb-3">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: FAINT }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={cities.length > 1 ? 'Search all communities…' : 'Search communities…'}
          className="w-full rounded-[12px] bg-white py-3 pl-10 pr-4 text-sm outline-none"
          style={{ border: INNER_BORDER, color: INK }} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setSelected((s) => {
            const n = new Set(s);
            options.filter((o) => cityOf(o) === city).forEach((o) => n.add(o.communityId));
            return n;
          })}
          className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold" style={{ border: '1px solid #D7DCD7', color: INK }}>
          Select all {city}
        </button>
        <span className="rounded-full px-3.5 py-1.5 text-[13px] font-bold text-white" style={{ background: INK }}>
          {selected.size} areas
        </span>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[13px] font-semibold" style={{ color: RED }}>Clear all</button>
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
          // A city with a single group (e.g. Abu Dhabi) renders open directly.
          const open = openGroups.has(g.label) || Boolean(query.trim()) || groups.length === 1;
          const allOn = g.items.every((i) => selected.has(i.communityId));
          return (
            <div key={g.label} className="overflow-hidden" style={card({ background: selCount ? '#F6FAF7' : '#fff' })}>
              <div className="flex w-full items-center gap-2 px-4 py-3">
                <button className="flex flex-1 items-center gap-2 text-left"
                  onClick={() => setOpenGroups((s) => { const n = new Set(s); if (n.has(g.label)) n.delete(g.label); else n.add(g.label); return n; })}>
                  <ChevronDown size={15} className="transition-transform" style={{ color: FAINT, transform: open ? 'none' : 'rotate(-90deg)' }} />
                  <span className="text-[14px] font-bold" style={{ color: INK }}>{g.label}</span>
                  <span className="text-[12.5px]" style={{ color: FAINT }}>· {selCount} of {g.items.length}</span>
                </button>
                <button className="text-[13px] font-semibold" style={{ color: GREEN }}
                  onClick={() => setSelected((s) => { const n = new Set(s); g.items.forEach((i) => { if (allOn) n.delete(i.communityId); else n.add(i.communityId); }); return n; })}>
                  {allOn ? 'Clear' : `Select all ${g.items.length}`}
                </button>
              </div>
              {open && (
                <div className="border-t" style={{ borderColor: '#EEF0EC', background: '#fff' }}>
                  {g.items.map((o) => {
                    const on = selected.has(o.communityId);
                    return (
                      <button key={o.communityId} onClick={() => toggle(o.communityId)}
                        className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0"
                        style={{ borderColor: '#F3F5F2' }}>
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px]"
                          style={{ background: on ? GREEN : '#fff', border: on ? `1px solid ${GREEN}` : '1px solid #C7CFC8' }}>
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

      {/* save bar — inline inside the onboarding wizard, sticky in Settings */}
      <div className={embedded ? 'mt-5 border-t pt-4' : 'fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur'} style={{ borderColor: '#E4E7E2' }}>
        <div className="mx-auto flex max-w-2xl gap-3">
          {!embedded && <button onClick={back} className="rounded-[12px] bg-white px-6 py-3 text-sm font-semibold" style={{ border: '1px solid #D7DCD7', color: INK }}>Cancel</button>}
          <button onClick={onSave} disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-[12px] py-3 text-sm font-bold text-white disabled:opacity-60"
            style={{ background: GREEN_DARK }}>
            {saving && <Loader2 size={15} className="animate-spin" />} Save · {selected.size} areas
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Card ② · Your team (1p) ─────────────────────────────────────────────── */

export function TeamCard({ status, absorb, back, hideGapChips }: CardProps & { hideGapChips?: boolean }) {
  const [techs, setTechs] = useState<Tech[] | null>(null);
  const [services, setServices] = useState<SpService[]>([]);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const t = status.cards.team;

  useEffect(() => {
    apiGet<Tech[]>('/service-provider/technicians').then(setTechs);
    apiGet<unknown>('/service-provider/services')
      .then((d) => setServices((Array.isArray(d) ? d : []) as SpService[]))
      .catch(() => {});
  }, []);

  // A technician needs no login to be dispatchable — the roster row is what the
  // matcher reads. Adding here (rather than only via invite, which creates the
  // row on ACCEPT) is what makes this step completable during setup.
  const addTechnician = async () => {
    const name = newName.trim();
    if (!name || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    try {
      absorb(await apiPost<JobReadyStatus>('/service-provider/technicians', {
        name,
        phone: newPhone.trim() || undefined,
        isLeadCapable: true,
      }));
      setTechs(await apiGet<Tech[]>('/service-provider/technicians'));
      setNewName('');
      setNewPhone('');
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not add the technician.');
    } finally {
      setAddBusy(false);
    }
  };

  const removeTechnician = async (tech: Tech) => {
    setAddError(null);
    try {
      absorb(await apiDelete<JobReadyStatus>(`/service-provider/technicians/${tech.id}`));
      setTechs((list) => list?.filter((x) => x.id !== tech.id) ?? null);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not remove the technician.');
    }
  };

  const byCategory = useMemo(() => {
    const m = new Map<string, SpService[]>();
    for (const s of services) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return m;
  }, [services]);

  const patchServices = async (tech: Tech, ids: number[]) => {
    const cats = [...new Set(services.filter((s) => ids.includes(s.id)).map((s) => s.category))];
    setTechs((list) => list?.map((x) => x.id === tech.id ? { ...x, serviceSkillIds: ids, skills: cats } : x) ?? null);
    absorb(await apiPatch<JobReadyStatus>(`/service-provider/technicians/${tech.id}/profile`, { skillServiceIds: ids }));
  };
  const patchLead = async (tech: Tech, isLeadCapable: boolean) => {
    setTechs((list) => list?.map((x) => x.id === tech.id ? { ...x, isLeadCapable } : x) ?? null);
    absorb(await apiPatch<JobReadyStatus>(`/service-provider/technicians/${tech.id}/profile`, { isLeadCapable }));
  };

  if (!techs) return <CardSkeleton back={back} title="Your team" />;

  return (
    <div className="mx-auto max-w-2xl">
      <CardHeader title="Your team" sub="Jobs go to skilled, free, lead-capable crews" onBack={back}
        right={<span className="mt-2 hidden items-center gap-1 text-[12px] sm:flex" style={{ color: FAINT }}><Check size={12} /> Saves as you go</span>} />

      <div className="mb-4 rounded-[14px] border p-4" style={{ background: '#FEF9EC', borderColor: '#F2E3B8' }}>
        <p className="text-[13px] leading-relaxed" style={{ color: '#7C5A10' }}>
          Each service you list needs <b>at least one lead-capable technician</b>{' '}skilled in that exact service —
          a technician skilled in Regular Cleaning doesn&apos;t cover Deep Cleaning unless they&apos;re picked for both.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold" style={{ border: '1px solid rgba(0,0,0,.08)', color: INK }}>{t.activeTechnicians} technician{t.activeTechnicians === 1 ? '' : 's'}</span>
          <span className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold" style={{ border: '1px solid rgba(0,0,0,.08)', color: INK }}>{t.leadCapable} lead-capable</span>
          {!hideGapChips && t.uncoveredServices.map((s) => (
            <span key={s.id} className="rounded-full px-3 py-1 text-[12px] font-bold" style={{ background: '#FDF1EF', color: RED, border: '1px solid #F4CFC9' }}>No tech for: {s.name}</span>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {techs.map((tech) => {
          const needsSkill = tech.serviceSkillIds.length === 0 && tech.skills.length === 0;
          const needsPhoto = !tech.photoUrl;
          return (
            <div key={tech.id} className="p-4" style={card({ border: needsSkill ? '1.5px solid #EBD9B4' : CARD_BORDER })}>
              <div className="flex items-center gap-3">
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  style={{ background: needsPhoto ? TINT_AMBER : TINT_GREEN, color: needsPhoto ? '#C77D0A' : GREEN, border: needsPhoto ? '1.5px dashed #E0B75C' : 'none' }}>
                  {needsPhoto ? <Camera size={17} /> : tech.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  {!needsPhoto && <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ background: GREEN }}><Check size={9} strokeWidth={4} /></span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold" style={{ color: INK }}>{tech.name}</p>
                  <p className="text-[12.5px]" style={{ color: needsSkill || needsPhoto ? AMBER_TEXT : MUTE }}>
                    {needsSkill ? 'Pick at least one service so they count'
                      : needsPhoto ? 'Add photo — required before their first job'
                      : 'Photo ✓ · ready for jobs'}
                  </p>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <Toggle on={tech.isLeadCapable} onChange={(v) => void patchLead(tech, v)} label={`${tech.name} lead`} />
                  <span className="text-[9.5px] font-bold tracking-wider" style={{ color: tech.isLeadCapable ? GREEN : '#A6B0A9' }}>LEAD</span>
                </div>
                <button
                  onClick={() => void removeTechnician(tech)}
                  aria-label={`Remove ${tech.name}`}
                  title="Remove from team"
                  className="rounded-[8px] p-1.5 transition-colors hover:bg-black/[.04]"
                  style={{ color: '#A6B0A9' }}>
                  <Trash2 size={15} />
                </button>
              </div>

              {/* skills: category master chip + adopted services as sub-chips */}
              <div className="mt-3 space-y-2.5">
                {t.adoptedCategories.map((cat) => {
                  const catServices = byCategory.get(cat) ?? [];
                  const selInCat = catServices.filter((s) => tech.serviceSkillIds.includes(s.id));
                  const allOn = catServices.length > 0 && selInCat.length === catServices.length;
                  const someOn = selInCat.length > 0;
                  return (
                    <div key={cat}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => {
                            const others = tech.serviceSkillIds.filter((id) => !catServices.some((s) => s.id === id));
                            void patchServices(tech, allOn ? others : [...others, ...catServices.map((s) => s.id)]);
                          }}
                          className="rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors"
                          style={someOn
                            ? { background: TINT_GREEN, border: '1.5px solid rgba(11,122,78,.5)', color: GREEN }
                            : { background: '#fff', border: '1px solid #D7DCD7', color: MUTE }}>
                          {catLabel(cat)}{allOn ? ' ✓' : someOn ? ` · ${selInCat.length}/${catServices.length}` : ''}
                        </button>
                        {catServices.length > 1 && (
                          <span className="text-[11px]" style={{ color: '#A6B0A9' }}>which services?</span>
                        )}
                      </div>
                      {catServices.length > 1 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-3">
                          {catServices.map((s) => {
                            const on = tech.serviceSkillIds.includes(s.id);
                            return (
                              <button key={s.id}
                                onClick={() => void patchServices(tech, on ? tech.serviceSkillIds.filter((id) => id !== s.id) : [...tech.serviceSkillIds, s.id])}
                                className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
                                style={on
                                  ? { background: '#F6FAF7', border: '1px solid #9CCDB4', color: GREEN }
                                  : { background: '#fff', border: '1px solid #E4E7E2', color: FAINT }}>
                                {s.name}{on && ' ✓'}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add a crew member — without this the step is impossible to finish on a
          brand-new account, since invited people only become technicians once
          they accept. */}
      <div className="mt-3 p-4" style={card({ border: techs.length === 0 ? '1.5px solid #9CCDB4' : CARD_BORDER })}>
        <div className="flex items-center gap-2">
          <Users size={15} style={{ color: GREEN }} />
          <p className="text-[14px] font-bold" style={{ color: INK }}>
            {techs.length === 0 ? 'Add your first technician' : 'Add another technician'}
          </p>
        </div>
        <p className="mt-1 text-[12.5px]" style={{ color: MUTE }}>
          They don&apos;t need an account to be sent jobs. You can invite them to their own
          login later from Settings → Team.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addTechnician(); }}
            placeholder="Full name"
            aria-label="Technician full name"
            className="min-w-[180px] flex-1 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            style={{ border: '1px solid #D7DCD7', color: INK }}
          />
          <input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addTechnician(); }}
            placeholder="Mobile (optional)"
            aria-label="Technician mobile number"
            className="min-w-[150px] flex-1 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            style={{ border: '1px solid #D7DCD7', color: INK }}
          />
          <button
            onClick={() => void addTechnician()}
            disabled={!newName.trim() || addBusy}
            className="flex items-center justify-center gap-1.5 rounded-[10px] px-4 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-50"
            style={{ background: GREEN_DARK }}>
            {addBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </div>

        {addError && (
          <p className="mt-2 text-[12.5px] font-medium" style={{ color: RED }}>{addError}</p>
        )}
      </div>

      <p className="mt-3 text-[12.5px]" style={{ color: FAINT }}>
        Lead techs are sent as the responsible person on a job — your lead count sets how many jobs run at once.
      </p>
    </div>
  );
}

/**
 * Standalone skills editor for Settings → Team: the job-ready Team card,
 * self-managing its status so it can live NEXT TO the roster (SpTeamPanel)
 * instead of duplicating "Team" as a Rules section.
 */
export function SpTeamSkills() {
  const [status, setStatus] = useState<JobReadyStatus | null>(null);
  const [remount, setRemount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<JobReadyStatus>('/service-provider/job-ready')
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <div className="rounded-[14px] bg-white p-6 text-sm" style={{ border: CARD_BORDER, color: RED }}>{error}</div>;
  if (!status) {
    return (
      <div className="space-y-2.5">
        {[...Array(3)].map((_, i) => <div key={i} className="h-[70px] animate-pulse rounded-[14px] bg-white" style={{ border: CARD_BORDER }} />)}
      </div>
    );
  }
  return (
    <div key={remount}>
      <TeamCard status={status} absorb={setStatus} back={() => setRemount((r) => r + 1)} hideGapChips />
    </div>
  );
}

/* ── Card ③ · Your vehicles (1q) ─────────────────────────────────────────── */

const VEHICLE_TYPES = [
  { value: 'van', label: 'Van' }, { value: 'pickup', label: 'Pickup' }, { value: 'car', label: 'Car' },
  { value: 'motorbike', label: 'Motorbike' }, { value: 'none_needed', label: 'No vehicle needed' },
];

export function VehiclesCard({ status, absorb, back }: CardProps) {
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
      <div className="mb-4 rounded-[14px] p-5 text-white" style={{ background: GREEN_DARK }}>
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#7FD6A9' }}>Crews on the road at once</p>
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
        <p className="mt-3 rounded-[10px] px-3.5 py-2.5 text-[13px]" style={{ background: 'rgba(255,255,255,.12)' }}>
          We&apos;ll <b>never</b> book you for more than {f.effectiveMaxConcurrentJobs} job{f.effectiveMaxConcurrentJobs === 1 ? '' : 's'} at the same time.
        </p>
        <div className="mt-2.5 flex items-center justify-between text-[12.5px]">
          <span style={{ color: 'rgba(255,255,255,.75)' }}>More lead techs (Team tab) = more crews</span>
          {editingLimit ? (
            <span className="flex items-center gap-2">
              <input type="number" min={1} max={200} value={limitValue} onChange={(e) => setLimitValue(e.target.value)}
                className="w-16 rounded-lg border-0 px-2 py-1 text-center text-sm font-bold" style={{ color: INK }} />
              <button onClick={() => { const n = parseInt(limitValue, 10); if (n >= 1) void saveLimit(n); }} className="font-bold underline">Save</button>
              <button onClick={() => setEditingLimit(false)} className="opacity-75">Cancel</button>
            </span>
          ) : f.maxConcurrentJobs != null ? (
            <span className="flex items-center gap-2">
              <span style={{ color: '#F5C451' }}>Overridden — derived would be {f.derivedMaxConcurrentJobs}</span>
              <button onClick={() => void saveLimit(null)} className="font-bold underline">Reset</button>
            </span>
          ) : (
            <button onClick={() => { setLimitValue(String(f.effectiveMaxConcurrentJobs || 1)); setEditingLimit(true); }} className="font-bold underline" style={{ color: '#7FD6A9' }}>
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

      <div className="space-y-2.5">
        {vehicles.map((v) => (
          <div key={v.id} className="flex items-center gap-3 p-4" style={{ ...card(), opacity: v.isActive ? 1 : 0.55 }}>
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px]" style={{ background: TINT_GREEN, color: GREEN }}>
              <Truck size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-bold" style={{ color: INK }}>
                {v.label || VEHICLE_TYPES.find((t) => t.value === v.vehicleType)?.label}
                {!v.isActive && <span className="ml-2 text-[12px] font-medium" style={{ color: FAINT }}>· off the road</span>}
              </p>
              <p className="truncate text-[12.5px]" style={{ color: MUTE }}>
                {VEHICLE_TYPES.find((t) => t.value === v.vehicleType)?.label}
                {' · '}{v.categories?.length ? `${v.categories.map(catLabel).join(', ')} only` : 'used for all categories'}
              </p>
            </div>
            <button onClick={() => requestRemove(v)} aria-label="Remove vehicle" className="rounded-lg p-2" style={{ color: '#C7CFC8' }}><Trash2 size={15} /></button>
            <Toggle on={v.isActive} onChange={(on) => {
              if (!on && status.jobReady && vehicles.filter((x) => x.isActive).length === 1) { setPendingRemove(v); return; }
              void setActive(v, on);
            }} label={`${v.label ?? v.vehicleType} active`} />
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-2.5 p-4" style={card()}>
          <div className="flex flex-wrap gap-2">
            {VEHICLE_TYPES.filter((t) => t.value !== 'none_needed').map((t) => (
              <button key={t.value} onClick={() => setNewType(t.value)}
                className="rounded-full px-3.5 py-1.5 text-[13px] font-semibold"
                style={newType === t.value
                  ? { background: TINT_GREEN, border: '1.5px solid rgba(11,122,78,.5)', color: GREEN }
                  : { border: '1px solid #D7DCD7', color: MUTE }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder='Label — "Van 1", plate… (optional)'
              className="flex-1 rounded-[10px] px-3.5 py-2.5 text-sm outline-none" style={{ border: INNER_BORDER, color: INK }} />
            <button onClick={() => void add()} className="rounded-[10px] px-5 py-2.5 text-sm font-bold text-white" style={{ background: GREEN }}>Add</button>
            <button onClick={() => setAdding(false)} className="rounded-[10px] px-3 py-2.5 text-sm" style={{ border: '1px solid #D7DCD7', color: MUTE }}><X size={15} /></button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[14px] border border-dashed bg-white py-3.5 text-sm font-bold"
          style={{ borderColor: GREEN, color: GREEN }}>
          <Plus size={16} /> Add a vehicle
        </button>
      )}

      <p className="mt-3 text-center text-[13px]" style={{ color: MUTE }}>
        My team travels without a company vehicle →{' '}
        <button onClick={async () => {
          const r = await apiPost<{ status: JobReadyStatus }>('/service-provider/vehicles', { vehicleType: 'none_needed', label: 'No vehicle needed' });
          absorb(r.status); void refetch();
        }} className="font-bold" style={{ color: GREEN }}>No vehicle needed</button>
      </p>
    </div>
  );
}

/* ── Card ④ · When you work (1r) ─────────────────────────────────────────── */

const DAY_ORDER = [
  { d: 1, label: 'Mon' }, { d: 2, label: 'Tue' }, { d: 3, label: 'Wed' }, { d: 4, label: 'Thu' },
  { d: 5, label: 'Fri' }, { d: 6, label: 'Sat' }, { d: 0, label: 'Sun' },
];
const HOLIDAY_SUGGESTIONS = [
  { label: 'Eid al-Etihad · 2–3 Dec', startsOn: '2026-12-02', endsOn: '2026-12-03', reason: 'Eid al-Etihad' },
];
const hhmm = (t: string) => t.slice(0, 5);

export function HoursCard({ absorb, back, embedded }: CardProps) {
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
  const timeInput = (value: string, onChange: (v: string) => void) => (
    <input type="time" value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-[8px] px-2 py-1.5 text-[13px] font-semibold" style={{ border: INNER_BORDER, background: TINT_GREY, color: INK }} />
  );

  return (
    <div className={`mx-auto max-w-2xl ${embedded ? '' : 'pb-24'}`}>
      <CardHeader title="When you work" sub="Only promise hours you can serve" onBack={back} />

      <div className="space-y-2">
        {DAY_ORDER.map(({ d, label }) => {
          const s = days[d];
          return (
            <div key={d} className="px-4 py-3" style={{ ...card({ border: s.blocks.length > 1 && s.on ? '1.5px solid #C9D4CC' : CARD_BORDER }), opacity: s.on ? 1 : 0.6 }}>
              <div className="flex items-center gap-3">
                <span className="w-10 text-[14px] font-bold" style={{ color: INK }}>{label}</span>
                <Toggle on={s.on} onChange={(on) => upd(d, (x) => ({ ...x, on }))} label={`${label} open`} />
                {s.on ? (
                  <div className="flex flex-1 items-center justify-end gap-1.5">
                    {timeInput(s.blocks[0].opensAt, (v) => upd(d, (x) => ({ ...x, blocks: x.blocks.map((b, i) => i === 0 ? { ...b, opensAt: v } : b) })))}
                    <span style={{ color: FAINT }}>–</span>
                    {timeInput(s.blocks[0].closesAt, (v) => upd(d, (x) => ({ ...x, blocks: x.blocks.map((b, i) => i === 0 ? { ...b, closesAt: v } : b) })))}
                    {s.blocks.length === 1 && (
                      <button aria-label={`${label} add split shift`} onClick={() => upd(d, (x) => ({ ...x, blocks: [...x.blocks, { opensAt: '13:30', closesAt: '20:00' }] }))}
                        className="ml-1 rounded-lg p-1.5" style={{ color: '#C7CFC8' }}><Plus size={15} /></button>
                    )}
                  </div>
                ) : (
                  <span className="flex-1 text-right text-[13px]" style={{ color: FAINT }}>Closed</span>
                )}
              </div>
              {s.on && s.blocks.length > 1 && (
                <div className="mt-2 flex items-center gap-1.5 pl-10">
                  <span className="mr-1 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider" style={{ background: TINT_GREY, color: MUTE }}>SPLIT</span>
                  {timeInput(s.blocks[1].opensAt, (v) => upd(d, (x) => ({ ...x, blocks: x.blocks.map((b, i) => i === 1 ? { ...b, opensAt: v } : b) })))}
                  <span style={{ color: FAINT }}>–</span>
                  {timeInput(s.blocks[1].closesAt, (v) => upd(d, (x) => ({ ...x, blocks: x.blocks.map((b, i) => i === 1 ? { ...b, closesAt: v } : b) })))}
                  <button onClick={() => upd(d, (x) => ({ ...x, blocks: [x.blocks[0]] }))} className="ml-auto text-[13px] font-semibold" style={{ color: RED }}>Remove</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-right text-[12px]" style={{ color: FAINT }}>&quot;+&quot; adds a second block to any day</p>

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
            className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold" style={{ border: '1px solid #D7DCD7', color: MUTE }}>
            + {h.label}
          </button>
        ))}
        <button onClick={() => setPickingDates((v) => !v)} className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold" style={{ border: '1px solid #D7DCD7', color: MUTE }}>
          + Pick dates
        </button>
      </div>
      {pickingDates && (
        <div className="mt-3 flex flex-wrap items-center gap-2 p-3" style={card()}>
          <input type="date" value={offStart} onChange={(e) => setOffStart(e.target.value)} className="rounded-[8px] px-2.5 py-2 text-[13px]" style={{ border: INNER_BORDER }} />
          <span style={{ color: FAINT }}>–</span>
          <input type="date" value={offEnd} onChange={(e) => setOffEnd(e.target.value)} className="rounded-[8px] px-2.5 py-2 text-[13px]" style={{ border: INNER_BORDER }} />
          <input value={offReason} onChange={(e) => setOffReason(e.target.value)} placeholder="Reason (optional)" className="min-w-32 flex-1 rounded-[8px] px-2.5 py-2 text-[13px]" style={{ border: INNER_BORDER }} />
          <button disabled={!offStart || !offEnd || offEnd < offStart}
            onClick={() => void addOff({ startsOn: offStart, endsOn: offEnd, ...(offReason.trim() ? { reason: offReason.trim() } : {}) })}
            className="rounded-[10px] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: GREEN }}>Add</button>
        </div>
      )}
      <p className="mt-2.5 text-[12.5px]" style={{ color: FAINT }}>We never penalize declared time off.</p>

      <div className={embedded ? 'mt-5 border-t pt-4' : 'fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur'} style={{ borderColor: '#E4E7E2' }}>
        <div className="mx-auto max-w-2xl">
          <button onClick={() => void save()} disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-[12px] py-3 text-sm font-bold text-white disabled:opacity-60" style={{ background: GREEN_DARK }}>
            {saving && <Loader2 size={15} className="animate-spin" />} Save hours
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Card ⑤ · Job rules (1s) ─────────────────────────────────────────────── */

const NOTICE_OPTIONS = [
  { value: 0, label: 'Same-day OK', sub: 'most jobs' },
  { value: 4, label: '4 hours', sub: 'balanced', isDefault: true },
  { value: 24, label: 'Next-day only', sub: 'fewer jobs' },
];

export function RulesCard({ status, absorb, back }: CardProps) {
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

  const bullet = (icon: React.ReactNode, body: React.ReactNode, extra?: React.ReactNode) => (
    <div className="p-4" style={card()}>
      <div className="flex items-start gap-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: TINT_GREEN, color: GREEN }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-relaxed" style={{ color: INK }}>{body}</p>
          {extra}
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <CardHeader title="Job rules" sub="How dispatch works — fair both ways" onBack={back} />

      <div className="space-y-2.5">
        {bullet(<AlarmClock size={17} />, <><b>Accept new offers within 2 hours</b> — 30 minutes for same-day jobs. After that, the offer moves on.</>)}
        {bullet(<Route size={17} />, <><b>30 minutes of travel time</b> is added between your jobs — no impossible back-to-backs.</>)}
        {bullet(<MessageCircle size={17} />, <><b>Reply to customer queries within 2 working hours.</b></>, editContact ? (
          <div className="mt-2.5 space-y-2">
            <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Contact name" className="w-full rounded-[10px] px-3 py-2 text-sm" style={{ border: INNER_BORDER }} />
            <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="Mobile (05x…)" className="w-full rounded-[10px] px-3 py-2 text-sm" style={{ border: INNER_BORDER }} />
            <label className="flex items-center gap-2 text-[13px]" style={{ color: MUTE }}>
              <Toggle on={cWa} onChange={setCWa} label="WhatsApp" /> Available on WhatsApp
            </label>
            <div className="flex gap-2">
              <button onClick={() => void saveContact()} className="rounded-[10px] px-4 py-2 text-[13px] font-bold text-white" style={{ background: GREEN }}>Save contact</button>
              <button onClick={() => setEditContact(false)} className="rounded-[10px] px-3.5 py-2 text-[13px] font-semibold" style={{ border: '1px solid #D7DCD7', color: MUTE }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5" style={{ background: TINT_GREY }}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: INK }}>
              {(r.opsContactName ?? 'S P').split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: INK }}>
              {r.opsContactName ?? 'Add a contact'}{r.opsContactPhone && ` · ${r.opsContactPhone}`}{r.opsContactWhatsapp && r.opsContactPhone && ' · WhatsApp ✓'}
            </span>
            <button onClick={() => setEditContact(true)} className="text-[13px] font-bold" style={{ color: GREEN }}>Edit</button>
          </div>
        ))}
        {bullet(<Shield size={17} />, <><b>3 emergency passes a month</b> for genuine last-minute cancellations. Beyond that your reliability score drops; repeated no-shows can suspend the account. <b>No cash penalties — ever.</b></>)}
      </div>

      <h3 className="mb-2 mt-5 text-[14px] font-bold" style={{ color: INK }}>Minimum notice for a new booking</h3>
      <div className="grid grid-cols-3 gap-2.5">
        {NOTICE_OPTIONS.map((o) => {
          const on = notice === o.value;
          return (
            <button key={o.value} onClick={() => setNotice(o.value)}
              className="relative rounded-[14px] px-2 py-3.5 text-center"
              style={{ border: on ? '1.5px solid rgba(11,122,78,.5)' : CARD_BORDER, background: on ? '#F6FAF7' : '#fff' }}>
              {o.isDefault && <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider text-white" style={{ background: on ? GREEN : '#A6B0A9' }}>DEFAULT</span>}
              <span className="block text-[14px] font-bold" style={{ color: on ? GREEN : INK }}>{o.label}</span>
              <span className="block text-[11.5px]" style={{ color: FAINT }}>{o.sub}</span>
            </button>
          );
        })}
      </div>

      <button onClick={() => void agree()} disabled={saving}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-[13px] py-4 text-[15px] font-bold text-white disabled:opacity-60" style={{ background: GREEN_DARK }}>
        {saving && <Loader2 size={16} className="animate-spin" />}
        {r.complete ? 'Update my job rules' : 'I agree — start receiving jobs'}
      </button>
      <p className="mt-2.5 text-center text-[12px]" style={{ color: FAINT }}>
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
      <div className="space-y-2.5">{[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-[14px] bg-white" style={{ border: CARD_BORDER }} />)}</div>
    </div>
  );
}
