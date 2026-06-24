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

export default function AddendumTemplatePicker({ onPick, manager, rpQ }: {
  onPick: (terms: AddendumTerms, name: string) => void;
  manager?: { rp: number };
  rpQ?: string;
}) {
  const [tpls, setTpls] = useState<Tpl[] | null>(null);
  useEffect(() => {
    const url = manager ? `/manager/templates?${rpQ ?? ''}` : '/addendum-templates';
    apiGet<Tpl[]>(url)
      .then(list => setTpls((list || []).filter(t => t.terms && hasAddendumTerms(t.terms))))
      .catch(() => setTpls([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tpls === null) {
    return <span className="text-[11px] text-[#9b9890] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading templates…</span>;
  }
  if (tpls.length === 0) return null;

  return (
    <div className="relative inline-block">
      <select defaultValue=""
        onChange={e => {
          const t = tpls.find(x => String(x.id) === e.target.value);
          if (t?.terms) onPick({ ...t.terms }, t.name);
          e.target.value = '';
        }}
        className="appearance-none pl-3 pr-8 py-1.5 rounded-lg border border-[#e8e6e0] bg-white text-xs font-semibold text-[#1a1916] focus:outline-none focus:border-[#2e9f82] cursor-pointer">
        <option value="">Choose a template…</option>
        {tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9b9890] pointer-events-none" />
    </div>
  );
}
