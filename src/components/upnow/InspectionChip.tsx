'use client';

import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { INSPECTION_TONE, inspectionHref, type InspectionStatus } from '@/lib/inspectionStatus';

/** The inspection chip on top of a property card — "Inspection · Due 31 Oct". Opens the visit. */
export function InspectionChip({ status, rp, settingsHref }: { status: (InspectionStatus & { rp?: number | null }) | null | undefined; rp?: number | null; settingsHref?: string }) {
  if (!status) return null;
  const t = INSPECTION_TONE[status.tone];
  const href = status.visit ? inspectionHref(status.visit.id, rp ?? status.rp ?? null) : settingsHref;
  const body = (
    <span title={status.detail || undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: t.fg, background: t.bg, padding: '3px 8px', borderRadius: 6, flex: '0 0 auto', whiteSpace: 'nowrap' }}>
      <ClipboardCheck size={11} style={{ color: t.dot }} />
      Inspection · {status.label}
    </span>
  );
  return href ? <Link href={href} onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none', flex: '0 0 auto' }}>{body}</Link> : body;
}
