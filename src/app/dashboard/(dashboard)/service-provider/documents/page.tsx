"use client";

import { DashboardPage } from "@/components/dashboard/DashboardWidgets";
import { KycDocumentsPanel } from "@/components/dashboard/KycDocumentsPanel";

export default function ServiceProviderDocumentsPage() {
  return (
    <DashboardPage
      title="KYC documents"
      subtitle="Upload the required documents so admin review can begin."
    >
      <KycDocumentsPanel
        profileApiPath="/profiles/service-provider/me"
        ownerType="service_provider"
        profileHref="/dashboard/service-provider/profile"
      />
    </DashboardPage>
  );
}
