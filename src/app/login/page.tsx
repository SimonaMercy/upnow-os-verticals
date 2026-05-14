/**
 * Login page (/login)
 *
 * Email + password form. On success, AuthContext stores the session in an
 * httpOnly cookie via the /api proxy — no JWT ever touches client JS.
 *
 * If the user is pending email verification, redirects to /verify-email.
 * After successful login, redirects to the role-specific dashboard via
 * dashboardPath(user.role) from AuthContext.
 *
 * ?redirect= query param preserves the originally requested URL so the user
 * lands where they intended after logging in.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, FormEvent, Suspense } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth, dashboardPath, verificationPath } from "@/contexts/AuthContext";
import {
  AuthShell,
  FormField,
  Alert,
  PrimaryButton,
  inputClass,
} from "@/components/auth/AuthShell";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Show a success banner when redirected from /forgot-password after reset */
  const justReset = params.get("reset") === "1";
  /** Show a success banner when email was confirmed but session had expired */
  const emailVerified = params.get("emailVerified") === "1";
  const redirect = params.get("redirect");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password);
      router.push(
        res.requiresVerification
          ? `${verificationPath(res.verificationStep)}?email=${encodeURIComponent(email.trim().toLowerCase())}`
          : (redirect ?? dashboardPath(res.user?.role ?? "customer")),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="One sign-in for tenants, rental providers, and service providers."
      footer={
        <p className="text-sm text-center" style={{ color: "var(--neutral-700)" }}>
          New to UpNow?{" "}
          <Link
            href="/#signup"
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--primary)" }}
          >
            Choose your sign-up
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {justReset && (
          <Alert kind="success">
            Password updated successfully. Sign in with your new password.
          </Alert>
        )}
        {emailVerified && (
          <Alert kind="success">
            Your email has been verified. Sign in to continue.
          </Alert>
        )}

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

        <FormField label="Password">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
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

        <div className="flex justify-end -mt-1">
          <Link
            href="/forgot-password"
            className="text-sm font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--primary)" }}
          >
            Forgot password?
          </Link>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <PrimaryButton loading={submitting}>Sign in</PrimaryButton>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
