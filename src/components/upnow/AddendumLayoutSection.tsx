'use client';

import { useEffect, useState } from 'react';
import { Star, Check, Loader2, Eye, Pencil } from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { type AddendumTerms, emptyAddendumTerms, hasAddendumTerms } from '@/lib/addendumTerms';
import { categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import AddendumEditorModal from '@/components/upnow/AddendumEditorModal';
import AddendumTemplatePicker from '@/components/upnow/AddendumTemplatePicker';

interface DefaultTemplate { id: number; name: string; fileUrl: string | null; source: 'subcategory' | 'category' }
interface DefaultResp { template: DefaultTemplate | null; category: string | null; unitType: string | null }

/**
 * The new in-app addendum integration as a self-contained block — the SAME one in
 * the /units Plan Terms modal — so the per-unit Edit form gets the template picker,
 * the RP's preselected default (by category / unit-type), the bilingual editor and
 * preview. The addendum is LAYOUT-level (one per floor-plan / planLabel), so it
 * saves itself directly to the layout (PATCH addendum-terms / POST from-template),
 * independent of the unit save, and pings `onApplied` so the caller can refresh.
 */
export default function AddendumLayoutSection({
  propertyId, planLabel, seedTerms, hasExistingFile, manager, rpQ, onApplied,
}: {
  propertyId: number;
  planLabel: string;
  seedTerms?: AddendumTerms | null;
  hasExistingFile?: boolean;
  manager?: { rp: number } | null;
  rpQ?: string;
  onApplied?: () => void;
}) {
  const [terms, setTerms] = useState<AddendumTerms>(() => seedTerms ?? emptyAddendumTerms());
  const seededJson = JSON.stringify(seedTerms ?? emptyAddendumTerms());
  const [editorOpen, setEditorOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'default' | null>(null);
  const [saved, setSaved] = useState(false);
  const [defaultResp, setDefaultResp] = useState<DefaultResp | null>(null);

  const hasTerms = hasAddendumTerms(terms);
  const hasAddendum = hasTerms || !!hasExistingFile;
  const suggested = defaultResp?.template ?? null;

  // Offer the RP's default template for this layout's category / unit-type when
  // the layout has no addendum yet.
  useEffect(() => {
    if (hasAddendum) return;
    let live = true;
    const qs = new URLSearchParams({ propertyId: String(propertyId), planLabel });
    const url = manager
      ? `/manager/units/addendum-default?${[rpQ, qs.toString()].filter(Boolean).join('&')}`
      : `/properties/floor-plans/addendum-default?${qs.toString()}`;
    apiGet<DefaultResp>(url).then(r => { if (live) setDefaultResp(r); }).catch(() => { if (live) setDefaultResp(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scope = defaultResp
    ? (defaultResp.unitType
        ? `${categoryDisplayLabel(defaultResp.category ?? '')} › ${defaultResp.unitType}`
        : categoryDisplayLabel(defaultResp.category ?? ''))
    : null;

  const useDefault = async () => {
    if (!suggested) return;
    setBusy('default'); setErr(null);
    try {
      const url = manager ? `/manager/units/addendum/from-template?${rpQ}` : '/properties/floor-plans/addendum/from-template';
      await apiPost(url, { propertyId, planLabel, templateId: suggested.id });
      setDefaultResp(null); setSaved(true);
      onApplied?.();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not apply the default'); }
    finally { setBusy(null); }
  };

  const saveTerms = async () => {
    setBusy('save'); setErr(null);
    try {
      const url = manager ? `/manager/units/addendum-terms?${rpQ}` : '/properties/floor-plans/addendum-terms';
      await apiPatch(url, { propertyId, planLabel, terms });
      setSaved(true);
      onApplied?.();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save the addendum'); }
    finally { setBusy(null); }
  };

  const dirty = hasTerms && JSON.stringify(terms) !== seededJson;
  const n = (terms.en?.filter(l => l.trim()).length ?? 0) + (terms.ar?.filter(l => l.trim()).length ?? 0);

  // Open a print-style preview of the addendum in a NEW WINDOW (not an in-app modal).
  const previewInNewWindow = () => {
    const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
    const render = (arr?: string[]) => (arr ?? []).filter(l => l.trim()).map(l =>
      /[A-Z]/.test(l) && l === l.toUpperCase()
        ? `<h3 style="margin:14px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#1a1916">${esc(l)}</h3>`
        : `<p style="margin:4px 0;font-size:12px;line-height:1.55;color:#3d3b35">${esc(l)}</p>`).join('');
    const title = terms.name?.trim() || 'Agreement Addendum';
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) { setErr('Please allow pop-ups to preview the addendum.'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
      <body style="font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:32px auto;padding:0 24px">
        <h1 style="font-size:18px;color:#1a1916;border-bottom:2px solid #b45309;padding-bottom:8px">${esc(title)}</h1>
        ${render(terms.en)}
        ${(terms.ar ?? []).some(l => l.trim()) ? `<hr style="margin:20px 0;border:none;border-top:1px solid #e8e6e0"><div dir="rtl" style="text-align:right">${render(terms.ar)}</div>` : ''}
        <p style="margin-top:24px;font-size:10px;color:#9b9890">A tenant &amp; landlord signature block is added automatically on the contract.</p>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#b45309]">Agreement — Addendum</p>
      <p className="text-[10px] text-[#a16207]">
        The addendum terms new contracts from this layout carry. A tenant &amp; landlord signature block is added automatically. Applies to the whole floor-plan; saving mints a new version (signed contracts keep theirs).
      </p>

      {!hasAddendum && suggested && (
        <div className="rounded-lg border border-[#fcd34d] bg-white p-3 space-y-2">
          <div className="flex items-start gap-2">
            <Star size={14} className="text-[#b45309] fill-[#b45309] mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#1a1916] truncate">Suggested default · {suggested.name}</p>
              <p className="text-[10px] text-[#a16207] mt-0.5">
                Your {suggested.source === 'subcategory' ? 'sub-category' : 'category'} default{scope ? ` for ${scope}` : ''}. Apply it as a starting point, or write the terms below.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={useDefault} disabled={busy === 'default'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b45309] text-white text-xs font-semibold hover:bg-[#92400e] disabled:opacity-60 cursor-pointer">
              {busy === 'default' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Use this default
            </button>
            {suggested.fileUrl && (
              <a href={suggested.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b45309] hover:underline">
                <Eye size={12} /> Preview
              </a>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[#e8e6e0] bg-white px-3 py-2.5 space-y-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#1a1916] truncate">{terms.name?.trim() || 'Agreement Addendum'}</p>
          <p className="text-[11px] text-[#9b9890]">{n ? `${n} term${n === 1 ? '' : 's'} written` : (hasExistingFile ? 'File addendum attached' : 'No terms yet')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddendumTemplatePicker
            onPick={t => { setTerms(t); setSaved(false); }}
            manager={manager ?? undefined}
            rpQ={rpQ}
            selectedName={terms.name?.trim() || undefined}
          />
          {n > 0 && (
            <button type="button" onClick={previewInNewWindow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c5e8df] text-[#2e9f82] text-xs font-semibold hover:bg-[#f0faf6] cursor-pointer">
              <Eye size={13} /> Preview
            </button>
          )}
          <button type="button" onClick={() => { setEditorOpen(true); setSaved(false); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b45309] text-white text-xs font-semibold hover:bg-[#92400e] cursor-pointer">
            <Pencil size={13} /> {n ? 'Edit addendum' : 'Write new'}
          </button>
        </div>
      </div>

      {dirty && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={saveTerms} disabled={busy === 'save'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white text-xs font-semibold hover:bg-[#268a70] disabled:opacity-60 cursor-pointer">
            {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save addendum
          </button>
          <span className="text-[10px] text-[#9b9890]">Saves a new version for this floor-plan.</span>
        </div>
      )}
      {saved && !dirty && <p className="text-[11px] text-[#2e9f82]">Addendum saved.</p>}
      {err && <p className="text-[11px] text-red-600">{err}</p>}

      {editorOpen && <AddendumEditorModal value={terms} onChange={setTerms} onClose={() => setEditorOpen(false)} />}
    </div>
  );
}
