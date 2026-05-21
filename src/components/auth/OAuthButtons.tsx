"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { useAuth, dashboardPath, type AuthResponse } from "@/contexts/AuthContext";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient: (cfg: Record<string, unknown>) => { requestCode: () => void };
        };
      };
    };
    AppleID?: {
      auth: {
        init: (cfg: Record<string, unknown>) => void;
        signIn: () => Promise<{
          authorization: { id_token: string };
          user?: { name?: { firstName?: string; lastName?: string } };
        }>;
      };
    };
  }
}

interface Props {
  redirect?: string | null;
}

export function OAuthButtons({ redirect }: Props) {
  const router = useRouter();
  const { refresh } = useAuth();

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const appleClientId  = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID;

  const googleCodeClient = useRef<{ requestCode: () => void } | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading,  setAppleLoading]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Shared post-OAuth redirect ─────────────────────────────────────────────
  async function handleResponse(res: AuthResponse) {
    const me = await refresh();
    router.push(redirect ?? dashboardPath(me?.role ?? res.user?.role ?? "customer"));
  }

  // ── Load GIS script + initialise code client ──────────────────────────────
  useEffect(() => {
    if (!googleClientId) return;

    function init() {
      if (!window.google) return;
      googleCodeClient.current = window.google.accounts.oauth2.initCodeClient({
        client_id: googleClientId,
        scope: "openid email profile",
        ux_mode: "popup",
        callback: async (r: { code: string; error?: string }) => {
          if (r.error) { setError("Google sign-in was cancelled."); return; }
          setGoogleLoading(true);
          setError(null);
          try {
            const res = await apiPost<AuthResponse>("/auth/google", { code: r.code });
            await handleResponse(res);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Google sign-in failed");
          } finally {
            setGoogleLoading(false);
          }
        },
      });
    }

    if (window.google?.accounts) { init(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = init;
    document.head.appendChild(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId]);

  // ── Load Apple JS SDK ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!appleClientId) return;

    function init() {
      window.AppleID?.auth.init({
        clientId: appleClientId,
        scope: "name email",
        redirectURI: window.location.origin + "/login",
        usePopup: true,
      });
    }

    if (window.AppleID) { init(); return; }
    const s = document.createElement("script");
    s.src = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
  }, [appleClientId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleGoogleClick() {
    if (!googleClientId) {
      setError("Google Sign-In is not configured yet (NEXT_PUBLIC_GOOGLE_CLIENT_ID missing).");
      return;
    }
    if (!googleCodeClient.current) {
      setError("Google Sign-In is still loading — please try again.");
      return;
    }
    setError(null);
    googleCodeClient.current.requestCode();
  }

  async function handleAppleClick() {
    if (!appleClientId) {
      setError("Apple Sign-In is not configured yet (NEXT_PUBLIC_APPLE_CLIENT_ID missing).");
      return;
    }
    if (!window.AppleID) {
      setError("Apple Sign-In is still loading — please try again.");
      return;
    }
    setAppleLoading(true);
    setError(null);
    try {
      const result = await window.AppleID.auth.signIn();
      const res = await apiPost<AuthResponse>("/auth/apple", {
        idToken: result.authorization.id_token,
        firstName: result.user?.name?.firstName,
        lastName:  result.user?.name?.lastName,
      });
      await handleResponse(res);
    } catch (err) {
      if (err && typeof err === "object" && "error" in err &&
          (err as { error: string }).error === "popup_closed_by_user") return;
      setError(err instanceof Error ? err.message : "Apple sign-in failed");
    } finally {
      setAppleLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ backgroundColor: "var(--base-200)" }} />
        <span className="text-xs font-medium" style={{ color: "var(--neutral-400)" }}>
          or continue with
        </span>
        <div className="flex-1 h-px" style={{ backgroundColor: "var(--base-200)" }} />
      </div>

      <div className="flex gap-3">
        {/* Google */}
        <button
          type="button"
          onClick={handleGoogleClick}
          disabled={googleLoading}
          aria-label="Continue with Google"
          className="flex-1 flex items-center justify-center rounded-full border py-3 transition-colors hover:bg-gray-50 disabled:opacity-50"
          style={{ borderColor: "var(--base-200)" }}
        >
          {googleLoading
            ? <span className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            : <GoogleIcon />}
        </button>

        {/* Apple */}
        <button
          type="button"
          onClick={handleAppleClick}
          disabled={appleLoading}
          aria-label="Continue with Apple"
          className="flex-1 flex items-center justify-center rounded-full py-3 transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: "#000", color: "#fff" }}
        >
          {appleLoading
            ? <span className="w-5 h-5 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
            : <AppleIcon />}
        </button>
      </div>

      {error && (
        <p className="text-xs text-center" style={{ color: "var(--error)" }}>{error}</p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19.1 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.2 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.3C9.7 35.5 16.3 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39 44 34 44 24c0-1.3-.1-2.7-.4-3.9z"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.6-157.2-110.6c-44.5-61.2-82.1-160.3-82.1-254.8 0-169.3 110.6-258.9 219.4-258.9 58 0 106.5 38.4 143.8 38.4 35.2 0 90.3-40.8 155.4-40.8 24.2 0 108.2 2.6 164.6 88.9zm-230.5-82.1c-29.1 34.3-75.8 60.8-120.2 57.7-1.5-4.5-2.3-9.3-2.3-14.3 0-42.1 17.4-86.7 47.7-122.3 15.3-17.5 36.6-32.1 61.5-42.3 24.8-10 48.3-15.6 69.8-15.6 1.1 3.8 1.6 7.7 1.6 11.6 0 39.5-16.2 82.8-58.1 125.2z" />
    </svg>
  );
}
