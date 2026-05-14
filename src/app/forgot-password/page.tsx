"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  AuthShell,
  FormField,
  Alert,
  PrimaryButton,
  inputClass,
} from "@/components/auth/AuthShell";

type Step = "email" | "code";

const RESEND_COOLDOWN = 60;

/**
 * T-104 · OTP-based password reset flow.
 *
 * Step 1 (email): POST /auth/forgot-password → masked phone shown
 * Step 2 (code + new password): POST /auth/reset-password → redirect to login
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const { forgotPassword, resetPassword } = useAuth();

  const [step, setStep] = useState<Step>("email");

  // Step 1 state
  const [email, setEmail] = useState("");
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Step 2 state
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // ── Step 1: request OTP ────────────────────────────────────────────────
  async function onRequestCode(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setSendingEmail(true);
    try {
      const res = await forgotPassword(email);
      setMaskedPhone(res.maskedPhone ?? null);
      setStep("code");
      startCooldown();
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setSendingEmail(false);
    }
  }

  // ── Resend OTP (re-calls Step 1 silently) ─────────────────────────────
  async function onResend() {
    if (cooldown > 0) return;
    try {
      const res = await forgotPassword(email);
      setMaskedPhone(res.maskedPhone ?? null);
      startCooldown();
    } catch {
      // Silently ignore — user can try again
    }
  }

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN);
    const t = setInterval(
      () =>
        setCooldown((s) => {
          if (s <= 1) {
            clearInterval(t);
            return 0;
          }
          return s - 1;
        }),
      1000,
    );
  }

  // ── Step 2: reset password ─────────────────────────────────────────────
  async function onResetPassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }
    setResetError(null);
    setResetting(true);
    try {
      await resetPassword(email, code, newPassword);
      router.push("/login?reset=1");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Reset failed. Check your code and try again.");
    } finally {
      setResetting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (step === "email") {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="Enter your email and we'll send a code to your phone."
        footer={
          <p className="text-sm text-center" style={{ color: "var(--neutral-700)" }}>
            Remember it?{" "}
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
        <form onSubmit={onRequestCode} className="flex flex-col gap-4" noValidate>
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

          {emailError && <Alert kind="error">{emailError}</Alert>}

          <PrimaryButton loading={sendingEmail}>Send reset code</PrimaryButton>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Enter your code"
      subtitle={`We sent a 6-digit code to ${maskedPhone ?? "your phone"}. Enter it below along with your new password.`}
      footer={
        <button
          type="button"
          onClick={onResend}
          disabled={cooldown > 0}
          className="w-full text-sm font-medium underline-offset-4 hover:underline disabled:no-underline"
          style={{ color: cooldown > 0 ? "var(--neutral-400)" : "var(--primary)" }}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      }
    >
      <form onSubmit={onResetPassword} className="flex flex-col gap-4" noValidate>
        <FormField label="Verification code">
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoComplete="one-time-code"
            required
            placeholder="••••••"
            className={`${inputClass} text-center text-2xl font-mono tracking-[0.5em]`}
          />
        </FormField>

        <FormField label="New password" hint="Minimum 8 characters.">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Create a new password"
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

        <FormField label="Confirm new password">
          <input
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your new password"
            autoComplete="new-password"
            required
            minLength={8}
            className={inputClass}
          />
        </FormField>

        {resetError && <Alert kind="error">{resetError}</Alert>}

        <PrimaryButton loading={resetting} disabled={code.length !== 6 || newPassword.length < 8}>
          Set new password
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}
