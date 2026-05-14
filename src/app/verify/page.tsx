"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, FormEvent } from "react";
import { useAuth, dashboardPath } from "@/contexts/AuthContext";
import { apiPatch } from "@/lib/api";
import {
  AuthShell,
  FormField,
  Alert,
  PrimaryButton,
  inputClass,
} from "@/components/auth/AuthShell";

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyOtpPage() {
  const router = useRouter();
  const {
    user,
    loading,
    maskedPhone,
    verifyOtp,
    requestOtp,
    refresh,
  } = useAuth();

  // "add phone" step — shown when the user skipped phone at registration
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [sentTo, setSentTo] = useState<string | null>(maskedPhone);

  // Guard logic:
  // - Not logged in → /login
  // - Phone already verified → back to dashboard (nothing left to do)
  // - Email not yet verified → /verify-email first
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.phoneVerified) router.replace(dashboardPath(user.role));
    else if (!user.emailVerified) router.replace("/verify-email");
  }, [loading, user, router]);

  // Auto-send OTP only when the user already has a phone number on file.
  // Users who skipped phone at registration see the "add phone" step first.
  useEffect(() => {
    if (loading || !user || user.phoneVerified || !user.emailVerified) return;
    if (!user.phone) return; // wait until they add a phone
    requestOtp()
      .then((res) => {
        setSentTo(res.maskedPhone);
        setCooldown(RESEND_COOLDOWN_SECONDS);
      })
      .catch(() => {
        // If auto-send fails (e.g. rate limited), let user press Resend manually
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function onSavePhone(e: FormEvent) {
    e.preventDefault();
    setPhoneError(null);
    setSavingPhone(true);
    try {
      await apiPatch("/auth/me", { phone: phoneInput });
      await refresh();
      // After refresh, user.phone will be set — trigger OTP send
      const res = await requestOtp();
      setSentTo(res.maskedPhone);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Could not save phone number");
    } finally {
      setSavingPhone(false);
    }
  }

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const res = await verifyOtp(code);
      await refresh();
      router.push(dashboardPath(res.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (cooldown > 0) return;
    setError(null);
    setInfo(null);
    try {
      const res = await requestOtp();
      setSentTo(res.maskedPhone);
      setInfo("A new code has been sent.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code");
    }
  }

  // Step 1: user skipped phone at registration — ask them to add it now
  if (!loading && user && !user.phone && !user.phoneVerified) {
    return (
      <AuthShell
        title="Add your phone number"
        subtitle="We need a phone number to send you a verification code."
      >
        <form onSubmit={onSavePhone} className="flex flex-col gap-4" noValidate>
          <FormField label="Phone number" hint="Include country code, e.g. +971 50 123 4567">
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="+971501234567"
              autoComplete="tel"
              required
              className={inputClass}
            />
          </FormField>

          {phoneError && <Alert kind="error">{phoneError}</Alert>}

          <PrimaryButton loading={savingPhone} disabled={!phoneInput.trim()}>
            Continue
          </PrimaryButton>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Verify your phone number"
      subtitle={`Enter the 6-digit code we sent to ${sentTo ?? "your phone number"}.`}
      footer={
        <button
          type="button"
          onClick={onResend}
          disabled={cooldown > 0}
          className="w-full text-sm font-medium underline-offset-4 hover:underline disabled:no-underline"
          style={{
            color: cooldown > 0 ? "var(--neutral-400)" : "var(--primary)",
          }}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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

        {error && <Alert kind="error">{error}</Alert>}
        {info && <Alert kind="success">{info}</Alert>}

        <PrimaryButton loading={submitting} disabled={code.length !== 6}>
          Verify
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}
