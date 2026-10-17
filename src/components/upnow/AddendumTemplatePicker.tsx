'use client';

/**
 * "Choose a template" dropdown — lists the RP's in-app (text) addendum templates
 * so they can start an addendum from a saved one instead of writing from scratch.
 * Picking one hands its terms to the parent (which then lets them edit/save).
 * Renders nothing if the RP has no text templates yet.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type AddendumTerms, hasAddendumTerms } from '@/lib/addendumTerms';

interface Tpl { id: number; name: string; terms: AddendumTerms | null }

/** Content key for an addendum — the trimmed, non-empty EN/AR lines. Two
 *  addendums with the same body match even if their (generic) jsonb name differs
 *  from the template's display name. */
function termsKey(t: AddendumTerms | null | undefined): string {
  const norm = (a?: string[]) => (a ?? []).map(s => s.trim()).filter(Boolean);
  return JSON.stringify({ en: norm(t?.en), ar: norm(t?.ar) });
}

export default function AddendumTemplatePicker({ onPick, manager, rpQ, selectedName, selectedTerms }: {
  onPick: (terms: AddendumTerms, name: string) => void;
  manager?: { rp: number };
  rpQ?: string;
  /** When provided, the dropdown is CONTROLLED and shows this as the selected
   *  template (matched by name, else listed as the current one) instead of
   *  resetting to "Choose a template…". Omit it to keep the action behaviour. */
  selectedName?: string;
  /** The applied addendum's terms — used to match the source template by CONTENT
   *  (the stored jsonb name is generic and won't match a template's display name). */
  selectedTerms?: AddendumTerms | null;
}) {
  const [tpls, setTpls] = useState<Tpl[] | null>(null);
  const [val, setVal] = useState('');
  const controlled = selectedName !== undefined;
  useEffect(() => {
    const url = manager ? `/manager/templates?${rpQ ?? ''}` : '/addendum-templates';
    apiGet<Tpl[]>(url)
      .then(list => setTpls((list || []).filter(t => t.terms && hasAddendumTerms(t.terms))))
      .catch(() => setTpls([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preselect the source template. Prefer a CONTENT match (the applied addendum
  // carries a generic jsonb name that won't equal the template's display name),
  // then fall back to a name match, then to the "current" pseudo-option.
  useEffect(() => {
    if (!tpls || !controlled) return;
    if (selectedTerms && hasAddendumTerms(selectedTerms)) {
      const key = termsKey(selectedTerms);
      const byContent = tpls.find(t => t.terms && termsKey(t.terms) === key);
      if (byContent) { setVal(String(byContent.id)); return; }
    }
    const byName = tpls.find(t => t.name === selectedName);
    setVal(byName ? String(byName.id) : ((selectedName ?? '').trim() ? '__current__' : ''));
  }, [tpls, selectedName, selectedTerms, controlled]);

  if (tpls === null) {
    return <span className="text-[11px] text-[#8a948d] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading templates…</span>;
  }
  if (tpls.length === 0) return null;

  // Only show the "current" pseudo-option when we actually fell back to it (a
  // genuinely custom addendum that matches no template by content or name).
  const hasCurrent = controlled && val === '__current__' && !!(selectedName ?? '').trim();

  return (
    <div className="relative inline-block">
      <select
        {...(controlled ? { value: val } : { defaultValue: '' })}
        onChange={e => {
          const v = e.target.value;
          const t = tpls.find(x => String(x.id) === v);
          if (t?.terms) onPick({ ...t.terms }, t.name);
          if (controlled) setVal(v); else e.target.value = '';
        }}
        className="appearance-none min-w-[13rem] max-w-[22rem] pl-3 pr-8 py-1.5 rounded-lg border border-[#e4e9e5] bg-white text-xs font-semibold text-[#14201a] focus:outline-none focus:border-[#047246] cursor-pointer">
        {hasCurrent && <option value="__current__">{selectedName}</option>}
        <option value="">Choose a template…</option>
        {tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a948d] pointer-events-none" />
    </div>
  );
}
