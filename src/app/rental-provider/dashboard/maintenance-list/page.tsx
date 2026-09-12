'use client';

/**
 * RP → Maintenance List — the maintenance items customers can raise during a
 * tenancy, in the SAME layout as the Restoration List: one card per category
 * with an item table, "Add item" per card, "Add category" up top. Platform
 * rows are defaults every landlord starts from — hide what you don't handle
 * (never deleted; restore any time); your own categories and items are fully
 * editable inline. Coverage + provider assignment live in Settings →
 * Maintenance. Owner-directed 31 Aug 2026.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, RotateCcw, Loader2, X, EyeOff, Trash2, Check } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

interface Cat { id: number; name: string; parentId?: number | null; own?: boolean; oneTime?: boolean; audience?: 'tenant' | 'landlord'; scopes?: string[] | null }
interface Payload {
  categories: Cat[];
  hiddenCategories?: { id: number; name: string; own: boolean }[];
}

/**
 * Rendered directly for the landlord (no `manager`); the manager page passes
 * `manager={{ rp }}`, which swaps every call to the landlord-scoped
 * /manager/maintenance/*?rp= mirror (gated by canManageMaintenance).
 */
export function MaintenanceListWorkspace({ manager, embedded = false }: { manager?: { rp: number }; embedded?: boolean }) {
  const router = useRouter();
  const u = useCallback((path: string) => manager
    ? `/manager/maintenance${path}${path.includes('?') ? '&' : '?'}rp=${manager.rp}`
    : `/maintenance${path}`, [manager]);
  const coverageHref = manager
    ? `/dashboard/manager/maintenance-coverage?rp=${manager.rp}`
    : '/rental-provider/dashboard/settings?tab=maintenance';
  const [data, setData] = useState<Payload | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [addTo, setAddTo] = useState<{ groupId: number; label: string } | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await apiGet<Payload>(u('/policies'));
      setData(d);
      setNames(Object.fromEntries(d.categories.map(c => [c.id, c.name])));
    } catch { setError('Could not load the maintenance list.'); }
    finally { setLoading(false); }
  }, [u]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work — try again.'); }
    finally { setBusy(false); }
  };

  /** Inline rename (own rows only) — saves on blur, like the price book. */
  const saveName = async (c: Cat) => {
    const name = (names[c.id] ?? '').trim();
    if (!name || name === c.name) { setNames(n => ({ ...n, [c.id]: c.name })); return; }
    try {
      await apiPatch(u(`/categories/${c.id}`), { name });
      setSavedId(c.id); setTimeout(() => setSavedId(s => (s === c.id ? null : s)), 1500);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed.');
      setNames(n => ({ ...n, [c.id]: c.name }));
    }
  };

  const removeRow = (c: Cat, isGroup: boolean) => {
    const q = c.own
      ? `Remove "${c.name}"?${isGroup ? ' (must be empty)' : ''}`
      : `Hide "${c.name}" from your list?${isGroup ? ' Its items go with it.' : ''} You can restore it later.`;
    if (window.confirm(q)) void act(() => apiDelete(u(`/categories/${c.id}`)));
  };

  const groups = useMemo(() => {
    if (!data) return [];
    return data.categories
      .filter(g => g.parentId == null)
      .map(g => ({ group: g, items: data.categories.filter(c => c.parentId === g.id) }));
  }, [data]);

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9b9890]"><Loader2 className="animate-spin mr-2" /> Loading maintenance list…</div>;
  }

  return (
    <div className={embedded ? 'pb-12' : 'max-w-4xl mx-auto px-4 py-6 pb-24'}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          {!embedded && <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-[#9b9890] hover:text-[#1a1916] mb-2 cursor-pointer">
            <ArrowLeft size={15} /> Back
          </button>}
          {!embedded && <h1 className="text-2xl font-bold text-[#1a1916]">Maintenance List</h1>}
          {embedded
            ? <p className="text-sm text-[#6b6860]">What a customer can raise during a tenancy. Hide what you don&apos;t handle; add your own.</p>
            : <p className="text-sm text-[#6b6860] max-w-xl">
                The maintenance items your customers can raise during a tenancy, grouped the way services
                are offered. What&apos;s <span className="font-semibold">covered</span>, for which property type,
                and which provider does the work is set in{' '}
                <Link href={coverageHref} className="text-[#1a7a5a] font-semibold underline">{manager ? 'Maintenance Coverage' : 'Settings → Maintenance coverage'}</Link>.
              </p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setAddingCategory(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-3 py-2 disabled:opacity-60">
            <Plus size={15} /> Add category
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="space-y-4">
        {groups.map(({ group, items }) => (
          <div key={group.id} className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 bg-[#fafaf8] border-b border-[#f4f3ef]">
              <div className="flex items-baseline gap-2 min-w-0">
                {group.own ? (
                  <input value={names[group.id] ?? group.name}
                    onChange={e => setNames(n => ({ ...n, [group.id]: e.target.value }))}
                    onBlur={() => void saveName(group)}
                    className="text-sm font-bold text-[#1a1916] bg-transparent border-b border-transparent hover:border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none min-w-0" />
                ) : (
                  <span className="text-sm font-bold text-[#1a1916]">{group.name}</span>
                )}
                {group.own && <span className="text-[9px] font-bold uppercase tracking-wide text-[#0369a1] bg-[#e0f2fe] px-1.5 py-0.5 rounded shrink-0">yours</span>}
                {group.audience === 'landlord' && (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-[#2e6f5e] bg-[#eef3f1] px-1.5 py-0.5 rounded shrink-0"
                    title="Raised by you, never by a customer — your own work on the building. No coverage rule needed: you pay.">
                    {group.scopes?.[0] === 'building_system' ? 'building systems · you raise' : group.scopes?.[0] === 'common_area' ? 'common areas · you raise' : 'landlord only'}
                  </span>
                )}
                <span className="text-[11px] text-[#9b9890] shrink-0">· {items.length} item{items.length === 1 ? '' : 's'}</span>
                {savedId === group.id && <Check size={13} className="text-[#2e9f82] shrink-0" />}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button type="button" onClick={() => setAddTo({ groupId: group.id, label: group.name })}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#2e9f82] hover:opacity-75 cursor-pointer">
                  <Plus size={13} /> Add item
                </button>
                <button type="button" onClick={() => removeRow(group, true)} disabled={busy}
                  title={group.own ? 'Remove this category (must be empty)' : 'Hide this category and its items from your list'}
                  className="text-[#c5c2bc] hover:text-[#b91c1c] cursor-pointer">
                  {group.own ? <Trash2 size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {items.map(c => (
                  <tr key={c.id} className="border-b border-[#f9f8f6] last:border-0">
                    <td className="px-4 sm:px-5 py-2">
                      <div className="flex items-center gap-2">
                        {c.own ? (
                          <input value={names[c.id] ?? c.name}
                            onChange={e => setNames(n => ({ ...n, [c.id]: e.target.value }))}
                            onBlur={() => void saveName(c)}
                            className="w-full min-w-[14rem] text-[13px] bg-transparent border-b border-transparent hover:border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none py-0.5" />
                        ) : (
                          <span className="text-[13px] text-[#1a1916]">{c.name}</span>
                        )}
                        {c.own && <span className="text-[9px] font-bold uppercase tracking-wide text-[#0369a1] bg-[#e0f2fe] px-1.5 py-0.5 rounded shrink-0">yours</span>}
                        {c.oneTime && <span title="The contract covers this once per tenancy — a repeat request is the customer's" className="text-[9px] font-bold uppercase tracking-wide text-[#92400e] bg-[#fef3c7] px-1.5 py-0.5 rounded shrink-0">once per tenancy</span>}
                        {savedId === c.id && <Check size={13} className="text-[#2e9f82] shrink-0" />}
                      </div>
                    </td>
                    <td className="px-4 sm:px-5 py-2 text-right w-16">
                      <button type="button" onClick={() => removeRow(c, false)} disabled={busy}
                        title={c.own ? 'Remove your item' : 'Hide this item from your list'}
                        className="text-[#c5c2bc] hover:text-[#b91c1c] cursor-pointer align-middle">
                        {c.own ? <Trash2 size={13} /> : <EyeOff size={13} />}
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td className="px-4 sm:px-5 py-3 text-xs text-[#9b9890]">No items yet — add one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {(data?.hiddenCategories?.length ?? 0) > 0 && (
        <div className="mt-5 rounded-2xl border border-[#e8e6e0] bg-white px-4 py-3 flex items-center gap-2 flex-wrap text-[11px] text-[#9b9890]">
          <span className="font-semibold">Hidden:</span>
          {data!.hiddenCategories!.map(h => (
            <button key={h.id} type="button" disabled={busy}
              onClick={() => act(() => apiPost(u(`/categories/${h.id}/restore`)))}
              title="Restore"
              className="inline-flex items-center gap-1 border border-[#e8e6e0] rounded-full px-2 py-0.5 hover:border-[#2e9f82] hover:text-[#1a7a5a] cursor-pointer">
              <RotateCcw size={9} /> {h.name}
            </button>
          ))}
        </div>
      )}

      {addTo && (
        <AddNameModal
          title={`Add item · ${addTo.label}`}
          placeholder="e.g. Water pump & motor"
          label="Item name"
          onCancel={() => setAddTo(null)}
          onAdd={async (name) => {
            try { await apiPost(u('/categories'), { name, parentId: addTo.groupId }); await load(); setAddTo(null); return null; }
            catch (e) { return e instanceof Error ? e.message : 'Could not add the item.'; }
          }}
        />
      )}
      {addingCategory && (
        <AddCategoryModal
          onCancel={() => setAddingCategory(false)}
          onAdd={async (category, firstItem) => {
            try {
              const cats = await apiPost<Cat[]>(u('/categories'), { name: category });
              if (firstItem) {
                const g = cats.find(c => c.parentId == null && c.name === category);
                if (g) await apiPost(u('/categories'), { name: firstItem, parentId: g.id });
              }
              await load(); setAddingCategory(false); return null;
            } catch (e) { return e instanceof Error ? e.message : 'Could not add the category.'; }
          }}
        />
      )}
    </div>
  );
}

export default function MaintenanceListPage() {
  return <MaintenanceListWorkspace />;
}

/** Popup to add a new category of your own (optionally seeded with its first item). */
function AddCategoryModal({ onCancel, onAdd }: {
  onCancel: () => void;
  onAdd: (category: string, firstItem: string) => Promise<string | null>;
}) {
  const [category, setCategory] = useState('');
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!category.trim()) { setErr('Enter a category name.'); return; }
    setBusy(true); setErr(null);
    const e = await onAdd(category.trim(), item.trim());
    setBusy(false);
    if (e) setErr(e);
  };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="w-[min(440px,100%)] bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#2e9f82] text-white px-5 py-3.5">
          <div className="font-bold text-sm">Add category</div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20" aria-label="Close"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#6b6860] mb-1">Category name</label>
            <input autoFocus value={category} onChange={e => setCategory(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
              placeholder="e.g. Appliances, Glass & Mirrors"
              className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6b6860] mb-1">First item (optional)</label>
            <input value={item} onChange={e => setItem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
              placeholder="e.g. Oven & hob"
              className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#f0ede8]">
          <button type="button" onClick={onCancel} disabled={busy}
            className="text-sm font-semibold px-3 py-2 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-60">Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add category
          </button>
        </div>
      </div>
    </div>
  );
}

/** Popup to add one item (name only — coverage is configured in Settings). */
function AddNameModal({ title, label, placeholder, onCancel, onAdd }: {
  title: string; label: string; placeholder: string;
  onCancel: () => void;
  onAdd: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) { setErr(`Enter ${label.toLowerCase()}.`); return; }
    setBusy(true); setErr(null);
    const e = await onAdd(name.trim());
    setBusy(false);
    if (e) setErr(e);
  };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="w-[min(420px,100%)] bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#2e9f82] text-white px-5 py-3.5">
          <div className="font-bold text-sm">{title}</div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20" aria-label="Close"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#6b6860] mb-1">{label}</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
              placeholder={placeholder}
              className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#f0ede8]">
          <button type="button" onClick={onCancel} disabled={busy}
            className="text-sm font-semibold px-3 py-2 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-60">Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
          </button>
        </div>
      </div>
    </div>
  );
}
