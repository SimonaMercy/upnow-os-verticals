"use client";

import { BusinessOnboardingPage } from "@/components/upnow/BusinessOnboardingPage";

export default function ServiceProviderProfilePage() {
  return (
    <BusinessOnboardingPage
      roleLabel="Service Provider"
      title="Complete your service provider profile"
      subtitle="After email-first verification, complete your business details before you upload compliance documents."
      profileHref="/dashboard/service-provider/profile"
      documentsHref="/dashboard/service-provider/documents"
      steps={[
        {
          label: "Business profile",
          done: false,
          description: "Confirm company, service category, coverage area, and operational details.",
        },
        {
          label: "KYC upload",
          done: false,
          description: "Upload trade license, Emirates ID, VAT and supporting compliance documents.",
        },
        {
          label: "Compliance review",
          done: false,
          description: "Admin validates your files before your account is fully compliant.",
        },
      ]}
    />
  );
}