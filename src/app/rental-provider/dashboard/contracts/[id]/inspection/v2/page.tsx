'use client';

/**
 * Category-model inspection form (v2 preview) — design spec §6.
 *
 * Isolated route (does not touch the legacy /inspection page) so the redesigned
 * category-grouped move-in/move-out form can be validated end-to-end: the scaffold
 * (`buildCategoryInspection`), seeded prices, the two-axis Condition+Status, the
 * Quantity × Unit Cost = Total cost engine, and the live summary tiles.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import {
  InspectionDoc,
  InspectionItem,
  InspectionCategory,
  Condition,
  ItemStatus,
  computeInspectionTotals,
  severityOf,
  canonicalKey,
  CATALOG_BY_KEY,
  quantityOf,
  effectiveUnitCost,
  computeRowTotal,
} from '@/lib/inspectionCatalog';

type Phase = 'move_in' | 'move_out';

interface ContractMeta {
  property: string;
  unitNo: string;
  propertyType: string;
  floor: string;
  tenantName: string;
  tenantPhone: string;
  tenantEmail: string;
}

const AED = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COND_OPTS: { v: Exclude<Condition, ''>; label: string; on: string }[] = [
  { v: 'good', label: 'Good', on: 'bg-[#2e9f82] text-white border-transparent' },
  { v: 'fair', label: 'Fair', on: 'bg-[#f59e0b] text-white border-transparent' },
  { v: 'poor', label: 'Poor', on: 'bg-[#ef4444] text-white border-transparent' },
];

const SEV_DOT: Record<string, string> = {
  none: 'bg-[#c8c6be]', ok: 'bg-[#2e9f82]', warn: 'bg-[#f59e0b]', bad: 'bg-[#ef4444]',
};

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex-1 min-w-[130px] rounded-2xl border border-[#e8e6e0] bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] flex items-center gap-1">
        {warn && <AlertTriangle size={11} className="text-[#f59e0b]" />} {label}
      </p>
      <p className={`text-2xl font-bold mt-1 ${warn ? 'text-[#f59e0b]' : 'text-[#1a1916]'}`}>{value}</p>
    </div>
  );
}

function InfoCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="flex-1 min-w-[240px] rounded-2xl border border-[#e8e6e0] bg-white p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[#2e9f82] mb-2">{title}</h3>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-sm">
            <span className="text-[#9b9890]">{k}</span>
            <span className="font-semibold text-[#1a1916] text-right">{v || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConditionPicker({ value, onChange }: { value: Condition | undefined; onChange: (v: Condition) => void }) {
  return (
    <div className="flex gap-1">
      {COND_OPTS.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(value === o.v ? '' : o.v)}
          className={[
            'px-2 py-1 rounded-md text-[11px] font-bold border transition-colors',
            value === o.v ? o.on : 'border-[#e8e6e0] text-[#9b9890] hover:border-[#c8c6be] bg-white',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatusSelect({ catKey, value, onChange }: { catKey: string; value: ItemStatus | undefined; onChange: (v: ItemStatus | undefined) => void }) {
  const statuses = CATALOG_BY_KEY[canonicalKey(catKey)].statuses;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${SEV_DOT[severityOf(value, undefined)]}`} />
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as ItemStatus | undefined)}
        className="text-xs border border-[#e8e6e0] rounded-md px-1.5 py-1 bg-white text-[#1a1916] focus:outline-none focus:border-[#2e9f82] max-w-[8.5rem]"
      >
        <option value="">—</option>
        {statuses.map((s) => (
          <option key={s} value={s}>{s.replace('_', ' ')}</option>
        ))}
      </select>
    </div>
  );
}

export default function CategoryInspectionPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const phase = (search.get('type') ?? 'move_in') as Phase;
  const contractId = params?.id;
  const isMoveIn = phase === 'move_in';

  const [doc, setDoc] = useState<InspectionDoc | null>(null);
  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contractId) return;
    (async () => {
      setLoading(true);
      try {
        const [inspRes, cRes] = await Promise.all([
          fetch(`/api/contracts/${contractId}/inspection/v2?type=${phase}`, { credentials: 'include' }),
          fetch(`/api/contracts/${contractId}`, { credentials: 'include' }),
        ]);
        if (inspRes.ok) setDoc(await inspRes.json());
        else setError('Could not load the inspection.');
        if (cRes.ok) {
          const c = await cRes.json();
          setMeta({
            property: c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
            unitNo: c.unit?.number ?? c.unit?.unitNumber ?? '',
            propertyType: c.unit?.unitType ?? '',
            floor: c.unit?.floor != null ? String(c.unit.floor) : '',
            tenantName: c.tenant?.name ?? '',
            tenantPhone: c.tenant?.phone ?? '',
            tenantEmail: c.tenant?.email ?? '',
          });
        }
      } catch {
        setError('Unexpected error loading the inspection.');
      } finally {
        setLoading(false);
      }
    })();
  }, [contractId, phase]);

  const patchItem = useCallback((sectionId: string, itemId: string, patch: Partial<InspectionItem>) => {
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        categories: d.categories.map((cat) =>
          cat.sectionId !== sectionId ? cat : {
            ...cat,
            items: cat.items.map((it) => {
              if (it.id !== itemId) return it;
              const next = { ...it, ...patch };
              if (!next.totalCostManual) next.totalCostAed = computeRowTotal(next);
              return next;
            }),
          }),
      };
    });
  }, []);

  const totals = useMemo(() => computeInspectionTotals(doc, phase), [doc, phase]);

  async function handleSave() {
    if (!contractId || !doc) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: phase, data: doc, finalize: false }),
      });
      if (!res.ok) { setError('Save failed.'); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch { setError('Save failed.'); }
    finally { setSaving(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9b9890]"><Loader2 className="animate-spin mr-2" /> Loading inspection…</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <Link href={`/rental-provider/dashboard/contracts/${contractId}/v2`} className="inline-flex items-center gap-1 text-sm text-[#9b9890] hover:text-[#1a1916] mb-2">
            <ArrowLeft size={15} /> Back to contract
          </Link>
          <h1 className="text-3xl font-bold text-[#2e9f82] tracking-tight">
            {isMoveIn ? 'MOVE-IN' : 'MOVE-OUT'} INSPECTION REPORT
          </h1>
          <p className="text-sm text-[#6b6860]">Detailed inspection of property components and fixtures{isMoveIn ? ' at the time of move-in.' : '.'}</p>
        </div>
        <button
          type="button" onClick={handleSave} disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-60 shrink-0"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <CheckCircle size={16} /> : <Save size={16} />}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      {/* Info cards */}
      <div className="flex flex-wrap gap-3 mb-4">
        <InfoCard title="Property Details" rows={[['Property', meta?.property ?? ''], ['Unit No.', meta?.unitNo ?? ''], ['Type', meta?.propertyType ?? ''], ['Floor', meta?.floor ?? '']]} />
        <InfoCard title="Tenant Details" rows={[['Name', meta?.tenantName ?? ''], ['Phone', meta?.tenantPhone ?? ''], ['Email', meta?.tenantEmail ?? '']]} />
        <InfoCard title="Inspection Team" rows={[['Inspected By', doc?.inspectorName ?? '—'], ['Company', doc?.inspectorCompany ?? '—'], ['Role', doc?.inspectorRole ?? 'Property Representative']]} />
      </div>

      {/* Tiles */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Tile label="Total Categories" value={String(totals.categories)} />
        <Tile label="Total Items" value={String(totals.items)} />
        {isMoveIn
          ? <Tile label="Items To Be Replaced" value={String(totals.itemsToReplace)} />
          : <Tile label="Defective / Issues" value={String(totals.defective)} warn={totals.defective > 0} />}
        <Tile label="Estimated Total Cost (AED)" value={AED(totals.estCostAed)} warn={totals.estCostAed > 0} />
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {doc?.categories.map((cat) => (
          <Section key={cat.sectionId} cat={cat} phase={phase} onPatch={patchItem} />
        ))}
      </div>
    </div>
  );
}

function Section({ cat, phase, onPatch }: { cat: InspectionCategory; phase: Phase; onPatch: (s: string, i: string, p: Partial<InspectionItem>) => void }) {
  const isMoveIn = phase === 'move_in';
  const sectionTotals = useMemo(() => computeInspectionTotals({ categories: [cat] }, phase), [cat, phase]);
  const groups = useMemo(() => {
    const subs = cat.subCategories && cat.subCategories.length ? [...cat.subCategories, undefined] : [undefined];
    return subs
      .map((sub) => ({ sub, rows: cat.items.filter((it) => (sub ? it.subCategory === sub : !cat.subCategories?.includes(it.subCategory ?? ''))) }))
      .filter((g) => g.rows.length > 0);
  }, [cat]);

  return (
    <div className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-[#fafaf8] border-b border-[#f4f3ef]">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-bold text-[#1a1916] truncate">{cat.label}</span>
          <span className="text-[11px] text-[#9b9890]">· {cat.unitLabel} · {cat.count}</span>
        </div>
        <div className="text-[11px] text-[#6b6860] shrink-0">
          {sectionTotals.defective > 0 && <span className="text-[#ef4444] font-semibold mr-2">{sectionTotals.defective} issue{sectionTotals.defective > 1 ? 's' : ''}</span>}
          {sectionTotals.estCostAed > 0 && <span className="font-semibold">AED {AED(sectionTotals.estCostAed)}</span>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[880px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890] border-b border-[#f4f3ef]">
              <th className="py-2 px-3 font-semibold">Item</th>
              <th className="py-2 px-3 font-semibold">Location</th>
              <th className="py-2 px-3 font-semibold">Condition</th>
              <th className="py-2 px-3 font-semibold">Status</th>
              <th className="py-2 px-3 font-semibold text-right">Unit Cost</th>
              <th className="py-2 px-3 font-semibold text-center">{isMoveIn ? 'To Replace' : 'Qty'}</th>
              <th className="py-2 px-3 font-semibold text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <SubGroup key={g.sub ?? '_'} sub={g.sub} rows={g.rows} cat={cat} phase={phase} onPatch={onPatch} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubGroup({ sub, rows, cat, phase, onPatch }: { sub?: string; rows: InspectionItem[]; cat: InspectionCategory; phase: Phase; onPatch: (s: string, i: string, p: Partial<InspectionItem>) => void }) {
  const isMoveIn = phase === 'move_in';
  return (
    <>
      {sub && (
        <tr className="bg-[#f9faf9]">
          <td colSpan={7} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#2e9f82]">{sub}</td>
        </tr>
      )}
      {rows.map((it) => {
        const cond = (phase === 'move_out' ? it.outCondition : it.inCondition) ?? '';
        const status = phase === 'move_out' ? it.outStatus : it.inStatus;
        const unit = effectiveUnitCost(it) ?? 0;
        const qty = quantityOf(it);
        return (
          <tr key={it.id} className="border-b border-[#f9f8f6] last:border-0 align-middle">
            <td className="px-3 py-2 text-[#1a1916]">{it.componentName}</td>
            <td className="px-3 py-2">
              <input
                value={it.location}
                onChange={(e) => onPatch(cat.sectionId, it.id, { location: e.target.value })}
                className="w-full min-w-[9rem] text-[13px] bg-transparent border-b border-dashed border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none py-0.5"
              />
            </td>
            <td className="px-3 py-2">
              <ConditionPicker
                value={cond}
                onChange={(v) => onPatch(cat.sectionId, it.id, phase === 'move_out' ? { outCondition: v } : { inCondition: v })}
              />
            </td>
            <td className="px-3 py-2">
              <StatusSelect
                catKey={cat.key}
                value={status}
                onChange={(v) => onPatch(cat.sectionId, it.id, phase === 'move_out' ? { outStatus: v } : { inStatus: v })}
              />
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b6860]">
              {unit ? AED(unit) : '—'}
              {it.unitOfMeasure && it.unitOfMeasure !== 'item' && <span className="text-[10px] text-[#9b9890]">/{it.unitOfMeasure}</span>}
            </td>
            <td className="px-3 py-2 text-center">
              {isMoveIn ? (
                <span className="text-[#9b9890]">0</span>
              ) : (
                <input
                  type="number" min={0} step={it.unitOfMeasure && ['sqm', 'sqft', 'meter'].includes(it.unitOfMeasure) ? 0.5 : 1}
                  value={qty || ''}
                  placeholder="0"
                  onChange={(e) => onPatch(cat.sectionId, it.id, { quantity: Number(e.target.value) || 0 })}
                  className="w-16 text-center text-[13px] border border-[#e8e6e0] rounded-md px-1 py-1 focus:outline-none focus:border-[#2e9f82]"
                />
              )}
            </td>
            <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1a1916]">
              {isMoveIn ? '0.00' : AED(it.totalCostAed ?? 0)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
