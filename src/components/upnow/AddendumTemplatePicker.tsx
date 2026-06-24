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

export default function AddendumTemplatePicker({ onPick, manager, rpQ, selectedName }: {
  onPick: (terms: AddendumTerms, name: string) => void;
  manager?: { rp: number };
  rpQ?: string;
  /** When provided, the dropdown is CONTROLLED and shows this as the selected
   *  template (matched by name, else listed as the current one) instead of
   *  resetting to "Choose a template…". Omit it to keep the action behaviour. */
  selectedName?: string;
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

  // Preselect the matching template (by name) when a selectedName is supplied.
  useEffect(() => {
    if (!tpls || !controlled) return;
    const m = tpls.find(t => t.name === selectedName);
    setVal(m ? String(m.id) : ((selectedName ?? '').trim() ? '__current__' : ''));
  }, [tpls, selectedName, controlled]);

  if (tpls === null) {
    return <span className="text-[11px] text-[#9b9890] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading templates…</span>;
  }
  if (tpls.length === 0) return null;

  const hasCurrent = controlled && (selectedName ?? '').trim() && !tpls.some(t => t.name === selectedName);

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
        className="appearance-none max-w-[14rem] pl-3 pr-8 py-1.5 rounded-lg border border-[#e8e6e0] bg-white text-xs font-semibold text-[#1a1916] focus:outline-none focus:border-[#2e9f82] cursor-pointer">
        {hasCurrent && <option value="__current__">{selectedName}</option>}
        <option value="">Choose a template…</option>
        {tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9b9890] pointer-events-none" />
    </div>
  );
}
