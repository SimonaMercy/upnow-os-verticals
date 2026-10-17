'use client';

/**
 * RP → Building inspections — the visits worklist (0383).
 *
 * Parity with previous page: renders <BuildingInspectionsIndex> unchanged with
 * the same (no) props; adds OsPage + PageHead only.
 * Duplicate title: the component renders its own "Building inspections" h1 and
 * has no prop to hide it, so PageHead is kept minimal (eyebrow + title).
 */
import { BuildingInspectionsIndex } from '@/components/upnow/BuildingInspectionsIndex';
import { OsPage, PageHead } from '@/components/os/kit';

export default function BuildingInspectionsPage() {
  return (
    <OsPage>
      <PageHead eyebrow="Operations" title="Building inspections" />
      <BuildingInspectionsIndex />
    </OsPage>
  );
}
