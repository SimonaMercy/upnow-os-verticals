"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  useAuth,
  dashboardPath,
  verificationPath,
  type SelfRegisterRole,
} from "@/contexts/AuthContext";
import { AuthShell, FormField, Alert, PrimaryButton, inputClass } from "./AuthShell";

interface Props {
  role: SelfRegisterRole;
  title: string;
  subtitle?: string;
}

/**
 * Shared registration form for the three role-specific pages.
 * Per Jira SCRUM-1 (T-101): role is fixed by the URL — no role dropdown.
 */
export function RegisterForm({ role, title, subtitle }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { register, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [website, setWebsite] = useState(""); // T-108 honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await register(role, { email, phone: phone || undefined, password, website });
      const redirect = params.get('redirect');
      const me = res.requiresVerification ? null : await refresh();
      router.push(
        res.requiresVerification
          ? `${verificationPath(res.verificationStep)}?email=${encodeURIComponent(email.trim().toLowerCase())}`
          : (redirect ?? dashboardPath(me?.role ?? res.user?.role ?? 'customer')),
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
        {/* T-108 honeypot — visually hidden + a11y hidden, but still in the DOM. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px", height: 0, width: 0, overflow: "hidden" }}>
          <label>
            Website (leave blank)
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <FormField label="Email address">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            className={inputClass}
          />
        </FormField>

        <FormField label="Phone number" hint="Include country code, e.g. +971 50 123 4567">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+971501234567"
            autoComplete="tel"
            className={inputClass}
          />
        </FormField>

        <FormField label="Password" hint="Minimum 8 characters.">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a strong password"
              autoComplete="new-password"
              required
              minLength={8}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute top-1/2 -translate-y-1/2"
              style={{ insetInlineEnd: 12, color: "var(--neutral-500)" }}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </FormField>

        {error && <Alert kind="error">{error}</Alert>}

        <PrimaryButton type="button" onClick={handleSubmit} loading={submitting}>Create account</PrimaryButton>
      </form>
    </AuthShell>
  );
}
