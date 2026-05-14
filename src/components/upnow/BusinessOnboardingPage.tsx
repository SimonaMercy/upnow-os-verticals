"use client";

import Link from "next/link";
import { Check, FileBadge2, FolderOpen, ShieldCheck } from "lucide-react";
import { DashboardPage } from "@/components/dashboard/DashboardWidgets";

interface OnboardingStep {
  label: string;
  done: boolean;
  description: string;
}

interface BusinessOnboardingPageProps {
  roleLabel: string;
  title: string;
  subtitle: string;
  profileHref: string;
  documentsHref: string;
  steps: OnboardingStep[];
}

export function BusinessOnboardingPage({
  roleLabel,
  title,
  subtitle,
  profileHref,
  documentsHref,
  steps,
}: BusinessOnboardingPageProps) {
  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <DashboardPage title={title} subtitle={subtitle}>
      {/* Horizontal timeline — full width above the grid */}
      <div
        className="rounded-3xl border p-6 mb-6"
        style={{ backgroundColor: "#fff", borderColor: "var(--color-base-200)" }}
      >
        <div className="flex items-center gap-2 mb-6">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ backgroundColor: "var(--color-primary)", color: "#fff" }}
          >
            <ShieldCheck size={18} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-primary)" }}>
              {roleLabel} onboarding
            </p>
            <p className="text-sm font-semibold" style={{ color: "var(--color-text, #1a1916)" }}>
              KYC progress
            </p>
          </div>
        </div>

        {/* Timeline row */}
        <ol className="flex items-start">
          {steps.map((step, idx) => {
            const isLast = idx === steps.length - 1;
            const isActive = idx === activeIndex;
            const isDone = step.done;

            return (
              <li key={step.label} className="flex flex-1 flex-col items-center relative">
                {/* Connector line before this node (skip first) */}
                {idx > 0 && (
                  <div
                    className="absolute top-[17px] right-1/2 h-0.5 w-full -translate-y-1/2"
                    style={{
                      backgroundColor: steps[idx - 1].done
                        ? "var(--color-primary)"
                        : "var(--color-base-200, #e5e7eb)",
                    }}
                  />
                )}
                {/* Connector line after this node (skip last) */}
                {!isLast && (
                  <div
                    className="absolute top-[17px] left-1/2 h-0.5 w-full -translate-y-1/2"
                    style={{
                      backgroundColor: isDone
                        ? "var(--color-primary)"
                        : "var(--color-base-200, #e5e7eb)",
                    }}
                  />
                )}

                {/* Node */}
                <div
                  className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all"
                  style={
                    isDone
                      ? { backgroundColor: "var(--color-primary)", color: "#fff" }
                      : isActive
                        ? {
                            backgroundColor: "var(--color-primary)",
                            color: "#fff",
                            boxShadow: "0 0 0 4px rgba(46,159,130,0.18)",
                          }
                        : {
                            backgroundColor: "var(--color-base-200, #f3f4f6)",
                            color: "var(--color-neutral-400, #9ca3af)",
                            border: "2px solid var(--color-base-200, #e5e7eb)",
                          }
                  }
                >
                  {isDone ? <Check size={15} strokeWidth={2.5} /> : <span>{idx + 1}</span>}
                </div>

                {/* Label + badge */}
                <div className="mt-3 text-center px-1">
                  <p
                    className="text-sm font-semibold leading-snug"
                    style={{
                      color: isDone || isActive
                        ? "var(--color-text, #1a1916)"
                        : "var(--color-neutral-400, #9ca3af)",
                    }}
                  >
                    {step.label}
                  </p>
                  {(isDone || isActive) && (
                    <span
                      className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: isDone ? "rgba(46,159,130,0.12)" : "rgba(46,159,130,0.12)",
                        color: "var(--color-primary)",
                      }}
                    >
                      {isDone ? "Done" : "Current"}
                    </span>
                  )}
                  <p className="mt-1 text-xs leading-snug" style={{ color: "var(--color-neutral-500, #6b7280)" }}>
                    {step.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
          <Link
            href={profileHref}
            className="block rounded-3xl border p-6 transition-colors hover:bg-[rgba(46,159,130,0.05)]"
            style={{ backgroundColor: "#fff", borderColor: "var(--color-base-200)" }}
          >
            <div className="flex items-center gap-3 mb-3">
              <FileBadge2 size={20} style={{ color: "var(--color-primary)" }} />
              <h3 className="text-lg font-semibold" style={{ color: "var(--color-text, #1a1916)" }}>
                Complete profile
              </h3>
            </div>
            <p className="text-sm" style={{ color: "var(--color-neutral-600, #4b5563)" }}>
              Fill in business identity, address, banking, and entity details before uploading documents.
            </p>
          </Link>

          <Link
            href={documentsHref}
            className="block rounded-3xl border p-6 transition-colors hover:bg-[rgba(46,159,130,0.05)]"
            style={{ backgroundColor: "#fff", borderColor: "var(--color-base-200)" }}
          >
            <div className="flex items-center gap-3 mb-3">
              <FolderOpen size={20} style={{ color: "var(--color-primary)" }} />
              <h3 className="text-lg font-semibold" style={{ color: "var(--color-text, #1a1916)" }}>
                Upload KYC documents
              </h3>
            </div>
            <p className="text-sm" style={{ color: "var(--color-neutral-600, #4b5563)" }}>
              Upload the required identity, business, banking, and compliance documents so admin review can begin.
            </p>
          </Link>
        </div>
    </DashboardPage>
  );
}