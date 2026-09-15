'use client';

/**
 * Admin · Jurisdiction settings (spec §7.4) — the PLATFORM DEFAULT every
 * landlord starts from. A landlord who saves their own set on Settings → Legal
 * overrides it for their cases (0286). Same form, different owner.
 */
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { JurisdictionSettingsForm } from '@/components/legal/JurisdictionSettingsForm';
import { legalApi } from '@/lib/legal';

export default function AdminLegalSettingsPage() {
  return (
    <DashboardPage title="Jurisdiction settings" subtitle="The platform default for notice periods, appeal window, filing fee and filing rules. Each landlord can keep their own set under Settings → Legal; these values apply until they do.">
      <JurisdictionSettingsForm scope="platform" load={() => legalApi.adminConfig()} save={(b) => legalApi.adminUpdateConfig(b)} />
    </DashboardPage>
  );
}
