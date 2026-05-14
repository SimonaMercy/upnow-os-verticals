"use client";

import { DashboardPage } from "@/components/dashboard/DashboardWidgets";
import { KycDocumentsPanel } from "@/components/dashboard/KycDocumentsPanel";

export default function RentalProviderDocumentsPage() {
  return (
    <DashboardPage
      title="KYC documents"
      subtitle="Upload the required documents so admin review can begin."
    >
      <KycDocumentsPanel
        profileApiPath="/profiles/rental-provider/me"
        ownerType="rental_provider"
        profileHref="/dashboard/rental-provider/profile"
      />
    </DashboardPage>
  );
}
