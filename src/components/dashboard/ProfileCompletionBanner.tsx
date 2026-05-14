"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { AlertCircle, ChevronRight, CheckCircle, Mail } from "lucide-react";
import { useAuth, type AppUser } from "@/contexts/AuthContext";
import { apiGet, apiPost } from "@/lib/api";

interface Step {
  label: string;
  done: boolean;
  href: string;
}

interface RpSpProfile {
  accountTypeConfirmedAt: string | null;
  // RP-specific
  gender: string | null;
  nationality: string | null;
  // SP-specific
  businessName?: string | null;
  serviceCategories?: string[];
  emiratesServed?: string[];
}

function getSteps(user: AppUser, rpProfile: RpSpProfile | null): Step[] {
  const onboardingHref =
    user.role === "rental_provider"
      ? "/dashboard/rental-provider/onboarding"
      : user.role === "service_provider"
        ? "/dashboard/service-provider/onboarding"
        : "/verify";

  const base: Step[] = [
    {
      label: "Verify your email address",
      done: user.emailVerified,
      href: "/verify-email",
    },
    {
      label: "Verify your phone number",
      done: user.phoneVerified,
      href: onboardingHref,
    },
  ];

  if (user.role === "rental_provider") {
    const emailLocalPart = user.email?.split("@")[0] ?? "";
    const nameIsSet =
      !!(user.name && user.name.trim().length > 2 && user.name !== emailLocalPart);

    base.push({
      label: "Add your full name",
      done: nameIsSet,
      href: onboardingHref,
    });
    base.push({
      label: "Set your account type",
      done: !!rpProfile?.accountTypeConfirmedAt,
      href: onboardingHref,
    });
    base.push({
      label: "Complete your profile details",
      done: !!(rpProfile?.gender && rpProfile?.nationality),
      href: onboardingHref,
    });
    base.push({
      label: "Upload KYC documents",
      done: user.kycStatus !== "unverified",
      href: onboardingHref,
    });
  }

  if (user.role === "service_provider") {
    base.push({
      label: "Business basics",
      done: !!(rpProfile?.accountTypeConfirmedAt && rpProfile?.businessName),
      href: onboardingHref,
    });
    base.push({
      label: "Select service categories",
      done: !!(rpProfile?.serviceCategories && rpProfile.serviceCategories.length > 0),
      href: onboardingHref,
    });
    base.push({
      label: "Set your service area",
      done: !!(rpProfile?.emiratesServed && rpProfile.emiratesServed.length > 0),
      href: onboardingHref,
    });
    base.push({
      label: "Upload KYC documents",
      done: user.kycStatus !== "unverified",
      href: onboardingHref,
    });
  }

  if (user.role === "customer") {
    base.push({
      label: "Complete your profile",
      done: !!(user.firstName && user.lastName),
      href: "/dashboard/customer/profile",
    });
  }

  return base;
}

export function ProfileCompletionBanner() {
  const { user, refresh } = useAuth();
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [rpProfile, setRpProfile] = useState<RpSpProfile | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the RP/SP profile to get accountTypeConfirmedAt (not in the JWT)
  useEffect(() => {
    if (!user) return;
    if (user.role === "rental_provider") {
      apiGet<{ profile: RpSpProfile }>("/profiles/rental-provider/me")
        .then(({ profile }) => setRpProfile(profile))
        .catch(() => { /* non-fatal — steps default to not done */ });
    } else if (user.role === "service_provider") {
      apiGet<{ profile: RpSpProfile }>("/profiles/service-provider/me")
        .then(({ profile }) => setRpProfile(profile))
        .catch(() => { /* non-fatal */ });
    }
  }, [user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  const steps = getSteps(user, rpProfile);
  const incomplete = steps.filter((s) => !s.done);
  const completedCount = steps.length - incomplete.length;
  const pct = Math.round((completedCount / steps.length) * 100);

  // All done — hide
  if (incomplete.length === 0) return null;

  const nextStep = incomplete[0];

  async function handleResendEmail() {
    if (resendStatus === "sending" || resendStatus === "sent") return;
    setResendStatus("sending");
    try {
      await apiPost("/auth/email/resend");
      setResendStatus("sent");
    } catch {
      setResendStatus("error");
      setTimeout(() => setResendStatus("idle"), 4000);
    }
  }

  return (
    <div
      className="rounded-2xl border p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4"
      style={{
        backgroundColor: "var(--color-teal-50, #f0faf7)",
        borderColor: "var(--color-teal-200, #c3e8df)",
      }}
    >
      {/* Icon */}
      <div
        className="shrink-0 flex items-center justify-center rounded-full w-10 h-10"
        style={{ backgroundColor: "var(--color-primary, #2e9f82)", color: "#fff" }}
      >
        <AlertCircle size={20} />
      </div>

      {/* Text + progress */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm" style={{ color: "var(--color-text, #1a1916)" }}>
          Complete your profile ({pct}%)
        </p>
        <p className="text-sm mt-0.5" style={{ color: "var(--neutral-600, #4b5563)" }}>
          {nextStep.label}
        </p>

        {/* Mini progress bar */}
        <div
          className="mt-2 h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: "var(--color-teal-200, #c3e8df)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              backgroundColor: "var(--color-primary, #2e9f82)",
            }}
          />
        </div>

        {/* All steps (collapsed list) */}
        <ul className="mt-3 flex flex-col gap-1">
          {steps.map((step) => (
            <li key={step.label} className="flex items-center gap-2 text-xs">
              {step.done ? (
                <CheckCircle
                  size={14}
                  style={{ color: "var(--color-primary, #2e9f82)", flexShrink: 0 }}
                />
              ) : (
                <span
                  className="w-3.5 h-3.5 rounded-full border-2 inline-block shrink-0"
                  style={{ borderColor: "var(--neutral-400, #9ca3af)" }}
                />
              )}
              <span style={{ color: step.done ? "var(--neutral-500, #6b7280)" : "var(--color-text, #1a1916)" }}>
                {step.label}
              </span>
              {/* Resend button — only for the unverified email step */}
              {step.label === "Verify your email address" && !step.done && (
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={resendStatus === "sending" || resendStatus === "sent"}
                  className="ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60"
                  style={{
                    backgroundColor:
                      resendStatus === "sent"
                        ? "var(--color-teal-200, #c3e8df)"
                        : "transparent",
                    border: "1px solid var(--color-primary, #2e9f82)",
                    color:
                      resendStatus === "error"
                        ? "var(--error, #dc2626)"
                        : "var(--color-primary, #2e9f82)",
                  }}
                >
                  <Mail size={10} />
                  {resendStatus === "sending"
                    ? "Sending…"
                    : resendStatus === "sent"
                      ? "Email sent ✓"
                      : resendStatus === "error"
                        ? "Failed — retry"
                        : "Resend email"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* CTA */}
      <Link
        href={nextStep.href}
        className="shrink-0 flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold text-white"
        style={{ backgroundColor: "var(--color-primary, #2e9f82)" }}
      >
        Continue
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}
