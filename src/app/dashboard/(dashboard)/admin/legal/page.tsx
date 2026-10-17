'use client';

/**
 * Admin › Legal › Jurisdiction settings (spec §7.4) — the PLATFORM DEFAULT every
 * landlord starts from. A landlord who saves their own set on Settings → Legal
 * overrides it for their cases (0286). Same form, different owner.
 *
 * Parity with previous page: JurisdictionSettingsForm REUSED unchanged with the same props
 * (scope="platform", load=legalApi.adminConfig, save=legalApi.adminUpdateConfig). Only the
 * DashboardPage wrapper was replaced by OsPage/PageHead.
 */
import { JurisdictionSettingsForm } from '@/components/legal/JurisdictionSettingsForm';
import { Callout, OsPage, PageHead, ScopeStrip } from '@/components/os/kit';
import { legalApi } from '@/lib/legal';

export default function AdminLegalSettingsPage() {
  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Legal"
        title="Jurisdiction settings"
        lede="The platform default for notice periods, appeal window, filing fee and filing rules."
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Legal' },
        { label: 'Owner', value: 'Platform default' },
      ]} />
      <div style={{ marginBottom: 14 }}>
        <Callout tone="info" title="Default, not override.">
          Each landlord can keep their own set under Settings → Legal; these values apply until they do.
        </Callout>
      </div>
      <JurisdictionSettingsForm scope="platform" load={() => legalApi.adminConfig()} save={(b) => legalApi.adminUpdateConfig(b)} />
    </OsPage>
  );
}
