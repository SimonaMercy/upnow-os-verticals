'use client';

/**
 * Templates → "Breach" / "Legal" tabs (0288 / 0289): the letter studio.
 *
 * One group per tab. The fixed kinds (two warning letters · four notices) start
 * on the platform starter; saving keeps the landlord's own wording, "Reset"
 * drops it again. On top of those the landlord can keep any number of their
 * own templates on the tab (custom): create, duplicate, rename, delete.
 *
 * Write on the left, a live paper preview on the right — filled with sample
 * values or with a real lease (the server hands back every merge value in
 * `values.fields`; the substitution happens here so unsaved text previews too).
 *
 * The platform never sends these letters; the landlord copies them into their
 * own letter or email. Manager: read-only via /manager/legal (+ rp).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Loader2, MoreHorizontal, Plus, Search } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { legalApi, TEMPLATE_KIND_LABELS, type LegalTemplate, type TemplateGroup, type TemplateKind } from '@/lib/legal';
import { leaseListPath, leaseLine, type LeaseOpt } from '@/components/legal/StartNoticeModal';

/* ── groups, kinds, fields ─────────────────────────────────────────────────── */
const GROUP_META: Record<TemplateGroup, { title: string; purpose: string }> = {
  breach: { title: 'Breach letters', purpose: 'Warning letters for a customer in breach — copy them into your own letter or email; the platform never sends them.' },
  legal: { title: 'Legal notices', purpose: 'Formal notices that open or advance a legal case — copy them into your own letter or email; the platform never sends them.' },
};
/** Two tabs, two groups (owner, 14 Sep: "keep breach and legal templates separate"). */
export const TEMPLATE_GROUPS: Record<TemplateGroup, TemplateKind[]> = {
  breach: ['breach_warning', 'breach_final_warning'],
  legal: ['notice_payment_demand', 'notice_breach_remedy', 'notice_non_renewal', 'notice_renewal_terms_change'],
};

/** Plain-English labels for the merge fields, grouped for the "Insert field" menu. */
const FIELD_GROUPS: { title: string; fields: { key: string; label: string }[] }[] = [
  { title: 'Customer & lease', fields: [
    { key: 'customer_name', label: 'Customer name' }, { key: 'unit', label: 'Unit number' }, { key: 'building', label: 'Building' },
    { key: 'lease_ref', label: 'Lease reference' }, { key: 'lease_start', label: 'Lease start' }, { key: 'lease_end', label: 'Lease end' }, { key: 'annual_rent', label: 'Annual rent' },
  ] },
  { title: 'Dates & periods', fields: [
    { key: 'date', label: 'Letter date' }, { key: 'days', label: 'Days to act' }, { key: 'deadline', label: 'Deadline' },
  ] },
  { title: 'Breach', fields: [
    { key: 'breach_type', label: 'Breach type' }, { key: 'breach_type_lower', label: 'Breach type (lower-case)' }, { key: 'breach_date', label: 'Reported on' },
    { key: 'breach_description', label: 'What was reported' }, { key: 'warning_date', label: 'First warning date' }, { key: 'correction_deadline', label: 'Correction deadline' }, { key: 'final_deadline', label: 'Final deadline' },
  ] },
  { title: 'Case', fields: [
    { key: 'authority', label: 'Rental authority' }, { key: 'amount', label: 'Amount claimed' }, { key: 'amount_clause', label: 'Amount clause' },
    { key: 'reasons', label: 'Breach reasons' }, { key: 'case_no', label: 'Case number' }, { key: 'contact', label: 'Contact line' },
  ] },
  { title: 'Landlord', fields: [{ key: 'landlord_name', label: 'Landlord name' }] },
];

const fmtSample = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' });
const plusDays = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d; };
/** Sample values for the preview — the same shape the server merges. */
function sampleValues(): Record<string, string> {
  return {
    customer_name: 'Ahmed Ali', unit: '317', building: 'Avenue Residence', lease_ref: 'CID-391',
    lease_start: fmtSample(plusDays(-200)), lease_end: fmtSample(plusDays(165)), annual_rent: '85,000', landlord_name: 'Avenue Properties LLC',
    date: fmtSample(new Date()), days: '14', deadline: fmtSample(plusDays(14)), authority: 'Rental authority',
    contact: 'Contact: Sara Khan · +971 50 123 4567', amount: '21,250', amount_clause: ' (annual rent AED 21,250)',
    reasons: 'Noise; Extra occupants', case_no: 'RDC-2026-0142',
    breach_type: 'Noise', breach_type_lower: 'noise', breach_date: fmtSample(plusDays(-9)),
    breach_description: 'Loud music after midnight, reported by the neighbours on two nights.',
    warning_date: fmtSample(plusDays(-7)), correction_deadline: fmtSample(plusDays(7)), final_deadline: fmtSample(plusDays(14)),
  };
}
/** Mirrors the server: unknown fields become blank; 3+ blank lines collapse. */
function fill(s: string, values: Record<string, string>): string {
  return s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => values[k] ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
const fmtUpdated = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' });

const keyOf = (t: LegalTemplate) => (t.source === 'custom' ? `id:${t.id}` : t.kind);
const refOf = (t: LegalTemplate): TemplateKind | number => (t.source === 'custom' ? t.id : t.kind);

function SourceChip({ source }: { source: LegalTemplate['source'] }) {
  const cls = source === 'own' ? 'bg-[#e6f4ef] text-[#1a7a52]' : source === 'custom' ? 'bg-[#ece9fd] text-[#5b3fbf]' : 'bg-[#eef1ef] text-[#5f6b63]';
  return <span className={`text-[10px] font-semibold px-1.5 py-[1px] rounded-full whitespace-nowrap ${cls}`}>{source === 'own' ? 'Yours' : source === 'custom' ? 'Custom' : 'Starter'}</span>;
}

const btnGhost = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#e4e9e5] bg-white text-[#5f6b63] hover:text-[#14201a] hover:border-[#d5d2ca] cursor-pointer disabled:opacity-50 disabled:cursor-default';
const btnDanger = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#dc2626] bg-white text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer disabled:opacity-50 disabled:cursor-default';
const menuItem = 'w-full text-left px-3 py-2 text-[12.5px] text-[#14201a] rounded-lg hover:bg-[#eef1ef] cursor-pointer';

/* ── the studio ────────────────────────────────────────────────────────────── */
export default function TemplateStudio({ manager, group }: { manager?: { rp: number }; group: TemplateGroup }) {
  const base = manager ? '/manager/legal' : '/legal';
  const rp = manager?.rp;
  const readOnly = !!manager;
  const meta = GROUP_META[group];

  const [items, setItems] = useState<LegalTemplate[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** An action parked behind the "unsaved changes" warning. */
  const [pending, setPending] = useState<{ label: string; run: () => void } | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [menuConfirmDelete, setMenuConfirmDelete] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // preview source
  const [previewMode, setPreviewMode] = useState<'sample' | 'lease'>('sample');
  const [leases, setLeases] = useState<LeaseOpt[] | null>(null);
  const [leaseQ, setLeaseQ] = useState('');
  const [leaseOpen, setLeaseOpen] = useState(false);
  const [leaseSel, setLeaseSel] = useState<LeaseOpt | null>(null);
  const [leaseValues, setLeaseValues] = useState<Record<string, string> | null>(null);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [leaseErr, setLeaseErr] = useState<string | null>(null);
  const leaseRef = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    const order = TEMPLATE_GROUPS[group];
    return items.filter(i => i.group === group).sort((a, b) => {
      const ai = a.source === 'custom' ? 99 : order.indexOf(a.kind); const bi = b.source === 'custom' ? 99 : order.indexOf(b.kind);
      return ai - bi || a.sortOrder - b.sortOrder || a.id - b.id;
    });
  }, [items, group]);
  const current = useMemo(() => list.find(t => keyOf(t) === selKey) ?? null, [list, selKey]);
  const dirty = !!current && (name !== current.name || subject !== current.subject || body !== current.body);

  const hydrate = useCallback((t: LegalTemplate | null) => {
    setSelKey(t ? keyOf(t) : null);
    setName(t?.name ?? ''); setSubject(t?.subject ?? ''); setBody(t?.body ?? '');
    setSaved(false); setError(null); setConfirmReset(false); setConfirmDelete(false); setPending(null); setMenuKey(null); setMenuConfirmDelete(false);
  }, []);

  const load = useCallback(async () => {
    const r = await legalApi.templates(base, rp);
    setFields(r.fields ?? []); setItems(r.items ?? []);
    return r.items ?? [];
  }, [base, rp]);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    load().then(all => { if (live) hydrate(all.find(i => i.group === group && i.kind === TEMPLATE_GROUPS[group][0]) ?? all.find(i => i.group === group) ?? null); })
      .catch(e => { if (live) setLoadErr((e as Error)?.message || 'Could not load the templates.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [load, hydrate, group]);

  // close the popovers on an outside click / Esc
  useEffect(() => {
    if (!fieldsOpen && !menuKey && !leaseOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (fieldsOpen && fieldsRef.current && !fieldsRef.current.contains(t)) setFieldsOpen(false);
      if (menuKey && menuRef.current && !menuRef.current.contains(t)) { setMenuKey(null); setMenuConfirmDelete(false); }
      if (leaseOpen && leaseRef.current && !leaseRef.current.contains(t)) setLeaseOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFieldsOpen(false); setMenuKey(null); setMenuConfirmDelete(false); setLeaseOpen(false); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [fieldsOpen, menuKey, leaseOpen]);

  /** Run now, or park behind the unsaved-changes warning. */
  const guarded = (label: string, run: () => void) => { if (dirty) setPending({ label, run }); else run(); };
  const select = (t: LegalTemplate) => { if (keyOf(t) === selKey) return; guarded(`open “${t.name}”`, () => hydrate(t)); };

  async function createNew(seed?: { name: string; subject: string; body: string }) {
    if (readOnly) return;
    setSaving(true); setError(null);
    try {
      const created = await legalApi.createTemplate({ group, name: seed?.name ?? 'Untitled template', subject: seed?.subject ?? '', body: seed?.body ?? '' });
      setItems(l => [...l, created]); hydrate(created);
      if (!seed) requestAnimationFrame(() => document.getElementById('studio-name')?.focus());
    } catch (e) { setError((e as Error)?.message || 'Could not create the template.'); }
    finally { setSaving(false); }
  }
  const duplicate = (t: LegalTemplate) => guarded(`duplicate “${t.name}”`, () => void createNew({ name: `${t.name} (copy)`, subject: t.subject, body: t.body }));

  async function remove(t: LegalTemplate) {
    if (readOnly || t.source !== 'custom') return;
    setSaving(true); setError(null);
    try {
      await legalApi.deleteTemplate(t.id);
      const rest = items.filter(i => i.id !== t.id);
      setItems(rest);
      if (keyOf(t) === selKey) hydrate(rest.find(i => i.group === group && i.kind === TEMPLATE_GROUPS[group][0]) ?? rest.find(i => i.group === group) ?? null);
      else { setMenuKey(null); setMenuConfirmDelete(false); }
    } catch (e) { setError((e as Error)?.message || 'Could not delete the template.'); }
    finally { setSaving(false); }
  }

  async function save() {
    if (readOnly || !current) return;
    setError(null);
    if (!name.trim()) { setError('Give the template a name.'); return; }
    if (!subject.trim()) { setError('Give the letter a subject.'); return; }
    if (!body.trim()) { setError('The letter body cannot be empty.'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), subject: subject.trim(), body };
      const updated = current.source === 'custom' ? await legalApi.updateTemplate(current.id, payload) : await legalApi.saveTemplate(current.kind, payload);
      setItems(l => l.map(i => (current.source === 'custom' ? i.id === current.id : i.kind === current.kind && i.group === group) ? updated : i));
      hydrate(updated); setSaved(true);
    } catch (e) { setError((e as Error)?.message || 'Could not save the template.'); }
    finally { setSaving(false); }
  }

  async function reset(t: LegalTemplate) {
    if (readOnly || t.source !== 'own') return;
    setSaving(true); setError(null);
    try {
      await legalApi.resetTemplate(t.kind);
      const all = await load();
      hydrate(all.find(i => i.group === group && i.kind === t.kind) ?? null); setSaved(true);
    } catch (e) { setError((e as Error)?.message || 'Could not reset the template.'); }
    finally { setSaving(false); }
  }

  /** Insert {{field}} at the caret of the body (or append). */
  const insertField = (f: string) => {
    if (readOnly) return;
    const el = bodyRef.current; const token = `{{${f}}}`;
    setFieldsOpen(false); setSaved(false);
    if (!el) { setBody(b => b + token); return; }
    const start = el.selectionStart ?? body.length; const end = el.selectionEnd ?? start;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos); });
  };

  // ── preview values ──
  const samples = useMemo(() => sampleValues(), []);
  useEffect(() => {
    if (previewMode !== 'lease' || leases) return;
    apiGet<LeaseOpt[]>(leaseListPath(base, rp)).then(l => setLeases(Array.isArray(l) ? l : [])).catch(() => setLeases([]));
  }, [previewMode, leases, base, rp]);
  const currentRef = current ? refOf(current) : null;
  useEffect(() => {
    if (previewMode !== 'lease' || !leaseSel || currentRef == null) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeaseBusy(true); setLeaseErr(null);
    legalApi.renderTemplate(base, rp, currentRef, { leaseId: leaseSel.id })
      .then(r => { if (live) setLeaseValues(r.values?.fields ?? {}); })
      .catch(e => { if (live) { setLeaseValues(null); setLeaseErr((e as Error)?.message || 'Could not load the lease values.'); } })
      .finally(() => { if (live) setLeaseBusy(false); });
    return () => { live = false; };
  }, [previewMode, leaseSel, currentRef, base, rp]);
  const values = previewMode === 'lease' && leaseValues ? leaseValues : samples;
  const previewSubject = fill(subject, values);
  const previewBody = fill(body, values);
  const paragraphs = useMemo(() => previewBody.split(/\n{2,}/).filter(Boolean), [previewBody]);
  const needle = leaseQ.trim().toLowerCase();
  const leaseOptions = useMemo(() => (leases ?? [])
    .filter(l => !needle || leaseLine(l).toLowerCase().includes(needle) || String(l.id) === needle || `cid-${l.id}` === needle)
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || b.id - a.id)
    .slice(0, 40), [leases, needle]);
  const copyLetter = async () => {
    try { await navigator.clipboard.writeText(`${previewSubject}\n\n${previewBody}`); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable */ }
  };

  const fieldGroups = useMemo(() => {
    const known = new Set(FIELD_GROUPS.flatMap(g => g.fields.map(f => f.key)));
    const groups = FIELD_GROUPS.map(g => ({ ...g, fields: g.fields.filter(f => !fields.length || fields.includes(f.key)) })).filter(g => g.fields.length);
    const extra = fields.filter(f => !known.has(f)).map(key => ({ key, label: key.replace(/_/g, ' ') }));
    return extra.length ? [...groups, { title: 'Other', fields: extra }] : groups;
  }, [fields]);

  if (loading) return <div className="flex items-center gap-3 py-16 justify-center text-[#5f6b63]"><Loader2 size={16} className="animate-spin" /><span className="text-sm">Loading…</span></div>;
  if (loadErr) return <div className="rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{loadErr}</div>;

  const inputCls = `w-full text-sm px-3 py-2 border border-[#e4e9e5] rounded-xl focus:outline-none ${readOnly ? 'bg-[#fbfbf8] text-[#3d3a33]' : 'bg-white focus:border-[#047246]'}`;

  return (
    <div className="space-y-4">
      {/* top bar */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold text-[#14201a] leading-tight">{meta.title}</h2>
          <p className="text-[12.5px] text-[#5f6b63] mt-1">{readOnly ? <>Templates are <b>set by the landlord</b> — read them here; the wording is theirs to change.</> : meta.purpose}</p>
        </div>
        {!readOnly && (
          <button type="button" onClick={() => guarded('start a new template', () => void createNew())} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#047246] text-white text-sm font-semibold hover:bg-[#27896f] cursor-pointer disabled:opacity-50 shrink-0">
            <Plus size={16} /> New template
          </button>
        )}
      </div>

      {pending && (
        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-[#f5d9a8] bg-[#fffbf3] px-4 py-2.5 text-[12.5px] text-[#7a4b00]">
          <span>You have unsaved changes on <b>{current?.name || 'this template'}</b>. Discard them and {pending.label}?</span>
          <button type="button" onClick={() => { const run = pending.run; setPending(null); run(); }} className={btnDanger}>Discard changes</button>
          <button type="button" onClick={() => setPending(null)} className={btnGhost}>Keep editing</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
        {/* ── rail ── */}
        <div className="space-y-2">
          {list.map(t => {
            const k = keyOf(t); const on = k === selKey; const menuOn = menuKey === k;
            return (
              <div key={k} role="button" tabIndex={0} aria-pressed={on} onClick={() => select(t)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t); } }}
                className={`relative rounded-[14px] border px-3.5 py-3 cursor-pointer transition ${on ? 'border-[#047246] bg-[#eef7f2] shadow-[0_0_0_3px_rgba(4,114,70,.12)]' : 'border-[#e4e9e5] bg-white hover:border-[#d5d2ca]'}`}>
                <div className="flex items-center gap-2 pr-6">
                  <span className={`text-[13px] truncate ${on ? 'font-bold text-[#14201a]' : 'font-semibold text-[#3d3a33]'}`}>{on && dirty ? name || 'Untitled template' : t.name}</span>
                  <SourceChip source={t.source} />
                </div>
                <div className="text-[11px] text-[#8a948d] mt-1 truncate">
                  {t.source !== 'custom' && <span>{TEMPLATE_KIND_LABELS[t.kind]} · </span>}
                  {t.source === 'platform' ? 'Platform wording' : `Updated ${fmtUpdated(t.updatedAt)}`}
                </div>
                {!readOnly && (
                  <div ref={menuOn ? menuRef : undefined} className="absolute right-2 top-2" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                    <button type="button" aria-label={`Options for ${t.name}`} aria-expanded={menuOn} onClick={() => { setMenuKey(menuOn ? null : k); setMenuConfirmDelete(false); }}
                      className={`p-1 rounded-md text-[#8a948d] hover:text-[#14201a] hover:bg-white/80 cursor-pointer ${menuOn ? 'text-[#14201a] bg-white' : ''}`}>
                      <MoreHorizontal size={16} />
                    </button>
                    {menuOn && (
                      <div className="absolute right-0 top-8 z-20 w-56 rounded-xl border border-[#e4e9e5] bg-white shadow-[0_12px_32px_-12px_rgba(26,25,22,.35)] p-1">
                        <button type="button" className={menuItem} onClick={() => { setMenuKey(null); duplicate(t); }}>{t.source === 'custom' ? 'Duplicate' : 'Duplicate as custom'}</button>
                        {t.source === 'own' && <button type="button" className={menuItem} onClick={() => { setMenuKey(null); guarded('reset it to the starter', () => void reset(t)); }}>Reset to starter</button>}
                        {t.source === 'custom' && (menuConfirmDelete ? (
                          <div className="px-3 py-2 text-[12px] text-[#5f6b63]">
                            Delete “{t.name}”?
                            <div className="flex gap-2 mt-2">
                              <button type="button" className={btnDanger} disabled={saving} onClick={() => void remove(t)}>Delete</button>
                              <button type="button" className={btnGhost} onClick={() => setMenuConfirmDelete(false)}>Keep</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className={`${menuItem} text-[#dc2626]`} onClick={() => setMenuConfirmDelete(true)}>Delete</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {list.length === 0 && <p className="text-[12px] text-[#8a948d] px-1">No templates on this tab yet.</p>}
        </div>

        {/* ── main ── */}
        {current ? (
          <div className="rounded-[16px] border border-[#e4e9e5] bg-white overflow-hidden grid grid-cols-1 xl:grid-cols-2">
            {/* Write */}
            <div className="flex flex-col min-w-0 border-b xl:border-b-0 xl:border-r border-[#e4e9e5]">
              <div className="px-5 pt-4 pb-3 border-b border-[#eef1ef] flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#8a948d]">Write</span>
                <div className="flex items-center gap-2">
                  <SourceChip source={current.source} />
                  {current.source !== 'custom' && <span className="text-[11px] text-[#8a948d]">{TEMPLATE_KIND_LABELS[current.kind]}</span>}
                </div>
              </div>
              <div className="px-5 py-4 space-y-3 flex-1 flex flex-col">
                <input id="studio-name" value={name} readOnly={readOnly} disabled={readOnly} onChange={e => { setName(e.target.value); setSaved(false); }} placeholder="Template name" aria-label="Template name"
                  className="w-full text-[20px] font-bold text-[#14201a] bg-transparent border-0 border-b border-transparent focus:border-[#e4e9e5] focus:outline-none px-0 py-1 placeholder:text-[#c0bdb8] disabled:text-[#14201a]" />
                <div>
                  <label htmlFor="studio-subject" className="text-[11px] font-medium text-[#5f6b63] mb-1 block">Subject</label>
                  <input id="studio-subject" className={inputCls} value={subject} readOnly={readOnly} disabled={readOnly} onChange={e => { setSubject(e.target.value); setSaved(false); }} placeholder="Subject of the letter" />
                </div>
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label htmlFor="studio-body" className="text-[11px] font-medium text-[#5f6b63]">Body</label>
                    {!readOnly && (
                      <div ref={fieldsRef} className="relative">
                        <button type="button" onClick={() => setFieldsOpen(o => !o)} aria-expanded={fieldsOpen} className={btnGhost}>
                          Insert field <ChevronDown size={12} />
                        </button>
                        {fieldsOpen && (
                          <div className="absolute right-0 top-9 z-20 w-[300px] max-h-[380px] overflow-y-auto rounded-xl border border-[#e4e9e5] bg-white shadow-[0_12px_32px_-12px_rgba(26,25,22,.35)] p-2">
                            {fieldGroups.map(g => (
                              <div key={g.title} className="mb-1.5 last:mb-0">
                                <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[.08em] text-[#8a948d]">{g.title}</div>
                                {g.fields.map(f => (
                                  <button key={f.key} type="button" onClick={() => insertField(f.key)} className={`${menuItem} flex items-center justify-between gap-2`}>
                                    <span>{f.label}</span>
                                    <code className="text-[10.5px] text-[#8a948d]">{`{{${f.key}}}`}</code>
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <textarea id="studio-body" ref={bodyRef} value={body} readOnly={readOnly} disabled={readOnly} onChange={e => { setBody(e.target.value); setSaved(false); }} spellCheck={false}
                    placeholder={'Dear {{customer_name}},\n\n…'}
                    className={`${inputCls} flex-1 min-h-[440px] text-[14px] leading-7 text-[#14201a] px-4 py-3 resize-y`} />
                  <p className="text-[11px] text-[#8a948d] mt-1.5">A field with nothing to show comes out blank — a line that is only a field disappears from the letter.</p>
                </div>
              </div>
              {/* footer */}
              <div className="px-5 py-3 border-t border-[#eef1ef] flex items-center justify-between gap-3 flex-wrap bg-[#fbfbf8]">
                <span className="inline-flex items-center gap-2 text-[11.5px] text-[#5f6b63]">
                  {readOnly ? 'Templates are set by the landlord.' : dirty
                    ? <><span className="w-2 h-2 rounded-full bg-[#d97706]" aria-hidden /> Unsaved changes</>
                    : saved ? <><Check size={13} className="text-[#047246]" /> Saved</> : current.source === 'platform' ? 'On the platform starter — save to keep your own wording.' : `Saved ${fmtUpdated(current.updatedAt)}`}
                </span>
                {!readOnly && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {error && <span className="text-[11.5px] text-[#dc2626]">{error}</span>}
                    {current.source === 'own' && (confirmReset ? (
                      <span className="inline-flex items-center gap-2 text-[11.5px] text-[#5f6b63]">Back to the starter wording?
                        <button type="button" className={btnDanger} disabled={saving} onClick={() => void reset(current)}>Reset</button>
                        <button type="button" className={btnGhost} onClick={() => setConfirmReset(false)}>Keep</button>
                      </span>
                    ) : <button type="button" className={btnGhost} disabled={saving} onClick={() => setConfirmReset(true)}>Reset to starter</button>)}
                    {current.source === 'custom' && (confirmDelete ? (
                      <span className="inline-flex items-center gap-2 text-[11.5px] text-[#5f6b63]">Delete this template?
                        <button type="button" className={btnDanger} disabled={saving} onClick={() => void remove(current)}>Delete</button>
                        <button type="button" className={btnGhost} onClick={() => setConfirmDelete(false)}>Keep</button>
                      </span>
                    ) : <button type="button" className={btnDanger} disabled={saving} onClick={() => setConfirmDelete(true)}>Delete</button>)}
                    <button type="button" onClick={() => void save()} disabled={saving || !dirty}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#047246] hover:bg-[#27896f] cursor-pointer disabled:opacity-50 disabled:cursor-default">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Preview */}
            <div className="flex flex-col min-w-0 bg-[#eef1ef]">
              <div className="px-5 pt-4 pb-3 border-b border-[#e4e9e5] bg-white flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#8a948d]">Preview</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[#5f6b63]">Preview with</span>
                  <div className="inline-flex rounded-lg border border-[#e4e9e5] bg-[#eef1ef] p-[2px]">
                    {(['sample', 'lease'] as const).map(m => (
                      <button key={m} type="button" onClick={() => { setPreviewMode(m); if (m === 'lease' && !leaseSel) setLeaseOpen(true); }} aria-pressed={previewMode === m}
                        className={`px-2.5 py-1 rounded-md text-[11.5px] cursor-pointer ${previewMode === m ? 'bg-white text-[#14201a] font-semibold shadow-sm' : 'text-[#5f6b63] font-medium'}`}>
                        {m === 'sample' ? 'Sample data' : 'A real lease'}
                      </button>
                    ))}
                  </div>
                  {previewMode === 'lease' && (
                    <div ref={leaseRef} className="relative">
                      <button type="button" onClick={() => setLeaseOpen(o => !o)} aria-expanded={leaseOpen} className={`${btnGhost} max-w-[260px]`}>
                        <Search size={12} className="shrink-0" /><span className="truncate">{leaseSel ? `Unit ${leaseSel.unit?.number ?? '—'} · CID-${leaseSel.id}` : 'Pick a lease'}</span>
                      </button>
                      {leaseOpen && (
                        <div className="absolute right-0 top-9 z-20 w-[360px] rounded-xl border border-[#e4e9e5] bg-white shadow-[0_12px_32px_-12px_rgba(26,25,22,.35)] p-2">
                          <input autoFocus value={leaseQ} onChange={e => setLeaseQ(e.target.value)} placeholder="Unit, customer, building or CID…" aria-label="Search leases"
                            className="w-full text-[12.5px] px-3 py-2 border border-[#e4e9e5] rounded-lg focus:outline-none focus:border-[#047246] mb-1.5" />
                          <div className="max-h-[260px] overflow-y-auto">
                            {leases === null ? <div className="px-3 py-2 text-[12px] text-[#8a948d] inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading leases…</div>
                              : leaseOptions.length === 0 ? <div className="px-3 py-2 text-[12px] text-[#8a948d]">No lease matches.</div>
                              : leaseOptions.map(l => (
                                <button key={l.id} type="button" onClick={() => { setLeaseSel(l); setLeaseOpen(false); }} className={`${menuItem} truncate`}>{leaseLine(l)}</button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <button type="button" onClick={() => void copyLetter()} className={btnGhost} title="Copy the subject and letter as shown">{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}</button>
                </div>
              </div>
              <div className="px-4 sm:px-6 py-6 flex-1 overflow-y-auto">
                {previewMode === 'lease' && (
                  <p className="text-[11px] text-[#5f6b63] mb-3 text-center">
                    {!leaseSel ? 'Pick a lease to fill the letter from its real details.' : leaseBusy ? 'Loading the lease values…' : leaseErr ? <span className="text-[#dc2626]">{leaseErr}</span> : `Filled from ${leaseLine(leaseSel)} — breach and case fields stay blank here.`}
                  </p>
                )}
                <div className="mx-auto w-full max-w-[640px] min-h-[760px] bg-white rounded-[6px] border border-[#ecebe6] shadow-[0_1px_2px_rgba(0,0,0,.05),0_18px_40px_-16px_rgba(26,25,22,.28)] px-8 sm:px-12 py-10 sm:py-12 text-[#14201a]"
                  style={{ fontFamily: "Georgia, 'Times New Roman', serif", opacity: leaseBusy ? 0.6 : 1 }}>
                  <div className="flex items-baseline justify-between gap-4 border-b border-[#14201a] pb-3 mb-8">
                    <span className="text-[11px] font-semibold uppercase tracking-[.14em]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{values.landlord_name || 'Landlord'}</span>
                    <span className="text-[11.5px] text-[#5f6b63]">{values.date}</span>
                  </div>
                  <h3 className="text-[22px] leading-snug font-normal mb-6" style={{ fontFamily: 'var(--font-serif), Georgia, serif' }}>{previewSubject || <span className="text-[#c0bdb8]">Subject of the letter</span>}</h3>
                  <div className="space-y-4 text-[14px] leading-[1.7]">
                    {paragraphs.length ? paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>) : <p className="text-[#c0bdb8]">The letter body appears here as you type.</p>}
                  </div>
                  <div className="mt-14 pt-3 border-t border-[#14201a] w-[220px]">
                    <div className="text-[10.5px] uppercase tracking-[.12em] text-[#8a948d]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Signature</div>
                    <div className="text-[13px] mt-1">{values.landlord_name || 'Landlord'}</div>
                  </div>
                </div>
                <p className="text-[11px] text-[#8a948d] mt-4 text-center">{previewMode === 'sample' ? 'Shown with sample values — the real letter takes them from the lease, breach or case.' : 'Copy the letter into your own letter or email; the platform does not send it.'}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-[#e4e9e5] bg-white px-6 py-16 text-center text-[13px] text-[#8a948d]">
            {readOnly ? 'The landlord has no templates on this tab yet.' : 'Pick a template on the left, or start a new one.'}
          </div>
        )}
      </div>
    </div>
  );
}
