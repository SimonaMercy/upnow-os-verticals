"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, FormEvent } from "react";
import {
  useAuth,
  dashboardPath,
  verificationPath,
  type SelfRegisterRole,
} from "@/contexts/AuthContext";
import { AuthShell, FormField, Alert, PrimaryButton, inputClass } from "./AuthShell";
import { OAuthButtons } from "./OAuthButtons";

interface Props {
  role: SelfRegisterRole;
  title: string;
  subtitle?: string;
}

function isEmailInput(value: string) {
  return value.includes("@");
}

export function RegisterForm({ role, title, subtitle }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { register, refresh } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [website, setWebsite] = useState(""); // T-108 honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOnly = role !== "customer";
  const isEmail = emailOnly || isEmailInput(identifier.trim());

  async function handleSubmit() {
    const trimmed = identifier.trim();
    if (!trimmed) { setError("Enter your email address"); return; }
    if (emailOnly && !trimmed.includes("@")) { setError("Enter a valid email address"); return; }

    setError(null);
    setSubmitting(true);
    try {
      const payload = isEmail
        ? { email: trimmed.toLowerCase(), website }
        : { phone: trimmed.startsWith("+") ? trimmed : `+${trimmed}`, website };

      const res = await register(role, payload);
      const redirect = params.get("redirect");
      const identifierForUrl = isEmail ? trimmed.toLowerCase() : (payload.phone!);

      const me = res.requiresVerification ? null : await refresh();
      router.push(
        res.requiresVerification
          ? `${verificationPath(res.verificationStep)}?email=${encodeURIComponent(identifierForUrl)}${res.devOtp ? `&devOtp=${res.devOtp}` : ""}`
          : (redirect ?? dashboardPath(me?.role ?? res.user?.role ?? "customer")),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    handleSubmit();
  }

  return (
    <AuthShell
      title={title}
      subtitle={subtitle}
      footer={
        <p className="text-sm text-center" style={{ color: "var(--neutral-700)" }}>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--primary)" }}
          >
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onFormSubmit} className="flex flex-col gap-4" noValidate>
        {/* T-108 honeypot */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px", height: 0, width: 0, overflow: "hidden" }}>
          <label>
            Website (leave blank)
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        <FormField
          label={emailOnly ? "Email address" : "Email or phone number"}
          hint={emailOnly ? "We'll send a verification code to this email." : isEmail && identifier.trim() ? "We'll send a verification code to this email." : identifier.trim() ? "We'll send a verification code to this number." : undefined}
        >
          <input
            type={emailOnly ? "email" : "text"}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={emailOnly ? "you@example.com" : "you@example.com or +971501234567"}
            autoComplete={emailOnly ? "email" : "username"}
            required
            className={inputClass}
          />
        </FormField>

        {error && <Alert kind="error">{error}</Alert>}

        <PrimaryButton type="button" onClick={handleSubmit} loading={submitting}>
          Create account
        </PrimaryButton>
      </form>

      {role === "customer" && (
        <div className="mt-4">
          <OAuthButtons redirect={params.get("redirect")} />
        </div>
      )}
    </AuthShell>
  );
}
