"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, FormEvent, Suspense } from "react";
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

function VerifyOtpInner() {
  const router = useRouter();
  const params = useSearchParams();
  const {
    user,
    loading,
    maskedPhone,
    verifyOtp,
    verifyLoginOtp,
    requestOtp,
    login,
    refresh,
  } = useAuth();

  const isLoginMode = params.get("mode") === "login";
  // For login mode, the identifier comes from the query param (email used as key)
  const identifierFromQuery = (params.get("email") ?? "").trim();
  const devOtpFromQuery = params.get("devOtp");

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
  const [devOtp, setDevOtp] = useState<string | null>(devOtpFromQuery);

  // fromRegistration = arrived here from the register form (email/phone in URL, no auth cookie yet)
  const fromRegistration = !isLoginMode && !!identifierFromQuery;

  useEffect(() => {
    if (isLoginMode || loading) return;
    // New registrations have no user yet — let them stay and verify
    if (!user && !fromRegistration) router.replace("/login");
    else if (user?.phoneVerified) router.replace(dashboardPath(user.role));
  }, [isLoginMode, loading, user, router, fromRegistration]);

  // Auto-send OTP for registration flow when user has phone on file
  useEffect(() => {
    if (isLoginMode || loading || !user || user.phoneVerified || !user.emailVerified) return;
    if (!user.phone) return;
    requestOtp()
      .then((res) => {
        setSentTo(res.maskedPhone);
        setCooldown(RESEND_COOLDOWN_SECONDS);
        if (res.devOtp) setDevOtp(res.devOtp);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoginMode, loading]);

  async function onSavePhone(e: FormEvent) {
    e.preventDefault();
    setPhoneError(null);
    setSavingPhone(true);
    try {
      await apiPatch("/auth/me", { phone: phoneInput });
      await refresh();
      const res = await requestOtp();
      setSentTo(res.maskedPhone);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (res.devOtp) setDevOtp(res.devOtp);
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
      if (isLoginMode) {
        const res = await verifyLoginOtp(identifierFromQuery, code);
        const freshUser = await refresh();
        router.push(dashboardPath(freshUser?.role ?? res.user?.role ?? "customer"));
      } else {
        const res = await verifyOtp(code);
        const me = await refresh();
        const role = me?.role ?? res.user?.role ?? "customer";
        router.push(role === "customer" ? "/" : dashboardPath(role));
      }
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
      if (isLoginMode) {
        const res = await login(identifierFromQuery);
        if (res.devOtp) setDevOtp(res.devOtp);
        setSentTo(res.maskedPhone ?? null);
      } else {
        const res = await requestOtp();
        setSentTo(res.maskedPhone);
        if (res.devOtp) setDevOtp(res.devOtp);
      }
      setInfo("A new code has been sent.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code");
    }
  }

  // Registration flow only: user skipped phone at registration — ask them to add it now
  if (!isLoginMode && !loading && user && !user.phone && !user.phoneVerified) {
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

  const displayTarget = isLoginMode
    ? (identifierFromQuery || "your phone number")
    : (sentTo ?? "your phone number");

  return (
    <AuthShell
      title={isLoginMode ? "Check your phone" : "Verify your phone number"}
      subtitle={`Enter the 6-digit code we sent to ${displayTarget}.`}
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
        {devOtp && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 mb-0.5">Your OTP code</p>
            <p className="text-2xl font-mono font-bold tracking-[0.3em] text-amber-900">{devOtp}</p>
          </div>
        )}
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
          {isLoginMode ? "Sign in" : "Verify"}
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={null}>
      <VerifyOtpInner />
    </Suspense>
  );
}
