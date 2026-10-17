/**
 * OperationsViewToggle — the List ⇄ Board switch shared by both Operations
 * views. It writes ?view=board (or drops the param for the default List view)
 * while preserving every other query param (e.g. the manager's ?rp=...), so the
 * page-level switch in operations/page.tsx can swap OperationsBoard ⇄
 * OperationsKanban without losing context.
 */
'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Rows3, LayoutGrid } from 'lucide-react';

export default function OperationsViewToggle({ active }: { active: 'list' | 'board' }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  const hrefFor = (view: 'list' | 'board') => {
    const params = new URLSearchParams(sp.toString());
    if (view === 'list') params.delete('view');
    else params.set('view', view);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="ops-view-toggle" role="tablist" aria-label="Operations view">
      <Link href={hrefFor('list')} className={active === 'list' ? 'on' : ''} role="tab" aria-selected={active === 'list'}>
        <Rows3 size={14} /> List
      </Link>
      <Link href={hrefFor('board')} className={active === 'board' ? 'on' : ''} role="tab" aria-selected={active === 'board'}>
        <LayoutGrid size={14} /> Board
      </Link>
      <style jsx global>{`
        .ops-view-toggle{ display:inline-flex; align-items:center; gap:2px; padding:3px; background:#fff; border:1px solid #e4e9e5; border-radius:10px; }
        .ops-view-toggle a{ display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:8px; font-size:12.5px; font-weight:600; color:#5f6b63; text-decoration:none; line-height:1; white-space:nowrap; transition:color .15s, background .15s; }
        .ops-view-toggle a:hover{ color:#46534c; }
        .ops-view-toggle a.on{ color:#1a7a5a; background:#ebf8f2; }
        .ops-view-toggle a svg{ opacity:.9; }
      `}</style>
    </div>
  );
}
