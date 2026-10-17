'use client';

/**
 * Genspark OS frame for every RP report sub-route (Insights › <report>).
 *
 * Wraps a shared report view — ReportDetailView, MissingDataView, DataGapsView,
 * ActivityLogView, … — WITHOUT touching it: those components are shared with the
 * manager portal (ReportDetailView alone serves ~20 reports), so their behaviour,
 * endpoints, back links, CSV and print stay exactly as they were. Only the kit
 * page head is added above them. The head is hidden in print so the view's own
 * print header stays the first thing on the PDF.
 *
 * The wrapped view is rendered as a SIBLING of the kit's `.gx` scope, not inside
 * it: gx.css is unlayered and resets `button`/`a`/`p`/`h1` colour + margins under
 * `.gx`, which would override the Tailwind utilities the shared views rely on
 * (white-on-green buttons, link colours). Outside the scope they render exactly
 * as they did before.
 */
import type { ReactNode } from 'react';
import { OsPage, PageHead, Btn } from '@/components/os/kit';
import { REPORT_TILES } from '@/components/upnow/reportCatalog';
import { MISSING_REPORTS } from '@/components/upnow/MissingDataView';

export const REPORTS_HOME = '/rental-provider/dashboard/reports';

/** Display name for a report slug — catalog tile, missing-data config, else humanised slug. */
export function reportName(slug: string): string {
  const tile = REPORT_TILES.find((t) => t.slug === slug);
  if (tile) return tile.title;
  const missing = MISSING_REPORTS[slug];
  if (missing) return missing.title;
  if (slug === 'data-gaps') return 'Data Gaps & Exceptions';
  return slug.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function ReportShell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <OsPage className="pb-0! print:hidden">
        <PageHead
          eyebrow={`Insights › ${name}`}
          title={name}
          actions={<Btn href={REPORTS_HOME}>All reports</Btn>}
        />
      </OsPage>
      {children}
    </>
  );
}
