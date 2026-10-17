'use client';

/**
 * Settings → Building inspections (0383).
 *
 *   1. Checklists — ONE general checklist for every building and, where a building
 *      needs its own, a property-specific one. Items grouped by area, edited in place.
 *   2. Buildings — every property with its frequency (off / monthly / quarterly), the
 *      checklist it uses (auto: its own, else the general) and the inspector who walks it.
 *
 * Rendered for the landlord (no `manager`) and by the Manager portal with
 * `manager={{ rp }}` (canManageInspections) — same screen, `?rp=` on every call.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Check, ClipboardCheck, Loader2, Plus, Trash2, X } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import {
  biUrl, Checklist, ChecklistItem, Inspector, ScheduleRow, BuildingFrequency, listHref,
} from '@/lib/buildingInspections';

const FREQS: BuildingFrequency[] = ['off', 'monthly', 'quarterly'];

export function BuildingInspectionsSettings({ manager, embedded = false }: { manager?: { rp: number }; embedded?: boolean }) {
  const rp = manager?.rp ?? null;
  const u = useCallback((p: string) => biUrl(p, rp), [rp]);
  const [lists, setLists] = useState<Checklist[]>([]);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingProp, setSavingProp] = useState<number | null>(null);
  const [savedProp, setSavedProp] = useState<number | null>(null);

  // Promise chains, not awaits: nothing sets state synchronously inside the effect.
  const load = useCallback(() => Promise.all([apiGet<Checklist[]>(u('/checklists')), apiGet<ScheduleRow[]>(u('/schedules')), apiGet<Inspector[]>(u('/inspectors'))])
    .then(([l, s, i]) => { setLists(l); setRows(s); setInspectors(i); setError(null); })
    .catch((e: Error) => setError(e.message || 'Could not load building inspections.'))
    .finally(() => setLoading(false)), [u]);
  useEffect(() => { void load(); }, [load]);

  const general = lists.filter((l) => l.scope === 'general');
  const specific = lists.filter((l) => l.scope === 'property');

  async function saveSchedule(r: ScheduleRow, patch: Partial<Pick<ScheduleRow, 'frequency' | 'checklistId' | 'inspectorUserId'>>) {
    setSavingProp(r.propertyId); setError(null);
    try {
      const next = await apiPut<ScheduleRow>(u(`/schedules/${r.propertyId}`), {
        frequency: patch.frequency ?? r.frequency,
        checklistId: patch.checklistId !== undefined ? patch.checklistId : r.checklistId,
        inspectorUserId: patch.inspectorUserId !== undefined ? patch.inspectorUserId : r.inspectorUserId,
      });
      setRows((rs) => rs.map((x) => (x.propertyId === r.propertyId ? next : x)));
      setSavedProp(r.propertyId); setTimeout(() => setSavedProp((s) => (s === r.propertyId ? null : s)), 1500);
    } catch (e) { setError((e as Error).message || 'Save failed.'); }
    finally { setSavingProp(null); }
  }

  if (loading) return <div className="flex items-center justify-center h-[40vh] text-[#8a948d]"><Loader2 className="animate-spin mr-2" /> Loading building inspections…</div>;

  const scheduled = rows.filter((r) => r.frequency !== 'off').length;
  const overdue = rows.reduce((n, r) => n + r.overdueVisits, 0);

  return (
    <div className={embedded ? 'pb-12' : 'max-w-5xl mx-auto px-4 py-6 pb-24'}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          {!embedded && <h1 className="text-2xl font-bold text-[#14201a]">Building inspections</h1>}
          <p className="text-sm text-[#5f6b63] max-w-2xl">
            What to check on every building walk-through, how often each building is visited, and who visits it.
            Visits are opened automatically each month or quarter and sit on the <Link href={listHref(rp)} className="text-[#1a7a5a] font-semibold hover:underline">Building inspections</Link> page.
          </p>
        </div>
        <div className="shrink-0 text-right text-[12px] text-[#5f6b63]">
          <div><span className="font-bold text-[#14201a]">{scheduled}</span> of {rows.length} buildings scheduled</div>
          {overdue > 0 && <div className="text-[#b91c1c] font-semibold">{overdue} visit{overdue === 1 ? '' : 's'} overdue</div>}
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      {/* ── 1. Checklists ── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-[#14201a] flex items-center gap-2"><ClipboardCheck size={16} className="text-[#047246]" /> Checklists</h2>
            <p className="text-[12px] text-[#5f6b63]">One general checklist covers every building. Give a building its own only where it needs different items.</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#047246] text-white text-sm font-semibold px-3 py-2">
            <Plus size={15} /> New checklist
          </button>
        </div>

        {lists.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d9d7cf] bg-[#f6f8f6] px-5 py-8 text-center">
            <p className="text-sm font-semibold text-[#14201a]">No checklist yet</p>
            <p className="text-[12.5px] text-[#5f6b63] mt-1">Start with the standard walk-through — entrance, lifts, fire safety, roof, parking, plant rooms — and edit it to your buildings.</p>
            <button type="button" onClick={() => setCreating(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#047246] text-white text-sm font-semibold px-3 py-2"><Plus size={15} /> Create the general checklist</button>
          </div>
        ) : (
          <div className="space-y-3">
            {[...general, ...specific].map((c) => (
              <ChecklistCard key={c.id} list={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)}
                onChange={(next) => setLists((ls) => ls.map((x) => (x.id === next.id ? next : x)))}
                onRemoved={() => { setLists((ls) => ls.filter((x) => x.id !== c.id)); void load(); }}
                u={u} properties={rows} />
            ))}
          </div>
        )}
      </section>

      {/* ── 2. Buildings ── */}
      <section>
        <div className="mb-3">
          <h2 className="text-base font-bold text-[#14201a] flex items-center gap-2"><Building2 size={16} className="text-[#047246]" /> Buildings</h2>
          <p className="text-[12px] text-[#5f6b63]">How often each building is walked, with which checklist, and by whom. A visit opens on the first day of every period and is due by its last day.</p>
        </div>
        <div className="rounded-2xl border border-[#e4e9e5] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#8a948d] border-b border-[#eef1ef] bg-[#f6f8f6]">
                  <th className="py-2 px-3 font-semibold">Building</th>
                  <th className="py-2 px-3 font-semibold">Frequency</th>
                  <th className="py-2 px-3 font-semibold">Checklist</th>
                  <th className="py-2 px-3 font-semibold">Inspector</th>
                  <th className="py-2 px-3 font-semibold text-right">Open visits</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const off = r.frequency === 'off';
                  const own = lists.find((l) => l.propertyId === r.propertyId && l.isActive);
                  const autoName = own ? `${own.name} (this building)` : general[0] ? `${general[0].name} (general)` : 'No checklist yet';
                  return (
                    <tr key={r.propertyId} className={`border-b border-[#f9f8f6] last:border-0 ${off ? 'text-[#8a948d]' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-[#14201a]">{r.propertyName}</div>
                        <div className="text-[10.5px] text-[#8a948d] capitalize">{r.spaceCategory.replace('_', ' ')}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="inline-flex rounded-lg border border-[#e4e9e5] overflow-hidden align-middle">
                          {FREQS.map((f) => (
                            <button key={f} type="button" onClick={() => saveSchedule(r, { frequency: f })} aria-pressed={r.frequency === f}
                              className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${r.frequency === f ? 'bg-[#047246] text-white' : 'bg-white text-[#5f6b63] hover:bg-[#eef1ef]'}`}>
                              {f === 'off' ? 'Off' : f === 'monthly' ? 'Monthly' : 'Quarterly'}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <select value={r.checklistId ?? ''} disabled={off} onChange={(e) => saveSchedule(r, { checklistId: e.target.value === '' ? null : Number(e.target.value) })}
                          className="w-full max-w-[240px] text-[12.5px] border border-[#e4e9e5] rounded-md px-2 py-1 bg-white disabled:bg-[#f6f8f6]">
                          <option value="">Auto — {autoName}</option>
                          {lists.filter((l) => l.isActive && (l.propertyId == null || l.propertyId === r.propertyId)).map((l) => (
                            <option key={l.id} value={l.id}>{l.name}{l.propertyId ? ' (this building)' : ' (general)'}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select value={r.inspectorUserId ?? ''} disabled={off} onChange={(e) => saveSchedule(r, { inspectorUserId: e.target.value === '' ? null : Number(e.target.value) })}
                          className="w-full max-w-[220px] text-[12.5px] border border-[#e4e9e5] rounded-md px-2 py-1 bg-white disabled:bg-[#f6f8f6]">
                          <option value="">Not assigned</option>
                          {inspectors.map((i) => <option key={i.userId} value={i.userId}>{i.name}{i.role === 'landlord' ? ' (landlord)' : ''}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          {savingProp === r.propertyId ? <Loader2 size={12} className="animate-spin text-[#8a948d]" /> : savedProp === r.propertyId ? <Check size={13} className="text-[#047246]" /> : null}
                          {off ? '—' : <>{r.openVisits}{r.overdueVisits > 0 && <span className="text-[#b91c1c] font-semibold"> · {r.overdueVisits} overdue</span>}</>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-[#8a948d]">No properties yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-[11px] text-[#8a948d] border-t border-[#eef1ef]">
            Inspectors are the landlord and every manager with the <span className="font-semibold">Inspections</span> permission (Settings → Team).
          </div>
        </div>
      </section>

      {creating && (
        <NewChecklistModal properties={rows} hasGeneral={general.length > 0}
          onCancel={() => setCreating(false)}
          onCreate={async (name, propertyId, seedStandard) => {
            try {
              const c = await apiPost<Checklist>(u('/checklists'), { name, propertyId, seedStandard });
              setLists((ls) => [...ls, c]); setOpen(c.id); setCreating(false); void load();
              return null;
            } catch (e) { return (e as Error).message || 'Could not create the checklist.'; }
          }} />
      )}
    </div>
  );
}

/** One checklist: header (name, scope, count) + items grouped by area, edited in place. */
function ChecklistCard({ list, open, onToggle, onChange, onRemoved, u, properties }: {
  list: Checklist; open: boolean; onToggle: () => void; onChange: (c: Checklist) => void; onRemoved: () => void;
  u: (p: string) => string; properties: ScheduleRow[];
}) {
  const [name, setName] = useState(list.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addTo, setAddTo] = useState<string | null>(null);
  const [addingArea, setAddingArea] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, ChecklistItem[]>();
    for (const i of list.items) { if (!m.has(i.area)) m.set(i.area, []); m.get(i.area)!.push(i); }
    return [...m.entries()];
  }, [list.items]);

  async function run(key: string, fn: () => Promise<Checklist | void>) {
    setBusy(key); setErr(null);
    try { const next = await fn(); if (next) onChange(next); }
    catch (e) { setErr((e as Error).message || 'Save failed.'); }
    finally { setBusy(null); }
  }
  const patchItem = (it: ChecklistItem, body: Partial<ChecklistItem>) => run(`i${it.id}`, () => apiPatch<Checklist>(u(`/checklists/${list.id}/items/${it.id}`), body));
  const removeItem = (it: ChecklistItem) => { if (window.confirm(`Remove "${it.label}" from ${it.area}?`)) void run(`i${it.id}`, () => apiDelete<Checklist>(u(`/checklists/${list.id}/items/${it.id}`))); };
  const saveName = () => { const n = name.trim(); if (n && n !== list.name) void run('name', () => apiPatch<Checklist>(u(`/checklists/${list.id}`), { name: n })); };
  const remove = () => { if (window.confirm(`Remove the checklist "${list.name}"? Buildings using it fall back to the general checklist.`)) void run('del', async () => { await apiDelete(u(`/checklists/${list.id}`)); onRemoved(); }); };

  return (
    <div className="rounded-2xl border border-[#e4e9e5] bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3 bg-[#f6f8f6] border-b border-[#eef1ef]">
        <button type="button" onClick={onToggle} className="text-left flex-1 min-w-0 cursor-pointer">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#14201a] truncate">{list.name}</span>
            <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full ${list.scope === 'general' ? 'bg-[#eef3f1] text-[#2e6f5e]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
              {list.scope === 'general' ? 'All buildings' : list.propertyName ?? 'One building'}
            </span>
            {!list.isActive && <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-[#eef1ef] text-[#8a948d]">Inactive</span>}
          </div>
          <div className="text-[11px] text-[#8a948d]">{list.itemCount} item{list.itemCount === 1 ? '' : 's'} · {groups.length} area{groups.length === 1 ? '' : 's'} · {open ? 'click to collapse' : 'click to edit'}</div>
        </button>
        <button type="button" onClick={remove} aria-label="Remove checklist" className="text-[#8a948d] hover:text-[#b91c1c]"><Trash2 size={15} /></button>
      </div>
      {open && (
        <div className="px-4 sm:px-5 py-4">
          {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2">{err}</div>}
          <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end mb-4">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} className="mt-1 w-full text-[13px] border border-[#e4e9e5] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#047246]" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Applies to</span>
              <select value={list.propertyId ?? ''} onChange={(e) => run('scope', () => apiPatch<Checklist>(u(`/checklists/${list.id}`), { propertyId: e.target.value === '' ? null : Number(e.target.value) }))}
                className="mt-1 block text-[12.5px] border border-[#e4e9e5] rounded-md px-2 py-1.5 bg-white">
                <option value="">All buildings (general)</option>
                {properties.map((p) => <option key={p.propertyId} value={p.propertyId}>{p.propertyName}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-[#4a4842] pb-1.5">
              <input type="checkbox" checked={list.isActive} onChange={(e) => run('active', () => apiPatch<Checklist>(u(`/checklists/${list.id}`), { isActive: e.target.checked }))} /> Active
            </label>
          </div>

          <div className="space-y-3">
            {groups.map(([area, items]) => (
              <div key={area} className="rounded-xl border border-[#f0eee8]">
                <div className="flex items-center justify-between px-3 py-2 bg-[#fcfcfa] border-b border-[#eef1ef]">
                  <span className="text-[12.5px] font-bold text-[#14201a]">{area}</span>
                  <button type="button" onClick={() => setAddTo(area)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#047246] hover:opacity-75"><Plus size={12} /> Add item</button>
                </div>
                <ul>
                  {items.map((it) => (
                    <li key={it.id} className={`flex items-center gap-2 px-3 py-1.5 border-b border-[#f9f8f6] last:border-0 ${it.isActive ? '' : 'opacity-50'}`}>
                      <input defaultValue={it.label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.label) void patchItem(it, { label: v }); }}
                        className="flex-1 min-w-0 text-[13px] bg-transparent border-b border-transparent hover:border-[#e4e9e5] focus:border-[#047246] focus:outline-none py-0.5" />
                      {busy === `i${it.id}` && <Loader2 size={12} className="animate-spin text-[#8a948d]" />}
                      <button type="button" onClick={() => patchItem(it, { isActive: !it.isActive })} aria-label={it.isActive ? 'Active' : 'Inactive'}
                        className={`relative inline-flex rounded-full transition-colors ${it.isActive ? 'bg-[#047246]' : 'bg-[#c9c7c1]'}`} style={{ height: 18, width: 32 }}>
                        <span className={`inline-block w-3 h-3 rounded-full bg-white shadow transition-transform absolute top-[3px] ${it.isActive ? 'translate-x-[16px]' : 'translate-x-[3px]'}`} />
                      </button>
                      <button type="button" onClick={() => removeItem(it)} aria-label="Remove item" className="text-[#c9c7c1] hover:text-[#b91c1c]"><X size={14} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {groups.length === 0 && <p className="text-[12.5px] text-[#8a948d]">No items yet — add an area to begin.</p>}
          </div>
          <button type="button" onClick={() => setAddingArea(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-[#e4e9e5] text-[#4a4842] text-[12.5px] font-semibold px-3 py-1.5 hover:border-[#c8c6be]"><Plus size={13} /> Add area</button>
        </div>
      )}

      {(addTo || addingArea) && (
        <AddItemModal area={addTo} onCancel={() => { setAddTo(null); setAddingArea(false); }}
          onAdd={async (area, label) => {
            try { onChange(await apiPost<Checklist>(u(`/checklists/${list.id}/items`), { area, label })); setAddTo(null); setAddingArea(false); return null; }
            catch (e) { return (e as Error).message || 'Could not add the item.'; }
          }} />
      )}
    </div>
  );
}

function Modal({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 bg-[#047246] text-white">
          <span className="text-sm font-bold">{title}</span>
          <button type="button" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function NewChecklistModal({ properties, hasGeneral, onCancel, onCreate }: {
  properties: ScheduleRow[]; hasGeneral: boolean; onCancel: () => void;
  onCreate: (name: string, propertyId: number | null, seedStandard: boolean) => Promise<string | null>;
}) {
  const [scope, setScope] = useState<'general' | 'property'>(hasGeneral ? 'property' : 'general');
  const [propertyId, setPropertyId] = useState<number | ''>('');
  const [name, setName] = useState(hasGeneral ? '' : 'Standard building walk-through');
  const [seed, setSeed] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pickProperty = (val: string) => {
    const id = val === '' ? '' : Number(val);
    setPropertyId(id);
    if (id !== '') { const p = properties.find((x) => x.propertyId === id); if (p && !name.trim()) setName(`${p.propertyName.trim()} checklist`); }
  };
  const submit = async () => {
    if (scope === 'property' && propertyId === '') { setErr('Pick the building.'); return; }
    if (!name.trim()) { setErr('Give the checklist a name.'); return; }
    setBusy(true); setErr(await onCreate(name.trim(), scope === 'property' ? Number(propertyId) : null, seed)); setBusy(false);
  };
  return (
    <Modal title="New checklist" onCancel={onCancel}>
      <div className="space-y-3">
        <div className="inline-flex rounded-lg border border-[#e4e9e5] overflow-hidden">
          {(['general', 'property'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s}
              className={`px-3 py-1.5 text-[12px] font-medium ${scope === s ? 'bg-[#047246] text-white' : 'bg-white text-[#5f6b63] hover:bg-[#eef1ef]'}`}>
              {s === 'general' ? 'All buildings (general)' : 'One building'}
            </button>
          ))}
        </div>
        {scope === 'property' && (
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Building</span>
            <select value={propertyId} onChange={(e) => pickProperty(e.target.value)} className="mt-1 w-full text-[13px] border border-[#e4e9e5] rounded-md px-2 py-1.5 bg-white">
              <option value="">Choose…</option>
              {properties.map((p) => <option key={p.propertyId} value={p.propertyId}>{p.propertyName}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly walk-through" className="mt-1 w-full text-[13px] border border-[#e4e9e5] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#047246]" />
        </label>
        <label className="flex items-start gap-2 text-[12.5px] text-[#4a4842]">
          <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} className="mt-0.5" />
          <span>Start from the standard walk-through (entrance & lobby, lifts, corridors, fire & safety, roof, parking, plant rooms, cleaning) — edit it after.</span>
        </label>
        {err && <p className="text-[12px] text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="rounded-xl border border-[#e4e9e5] text-sm font-semibold px-3 py-2 text-[#5f6b63]">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="rounded-xl bg-[#047246] text-white text-sm font-semibold px-3 py-2 disabled:opacity-60">{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </Modal>
  );
}

function AddItemModal({ area, onCancel, onAdd }: { area: string | null; onCancel: () => void; onAdd: (area: string, label: string) => Promise<string | null> }) {
  const [a, setA] = useState(area ?? '');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!a.trim() || !label.trim()) { setErr('Area and item are both needed.'); return; }
    setBusy(true); setErr(await onAdd(a.trim(), label.trim())); setBusy(false);
  };
  return (
    <Modal title={area ? `Add item — ${area}` : 'Add area'} onCancel={onCancel}>
      <div className="space-y-3">
        {!area && (
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">Area</span>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder="e.g. Swimming pool" autoFocus className="mt-1 w-full text-[13px] border border-[#e4e9e5] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#047246]" />
          </label>
        )}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold">{area ? 'Item' : 'First item'}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} placeholder="What to check, e.g. Pool water clear, pump running" autoFocus={!!area}
            className="mt-1 w-full text-[13px] border border-[#e4e9e5] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#047246]" />
        </label>
        {err && <p className="text-[12px] text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="rounded-xl border border-[#e4e9e5] text-sm font-semibold px-3 py-2 text-[#5f6b63]">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="rounded-xl bg-[#047246] text-white text-sm font-semibold px-3 py-2 disabled:opacity-60">{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  );
}
