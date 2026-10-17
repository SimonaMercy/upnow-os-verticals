'use client';

/**
 * Contract kinds & categories — kept as plain as the Restoration List (owner,
 * 12 Sep): one card per kind, the kind's name and two switches in the card
 * header, its categories as inline-editable rows with an Active toggle. Adding
 * goes through one small dialog. No chips, no arrows, no second header.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Loader2, Check, X } from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useKinds, type KindMeta } from './AmcView';

export interface ExpenseCategory { id: number; name: string; defaultKind: string; sortOrder: number; isActive: boolean; spreadOverTerm?: boolean; recoverable?: boolean; contracts: number }
const scoped = (base: string, rp: number | null | undefined, path: string) => rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;
const SCHEDULES: { value: 'fixed' | 'bills' | 'none'; label: string; hint: string }[] = [
  { value: 'fixed', label: 'Fixed', hint: 'Amounts known up front — a payment plan' },
  { value: 'bills', label: 'Bills', hint: 'Amount entered when each bill arrives' },
  { value: 'none', label: 'None', hint: 'No schedule — spend recorded as it happens' },
];

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={on}
      className={`relative inline-flex rounded-full transition-colors align-middle cursor-pointer ${on ? 'bg-[#047246]' : 'bg-[#c9c7c1]'}`} style={{ height: 22, width: 40 }}>
      <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-[3px] ${on ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

export function AmcCategoriesView({ base, rp, listHref, embedded = false }: { base: string; rp?: number | null; listHref: string; reportHref?: string; embedded?: boolean }) {
  const router = useRouter();
  const { kinds, reload: reloadKinds } = useKinds(base, rp);
  const [rows, setRows] = useState<ExpenseCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [addCat, setAddCat] = useState<KindMeta | null>(null);
  const [addKind, setAddKind] = useState(false);
  const [settingsFor, setSettingsFor] = useState<KindMeta | null>(null);

  const load = useCallback(() => { void apiGet<ExpenseCategory[]>(scoped(base, rp, '/categories')).then(setRows).catch(() => { setRows([]); setError('Could not load the categories.'); }); }, [base, rp]);
  useEffect(() => { load(); }, [load]);

  const flash = (key: string) => { setSavedKey(key); window.setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1500); };
  const run = async (key: string, fn: () => Promise<unknown>, after: () => void) => {
    setSavingKey(key); setError(null);
    try { await fn(); after(); flash(key); }
    catch (e) { setError((e as Error)?.message || 'Save failed.'); }
    finally { setSavingKey(null); }
  };
  // Kind: rename on blur, switches on click, active toggle.
  const kindPatch = (k: KindMeta, body: Record<string, unknown>) => { if (k.id != null) void run(`k${k.id}`, () => apiPatch(scoped(base, rp, `/kinds/${k.id}`), body), () => void reloadKinds()); };
  // Category: rename on blur, active toggle.
  const catPatch = (c: ExpenseCategory, body: Record<string, unknown>) => void run(`c${c.id}`, () => apiPatch(scoped(base, rp, `/categories/${c.id}`), body), load);

  const nameOf = (key: string, current: string) => draftNames[key] ?? current;
  const inputCls = 'bg-transparent border-b border-transparent hover:border-[#e4e9e5] focus:border-[#047246] focus:outline-none py-0.5';

  return (
    <div className={embedded ? 'pb-12' : 'max-w-4xl mx-auto px-4 py-6 pb-24'}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          {!embedded && <button type="button" onClick={() => router.push(listHref)} className="inline-flex items-center gap-1 text-sm text-[#8a948d] hover:text-[#14201a] mb-2 cursor-pointer"><ArrowLeft size={15} /> AMC Contracts</button>}
          {!embedded && <h1 className="text-2xl font-bold text-[#14201a]">Contract categories</h1>}
          <p className="text-sm text-[#5f6b63] max-w-xl">{embedded ? 'How contracts are grouped on the month-end report. Edit any name in place.' : 'The categories a contract can fall under, each with its sub-categories — the rows the month-end report groups by. Edit any name in place; switch one off to keep its history but stop offering it.'}</p>
        </div>
        <button type="button" onClick={() => setAddKind(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#047246] text-white text-sm font-semibold px-3 py-2 shrink-0 cursor-pointer"><Plus size={15} /> Add category</button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
      {rows == null && <div className="flex items-center gap-2 py-12 justify-center text-sm text-[#8a948d]"><Loader2 size={16} className="animate-spin" /> Loading…</div>}

      <div className="space-y-4">
        {rows != null && kinds.filter(k => k.isActive !== false).map(k => {
          const cats = rows.filter(c => c.defaultKind === k.key);
          const kKey = `k${k.id ?? k.key}`;
          return (
            <div key={k.key} className="rounded-2xl border border-[#e4e9e5] bg-white overflow-hidden">
              <div className="flex items-center gap-3 px-4 sm:px-5 py-3 bg-[#f6f8f6] border-b border-[#eef1ef] flex-wrap">
                <input value={nameOf(kKey, k.label)} onChange={e => setDraftNames(d => ({ ...d, [kKey]: e.target.value }))}
                  onBlur={() => { const v = (draftNames[kKey] ?? k.label).trim(); if (v && v !== k.label) kindPatch(k, { label: v }); setDraftNames(d => { const n = { ...d }; delete n[kKey]; return n; }); }}
                  className={inputCls + ' text-sm font-bold text-[#14201a] min-w-[10rem]'} />
                {savingKey === kKey ? <Loader2 size={12} className="animate-spin text-[#8a948d]" /> : savedKey === kKey ? <Check size={13} className="text-[#047246]" /> : null}
                <span className="text-[11px] text-[#8a948d]">· {k.contracts ?? 0} contract{(k.contracts ?? 0) === 1 ? '' : 's'}</span>
                <div className="ml-auto flex items-center gap-4 flex-wrap">
                  {/* Built-in categories are always on and fixed in behaviour — nothing to switch. Only a
                      category the landlord added has Settings and can be removed (owner, 12 Sep: keep it simple). */}
                  {k.isBuiltin === false && <button type="button" onClick={() => setSettingsFor(k)} className="text-xs font-semibold text-[#5f6b63] hover:text-[#14201a] cursor-pointer">Settings</button>}
                  {k.isBuiltin === false && (k.contracts ?? 0) === 0 && <button type="button" onClick={() => kindPatch(k, { isActive: false })} className="text-xs font-semibold text-[#b91c1c] hover:opacity-75 cursor-pointer">Remove</button>}
                  <button type="button" onClick={() => setAddCat(k)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#047246] hover:opacity-75 cursor-pointer"><Plus size={13} /> Add sub-category</button>
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {cats.map(c => {
                    const cKey = `c${c.id}`;
                    return (
                      <tr key={c.id} className={`border-b border-[#f9f8f6] last:border-0 ${c.isActive ? '' : 'opacity-50'}`}>
                        <td className="px-4 sm:px-5 py-2">
                          <div className="flex items-center gap-2">
                            <input value={nameOf(cKey, c.name)} onChange={e => setDraftNames(d => ({ ...d, [cKey]: e.target.value }))}
                              onBlur={() => { const v = (draftNames[cKey] ?? c.name).trim(); if (v && v !== c.name) catPatch(c, { name: v }); setDraftNames(d => { const n = { ...d }; delete n[cKey]; return n; }); }}
                              className={inputCls + ' w-full min-w-[14rem] text-[13px]'} />
                            {savingKey === cKey ? <Loader2 size={12} className="animate-spin text-[#8a948d]" /> : savedKey === cKey ? <Check size={13} className="text-[#047246]" /> : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-[11px] text-[#8a948d] whitespace-nowrap tabular-nums">{c.contracts} contract{c.contracts === 1 ? '' : 's'}</td>
                        <td className="px-4 py-2 text-center w-20"><Toggle on={c.isActive} onClick={() => catPatch(c, { isActive: !c.isActive })} label="Active" /></td>
                      </tr>
                    );
                  })}
                  {cats.length === 0 && <tr><td className="px-4 sm:px-5 py-3 text-[12px] text-[#8a948d]" colSpan={3}>No sub-categories yet.</td></tr>}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {addCat && <SmallDialog title={`Add sub-category · ${addCat.label}`} fields={[{ key: 'name', label: 'Sub-category name', placeholder: 'e.g. Generator Maintenance' }]}
        onCancel={() => setAddCat(null)}
        onSubmit={async v => { await apiPost(scoped(base, rp, '/categories'), { name: v.name, defaultKind: addCat.key }); setAddCat(null); load(); }} />}
      {settingsFor && (
        <KindSettingsDialog kind={settingsFor} onCancel={() => setSettingsFor(null)}
          onSave={async v => { if (settingsFor.id != null) await apiPatch(scoped(base, rp, `/kinds/${settingsFor.id}`), { hasVisits: v.hasVisits, schedule: v.schedule, hint: v.hint }); setSettingsFor(null); await reloadKinds(); }} />
      )}
      {addKind && (
        <KindSettingsDialog kind={null} onCancel={() => setAddKind(false)}
          onSave={async v => { await apiPost(scoped(base, rp, '/kinds'), { label: v.label, hint: v.hint, hasVisits: v.hasVisits, schedule: v.schedule }); setAddKind(false); await reloadKinds(); }} />
      )}
    </div>
  );
}

/**
 * A category's behaviour — visits or not, and how the money is scheduled. Asked
 * when the category is ADDED (owner, 12 Sep: "while adding it should be asking at
 * that time"), and editable later from Settings on the card (kind = null ⇒ add).
 */
function KindSettingsDialog({ kind, onCancel, onSave }: { kind: KindMeta | null; onCancel: () => void; onSave: (v: { label: string; hasVisits: boolean; schedule: string; hint: string | null }) => Promise<void> }) {
  const [label, setLabel] = useState(kind?.label ?? '');
  const [visits, setVisits] = useState(kind?.visits ?? false);
  const [schedule, setSchedule] = useState<'fixed' | 'bills' | 'none'>(kind?.schedule ?? 'fixed');
  const hint = kind?.hint ?? '';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="w-[min(440px,100%)] bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#047246] text-white px-5 py-3.5">
          <div className="font-bold text-sm">{kind ? `Settings · ${kind.label}` : 'Add category'}</div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20 cursor-pointer" aria-label="Close"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-4">
          {!kind && (
            <div>
              <label className="block text-xs font-semibold text-[#5f6b63] mb-1">Category name</label>
              <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Licence & permits" className="w-full text-sm border border-[#e4e9e5] rounded-lg px-3 py-2 focus:outline-none focus:border-[#047246]" />
            </div>
          )}
          <div>
            <span className="block text-sm font-semibold text-[#14201a] mb-1.5">How the money is scheduled</span>
            <div className="grid gap-1.5">
              {SCHEDULES.map(o => (
                <label key={o.value} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer ${schedule === o.value ? 'border-[#047246] bg-[#eef9f4]' : 'border-[#e4e9e5]'}`}>
                  <input type="radio" name="schedule" checked={schedule === o.value} onChange={() => setSchedule(o.value)} />
                  <span><span className="block text-[13px] font-semibold text-[#14201a]">{o.label}</span><span className="block text-xs text-[#5f6b63]">{o.hint}</span></span>
                </label>
              ))}
            </div>
          </div>
          {/* Visits are a question only when there is a schedule at all; ad-hoc spend never has a maintenance plan. */}
          {schedule !== 'none' && (
            <label className="flex items-center gap-2.5 text-sm text-[#14201a] cursor-pointer">
              <input type="checkbox" checked={visits} onChange={e => setVisits(e.target.checked)} className="w-4 h-4 accent-[#047246]" />
              Vendor visits on a schedule
            </label>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#f0ede8]">
          <button type="button" onClick={onCancel} disabled={busy} className="text-sm font-semibold px-3 py-2 rounded-lg border border-[#e4e9e5] text-[#5f6b63] hover:bg-[#eef1ef] disabled:opacity-60 cursor-pointer">Cancel</button>
          <button type="button" disabled={busy || (!kind && !label.trim())} onClick={() => { setBusy(true); setErr(null); onSave({ label: label.trim(), hasVisits: schedule === 'none' ? false : visits, schedule, hint: hint.trim() || null }).catch(e => setErr((e as Error)?.message || 'Could not save.')).finally(() => setBusy(false)); }}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#047246] text-white hover:bg-[#267a65] disabled:opacity-60 cursor-pointer">{busy ? <Loader2 size={14} className="animate-spin" /> : kind ? <Check size={14} /> : <Plus size={14} />} {kind ? 'Save' : 'Add category'}</button>
        </div>
      </div>
    </div>
  );
}

/** The Restoration List's add dialog, generalised: a couple of fields, Enter submits. */
function SmallDialog({ title, fields, extra, onCancel, onSubmit }: {
  title: string; fields: { key: string; label: string; placeholder?: string }[]; extra?: React.ReactNode;
  onCancel: () => void; onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!values[fields[0].key]?.trim()) { setErr(`${fields[0].label} is required.`); return; }
    setBusy(true); setErr(null);
    try { await onSubmit(Object.fromEntries(fields.map(f => [f.key, (values[f.key] ?? '').trim()]))); }
    catch (e) { setErr((e as Error)?.message || 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="w-[min(420px,100%)] bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#047246] text-white px-5 py-3.5">
          <div className="font-bold text-sm">{title}</div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20 cursor-pointer" aria-label="Close"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-4">
          {fields.map((f, i) => (
            <div key={f.key}>
              <label className="block text-xs font-semibold text-[#5f6b63] mb-1">{f.label}</label>
              <input autoFocus={i === 0} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') void submit(); }} placeholder={f.placeholder}
                className="w-full text-sm border border-[#e4e9e5] rounded-lg px-3 py-2 focus:outline-none focus:border-[#047246]" />
            </div>
          ))}
          {extra}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#f0ede8]">
          <button type="button" onClick={onCancel} disabled={busy} className="text-sm font-semibold px-3 py-2 rounded-lg border border-[#e4e9e5] text-[#5f6b63] hover:bg-[#eef1ef] disabled:opacity-60 cursor-pointer">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#047246] text-white hover:bg-[#267a65] disabled:opacity-60 cursor-pointer">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
          </button>
        </div>
      </div>
    </div>
  );
}
