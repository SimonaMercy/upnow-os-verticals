'use client';

/**
 * SP Settings → Team, design 3a ("unified single-page flow").
 *
 * Replaces the old three-stack (roster card + red gap table + chip-soup skills
 * card, with the technician shown twice). One flow instead:
 *   1. Coverage meter — a 15-segment bar: how many listed services can take
 *      bookings vs. stay hidden until a lead-capable tech holds them.
 *   2. Team list — roster + pending invites merged; each technician appears
 *      ONCE, with an inline "Covers N of M services" summary.
 *   3. Skills — one card per technician: services as real checkboxes grouped by
 *      category, with per-category live/hidden status. Ticking is exact and
 *      saves instantly (PATCH skillServiceIds); a service goes live the moment
 *      a lead-capable technician holds it.
 *
 * Source of truth for the design: the "Settings → Team, redesigned / 3a" screen
 * in the claude.ai design project "UpNow service provider onboarding".
 */

import { useEffect, useMemo, useState } from 'react';
import { Schibsted_Grotesk } from 'next/font/google';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Camera, Check, Clock, RefreshCw, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api';
import { catLabel } from './SpJobReady';

/* ── Tokens (design 3a) ──────────────────────────────────────────────────── */
const grotesk = Schibsted_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });
const GREEN = '#0B7A4E';
const GREEN_DEEP = '#0A3D26';
const GREEN_DARK = '#0A5C3B';
const INK = '#182420';
const MUTE = '#55645B';
const FAINT = '#8A968D';
const FAINTER = '#B7C0BA';
const BORDER = '#E4E7E2';
const HAIR = '#EEF1EE';
const HAIR2 = '#F0F2EF';
const TINT = '#E9F4EE';
const SEG_HIDDEN = '#F0D9A6';
const AMBER_TEXT = '#C77D0A';
const CHK = '#C9D1CA';
const CHIP_BORDER = '#DDE2DD';
const RED = '#B42318';

// Category display order (mirrors the catalog taxonomy).
const CAT_ORDER = [
  'home_cleaning', 'ac_services', 'plumbing', 'electrical', 'handyman',
  'painting', 'pest_control', 'car_vehicle', 'landscaping_outdoor', 'commercial_services',
];

/* ── Types ───────────────────────────────────────────────────────────────── */
interface Tech { id: number; name: string; status: string; isLeadCapable: boolean; photoUrl: string | null; skills: string[]; serviceSkillIds: number[] }
interface RosterMember { id: number; status: string; user: { name: string; email: string; phone: string | null } }
interface SpService { id: number; name: string; category: string }
interface Invite { id: number; email: string; firstName: string | null; lastName: string | null; status: string; expiresAt: string }

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14 };

/* ── Invite modal ────────────────────────────────────────────────────────── */
const inviteSchema = z.object({
  firstName: z.string().min(1, 'First name required').max(100),
  lastName: z.string().max(100).optional(),
  email: z.string().email('Valid email required'),
  phone: z.string().optional(),
});
type InviteForm = z.infer<typeof inviteSchema>;

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<InviteForm>({ resolver: zodResolver(inviteSchema) });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (d: InviteForm) => {
    setErr(null);
    try { await apiPost('/invitations', { ...d, role: 'technician' }); onDone(); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not send invite'); }
  };
  const field = 'w-full rounded-xl px-3 py-2.5 text-sm outline-none';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.4)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md p-6" style={{ ...card }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontSize: 17, fontWeight: 700, color: INK }}>Invite technician</h2>
          <button onClick={onClose} style={{ color: FAINT }}><X size={18} /></button>
        </div>
        {err && <div className="rounded-xl px-3 py-2.5 mb-4 text-sm" style={{ background: '#FDECEC', color: RED }}>{err}</div>}
        <form onSubmit={handleSubmit(submit)} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: MUTE }}>First name *</label>
              <input {...register('firstName')} className={field} style={{ border: `1px solid ${errors.firstName ? RED : BORDER}` }} placeholder="Jane" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: MUTE }}>Last name</label>
              <input {...register('lastName')} className={field} style={{ border: `1px solid ${BORDER}` }} placeholder="Smith" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: MUTE }}>Email *</label>
            <input {...register('email')} type="email" className={field} style={{ border: `1px solid ${errors.email ? RED : BORDER}` }} placeholder="jane@example.com" />
            {errors.email && <p className="text-xs mt-1" style={{ color: RED }}>{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: MUTE }}>Phone (optional)</label>
            <input {...register('phone')} className={field} style={{ border: `1px solid ${BORDER}` }} placeholder="+971 50 000 0000" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ border: `1px solid ${BORDER}`, color: MUTE }}>Cancel</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: GREEN, opacity: isSubmitting ? 0.7 : 1 }}>
              {isSubmitting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Toggle (lead-capable) ───────────────────────────────────────────────── */
function LeadToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
      style={{ position: 'relative', width: 38, height: 22, borderRadius: 999, border: 0, cursor: 'pointer', background: on ? GREEN : '#D3DAD4', transition: 'background .15s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(20,40,30,.25)' }} />
    </button>
  );
}

/* ── Component ───────────────────────────────────────────────────────────── */
export function SpTeamManager() {
  const [techs, setTechs] = useState<Tech[] | null>(null);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [services, setServices] = useState<SpService[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [now] = useState(() => Date.now());

  const loadTechs = () => apiGet<Tech[]>('/service-provider/technicians').then(setTechs).catch(() => setTechs([]));
  const loadInvites = () => apiGet<Invite[]>('/invitations?status=pending').then((d) => setInvites(Array.isArray(d) ? d : [])).catch(() => setInvites([]));

  useEffect(() => {
    void loadTechs();
    void loadInvites();
    apiGet<RosterMember[]>('/team/technicians').then((d) => setRoster(Array.isArray(d) ? d : [])).catch(() => {});
    apiGet<unknown>('/service-provider/services')
      .then((d) => setServices((Array.isArray(d) ? d : []) as SpService[]))
      .catch(() => {});
  }, []);

  const emailById = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of roster) m.set(r.id, r.user.email);
    return m;
  }, [roster]);

  // Services grouped by category, in taxonomy order.
  const catGroups = useMemo(() => {
    const m = new Map<string, SpService[]>();
    for (const s of services) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()].sort(([a], [b]) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [services]);

  const total = services.length;
  // A service is live (bookable) when at least one lead-capable tech holds it.
  const coveredIds = useMemo(() => {
    const set = new Set<number>();
    for (const t of techs ?? []) if (t.isLeadCapable) for (const id of t.serviceSkillIds) set.add(id);
    return set;
  }, [techs]);
  const covered = services.filter((s) => coveredIds.has(s.id)).length;
  const activeTechs = (techs ?? []).filter((t) => t.status === 'active');

  const patchSkills = async (tech: Tech, ids: number[]) => {
    setTechs((list) => list?.map((x) => x.id === tech.id ? { ...x, serviceSkillIds: ids } : x) ?? null);
    try { await apiPatch(`/service-provider/technicians/${tech.id}/profile`, { skillServiceIds: ids }); }
    catch { void loadTechs(); }
  };
  const patchLead = async (tech: Tech, isLeadCapable: boolean) => {
    setTechs((list) => list?.map((x) => x.id === tech.id ? { ...x, isLeadCapable } : x) ?? null);
    try { await apiPatch(`/service-provider/technicians/${tech.id}/profile`, { isLeadCapable }); }
    catch { void loadTechs(); }
  };
  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86400000));

  if (!techs) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="animate-pulse" style={{ ...card, height: 90 }} />)}</div>;
  }

  return (
    <div className={grotesk.className} style={{ color: INK }}>
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onDone={loadInvites} />}

      <div className="flex items-center justify-end mb-2.5">
        <span className="flex items-center gap-1" style={{ fontSize: 12, color: FAINT }}><Check size={12} /> Saves as you go</span>
      </div>

      {/* ── 1 · Coverage meter ─────────────────────────────────────────── */}
      <div className="flex items-start gap-4 p-5 mb-4" style={card}>
        <div className="text-center" style={{ flex: 'none' }}>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: covered === 0 ? AMBER_TEXT : GREEN }}>
            {covered}<span style={{ color: FAINTER, fontWeight: 500, fontSize: 20 }}>/{total || 0}</span>
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT, marginTop: 4 }}>Live</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {total === 0 ? 'No services listed yet.' : `${covered} of ${total} listed service${total === 1 ? '' : 's'} can take bookings.`}
          </div>
          <div style={{ marginTop: 2, fontSize: 12.5, color: MUTE }}>
            {total === 0
              ? 'Add services in My Services, then tick which technician covers each below.'
              : covered === total
                ? 'Every listed service has a lead-capable technician — customers can book all of them.'
                : `The other ${total - covered} stay hidden from customers until a lead-capable technician holds them — tick them below and they go live instantly.`}
          </div>
          {total > 0 && (
            <div className="flex mt-2.5" style={{ gap: 3 }}>
              {services.map((s, i) => (
                <div key={s.id} style={{ flex: 1, height: 6, borderRadius: 99, background: i < covered ? GREEN : SEG_HIDDEN }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 2 · Team list (roster + invites merged) ────────────────────── */}
      <div className="mb-4" style={{ ...card, overflow: 'hidden' }}>
        <div className="flex items-center" style={{ padding: '14px 17px', borderBottom: `1px solid ${HAIR}` }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Team</span>
            <span style={{ marginLeft: 8, fontSize: 12, color: FAINT }}>{activeTechs.length} active · {invites.length} invited</span>
          </div>
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-1.5" style={{ height: 34, padding: '0 14px', borderRadius: 10, background: GREEN, color: '#fff', fontSize: 12.5, fontWeight: 600, border: 0, cursor: 'pointer' }}>
            <Plus size={15} /> Invite technician
          </button>
        </div>

        {activeTechs.map((tech) => {
          const coversN = tech.serviceSkillIds.filter((id) => services.some((s) => s.id === id)).length;
          const hasPhoto = !!tech.photoUrl;
          return (
            <div key={tech.id} className="flex items-center gap-3" style={{ padding: '13px 17px', borderBottom: `1px solid ${HAIR}` }}>
              <span className="relative flex items-center justify-center" style={{ width: 38, height: 38, borderRadius: '50%', flex: 'none', background: hasPhoto ? TINT : '#FBF3E4', color: hasPhoto ? GREEN : AMBER_TEXT, fontSize: 12.5, fontWeight: 700 }}>
                {hasPhoto ? tech.name.split(' ').map((w) => w[0]).slice(0, 2).join('') : <Camera size={16} />}
                {hasPhoto && <span className="absolute flex items-center justify-center" style={{ bottom: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: GREEN, border: '2px solid #fff' }}><Check size={7} strokeWidth={4} color="#fff" /></span>}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{tech.name}</span>
                  {tech.isLeadCapable && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#fff', background: GREEN_DEEP, borderRadius: 5, padding: '2.5px 6px' }}>Lead</span>}
                </div>
                <div className="truncate" style={{ marginTop: 1, fontSize: 12, color: FAINT }}>
                  {emailById.get(tech.id) ?? ''}{' · '}{hasPhoto ? 'photo ✓ · ready for jobs' : 'add photo before first job'}
                </div>
              </div>
              <span style={{ fontSize: 12, color: MUTE, flex: 'none' }}>Covers <b style={{ color: INK }}>{coversN} of {total}</b></span>
              <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, background: TINT, borderRadius: 999, padding: '4px 10px', flex: 'none' }}>Active</span>
            </div>
          );
        })}

        {invites.map((inv) => (
          <div key={inv.id} className="flex items-center gap-3" style={{ padding: '13px 17px', borderBottom: `1px solid ${HAIR}` }}>
            <span className="flex items-center justify-center" style={{ width: 38, height: 38, borderRadius: '50%', flex: 'none', background: '#FBF3E4', color: AMBER_TEXT }}><Clock size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{[inv.firstName, inv.lastName].filter(Boolean).join(' ') || inv.email}</div>
              <div className="truncate" style={{ marginTop: 1, fontSize: 12, color: FAINT }}>{inv.email} · invite expires in {daysLeft(inv.expiresAt)} day{daysLeft(inv.expiresAt) === 1 ? '' : 's'}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: AMBER_TEXT, background: '#FEF6E7', borderRadius: 999, padding: '4px 10px', flex: 'none' }}>Pending</span>
            <button onClick={() => apiPost(`/invitations/${inv.id}/resend`).then(loadInvites).catch(() => {})} className="flex items-center gap-1" style={{ fontSize: 12, fontWeight: 600, color: GREEN, border: 0, background: 'none', cursor: 'pointer' }}><RefreshCw size={12} /> Resend</button>
            <button onClick={() => apiDelete(`/invitations/${inv.id}`).then(loadInvites).catch(() => {})} style={{ fontSize: 12, fontWeight: 600, color: RED, border: 0, background: 'none', cursor: 'pointer' }}>Revoke</button>
          </div>
        ))}

        {activeTechs.length === 0 && invites.length === 0 && (
          <div style={{ padding: '22px 17px', textAlign: 'center', fontSize: 13, color: FAINT }}>No technicians yet — invite your first above.</div>
        )}

        <div style={{ padding: '10px 17px', fontSize: 11.5, color: FAINT }}>
          Leads are the responsible person on a job — your lead count sets how many jobs can run at once. 1 lead = 1 job at a time.
        </div>
      </div>

      {/* ── 3 · Skills — one card per technician ───────────────────────── */}
      {activeTechs.map((tech) => (
        <div key={tech.id} className="mb-4" style={{ ...card, overflow: 'hidden' }}>
          <div className="flex items-center gap-3" style={{ padding: '14px 17px', borderBottom: `1px solid ${HAIR}` }}>
            <span className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', flex: 'none', background: TINT, color: GREEN, fontSize: 11.5, fontWeight: 700 }}>
              {tech.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{tech.name} — skills</div>
              <div style={{ fontSize: 11.5, color: FAINT }}>Tick every service he can do. Ticked services go live for booking instantly.</div>
            </div>
            <div className="flex items-center gap-2" style={{ flex: 'none' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: MUTE }}>Lead-capable</span>
              <LeadToggle on={tech.isLeadCapable} onChange={(v) => void patchLead(tech, v)} />
            </div>
          </div>

          <div style={{ padding: '4px 17px 8px' }}>
            {catGroups.map(([cat, catServices]) => {
              const sel = catServices.filter((s) => tech.serviceSkillIds.includes(s.id)).length;
              return (
                <div key={cat} className="flex items-center gap-3.5" style={{ padding: '12px 0', borderBottom: `1px solid ${HAIR2}` }}>
                  <span style={{ width: 96, flex: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTE }}>{catLabel(cat)}</span>
                  <div className="flex flex-wrap" style={{ flex: 1, gap: 8 }}>
                    {catServices.map((s) => {
                      const on = tech.serviceSkillIds.includes(s.id);
                      return (
                        <button key={s.id} type="button"
                          onClick={() => void patchSkills(tech, on ? tech.serviceSkillIds.filter((id) => id !== s.id) : [...tech.serviceSkillIds, s.id])}
                          className="flex items-center gap-1.5"
                          style={{ border: `1px solid ${on ? GREEN : CHIP_BORDER}`, background: on ? TINT : '#fff', borderRadius: 999, padding: '5px 12px 5px 6px', fontSize: 12.5, fontWeight: on ? 600 : 500, color: on ? GREEN_DARK : MUTE, cursor: 'pointer' }}>
                          <span className="flex items-center justify-center" style={{ width: 16, height: 16, borderRadius: '50%', boxSizing: 'border-box', background: on ? GREEN : '#fff', border: on ? 'none' : `1.5px solid ${CHK}` }}>
                            {on && <Check size={10} strokeWidth={3.5} color="#fff" />}
                          </span>
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                  <span style={{ flex: 'none', fontSize: 11.5, fontWeight: 600, color: sel > 0 ? GREEN : AMBER_TEXT }}>
                    {sel > 0 ? `${sel} of ${catServices.length} live` : `0 of ${catServices.length} · hidden`}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ padding: '10px 17px', borderTop: `1px solid ${HAIR}`, fontSize: 11.5, color: FAINT }}>
            Skills are exact — a technician skilled in one service doesn&apos;t cover another unless both are ticked. Hidden services don&apos;t hurt your ranking.
          </div>
        </div>
      ))}
    </div>
  );
}
