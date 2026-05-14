"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { apiPost } from "@/lib/api";
import { useAuth, dashboardPath, type AppUser } from "@/contexts/AuthContext";
import { AuthShell, Alert, PrimaryButton } from "@/components/auth/AuthShell";

type Status = "idle" | "submitting" | "success" | "error";

function VerifyEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh, user } = useAuth();

  // Email comes from query param (recommended) or current auth user.
  const emailFromQuery = (params.get("email") ?? "").trim().toLowerCase();
  const resolvedEmail = emailFromQuery || user?.email || "";

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([null, null, null, null, null, null]);

  const code = digits.join("");

  function handleDigitChange(index: number, e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = val;
    setDigits(next);
    if (val && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(""));
      inputRefs.current[5]?.focus();
      e.preventDefault();
    }
  }

  async function handleSubmit() {
    if (code.length !== 6) return;
    if (!resolvedEmail) {
      setError("Email is missing. Please sign in again to continue verification.");
      return;
    }

    setError(null);
    setStatus("submitting");
    try {
      const res = await apiPost<{ user?: AppUser }>("/auth/email/verify-otp", {
        email: resolvedEmail,
        code,
      });
      setStatus("success");
      const refreshedUser = await refresh();
      const verifiedUser = refreshedUser ?? res?.user;
      if (verifiedUser) {
        if (verifiedUser.role === "rental_provider") {
          router.replace("/dashboard/rental-provider/onboarding");
        } else if (verifiedUser.role === "service_provider") {
          router.replace("/dashboard/service-provider/onboarding");
        } else {
          router.replace(dashboardPath(verifiedUser.role));
        }
        return;
      }

      router.replace("/login?emailVerified=1");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    }
  }

  async function handleResend() {
    if (resending || !resolvedEmail) return;

    setResending(true);
    setResendMsg(null);
    try {
      await apiPost("/auth/email/resend-otp", { email: resolvedEmail });
      setResendMsg("New code sent. Check your inbox.");
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch (err) {
      setResendMsg(err instanceof Error ? err.message : "Could not resend code.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Verify your email"
      subtitle={
        resolvedEmail
          ? `Enter the 6-digit code we sent to ${resolvedEmail}.`
          : "Enter the 6-digit code we sent to your email address."
      }
      footer={
        <p className="text-sm mt-3 text-center" style={{ color: "var(--neutral-700)" }}>
          <Link
            href="/login"
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--primary)" }}
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2 justify-center">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleDigitChange(i, e)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              autoFocus={i === 0}
              className="w-11 h-13 text-center text-xl font-semibold border rounded-lg focus:outline-none focus:ring-2"
              style={{
                borderColor: "var(--neutral-300)",
                background: "var(--neutral-50)",
                color: "var(--neutral-900)",
              }}
            />
          ))}
        </div>

        {error && <Alert kind="error">{error}</Alert>}
        {resendMsg && <Alert kind={resendMsg.includes("sent") ? "success" : "error"}>{resendMsg}</Alert>}

        <PrimaryButton onClick={handleSubmit} loading={status === "submitting"} disabled={code.length !== 6}>
          Verify email
        </PrimaryButton>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending || !resolvedEmail}
          className="text-sm text-center underline-offset-4 hover:underline disabled:opacity-50"
          style={{ color: "var(--primary)" }}
        >
          {resending ? "Sending..." : "Resend code"}
        </button>
      </div>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
