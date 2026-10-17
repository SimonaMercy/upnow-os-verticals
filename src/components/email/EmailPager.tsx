'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

/** "51–100 of 3,412 ‹ ›" under a list of conversations. Hidden when one page holds them all. */
export function EmailPager({ page, pageSize, total, onPage, disabled = false }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void; disabled?: boolean;
}) {
  if (total <= pageSize) return null;
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = 'w-8 h-8 grid place-items-center rounded-lg border border-[#e4e9e5] text-[#4a4842] hover:border-[#047246] cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:border-[#e4e9e5]';
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-[#e4e9e5] bg-[#fbfaf8] text-xs text-[#5f6b63]">
      <span className="flex-1">{from.toLocaleString('en-GB')}–{to.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')}</span>
      <button type="button" aria-label="Newer" className={btn} disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={14} /></button>
      <span>Page {page} of {last.toLocaleString('en-GB')}</span>
      <button type="button" aria-label="Older" className={btn} disabled={disabled || page >= last} onClick={() => onPage(page + 1)}><ChevronRight size={14} /></button>
    </div>
  );
}
