"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { apiGet, apiPost } from "@/lib/api";

// Mirrors backend `UserRole` enum (src/shared/enums.ts).
export type UserRole =
  | "customer"
  | "service_provider"
  | "rental_provider"
  | "technician"
  | "manager"
  | "admin"
  | "super_admin";

export type SelfRegisterRole = "customer" | "rental_provider" | "service_provider";

export interface AppUser {
  id: number;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: UserRole;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  kycStatus: string;
  gender?: string | null;
  nationality?: string | null;
  emiratesIdNumber?: string | null;
  profilePictureUrl?: string | null;
}

export interface RegisterPayload {
  /** Email address — required unless phone is provided. */
  email?: string;
  /** Phone number — required unless email is provided. */
  phone?: string;
  /** T-108 honeypot — must remain empty. Bots fill it; humans never see it. */
  website?: string;
}

export interface AuthResponse {
  /** Not present in client responses — the proxy stores it as an httpOnly cookie. */
  access_token?: string;
  user?: AppUser;
  requiresVerification: boolean;
  verificationStep?: "email" | "phone" | null;
  maskedPhone?: string;
  verified?: boolean;
  /** Returned only in non-production environments — shows the OTP on-screen. */
  devOtp?: string;
}

interface AuthContextValue {
  user: AppUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  /** True when the current account still needs to verify email. */
  requiresVerification: boolean;
  verificationStep: "email" | "phone" | null;
  maskedPhone: string | null;
  /** Step 1 of OTP login — send OTP to identifier (email or phone). */
  login: (identifier: string) => Promise<AuthResponse>;
  /** Step 2 of OTP login — verify the 6-digit code and receive a session. */
  verifyLoginOtp: (identifier: string, code: string) => Promise<AuthResponse>;
  register: (role: SelfRegisterRole, payload: RegisterPayload) => Promise<AuthResponse>;
  verifyOtp: (code: string) => Promise<AuthResponse>;
  requestOtp: () => Promise<{ sent: boolean; maskedPhone: string; devOtp?: string }>;
  refresh: () => Promise<AppUser | null>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  loading: true,
  requiresVerification: false,
  verificationStep: null,
  maskedPhone: null,
  login: async () => { throw new Error("AuthProvider missing"); },
  verifyLoginOtp: async () => { throw new Error("AuthProvider missing"); },
  register: async () => { throw new Error("AuthProvider missing"); },
  verifyOtp: async () => { throw new Error("AuthProvider missing"); },
  requestOtp: async () => ({ sent: true, maskedPhone: '', devOtp: undefined }),
  refresh: async () => null,
  signOut: () => {},
});

const ROLE_DASHBOARD: Record<UserRole, string> = {
  customer: "/",
  rental_provider: "/rental-provider/dashboard",
  service_provider: "/dashboard/service-provider",
  manager: "/dashboard/manager",
  technician: "/dashboard/technician",
  admin: "/dashboard/admin",
  super_admin: "/dashboard/admin",
};

export function dashboardPath(role: UserRole): string {
  return ROLE_DASHBOARD[role] ?? "/dashboard";
}

export function verificationPath(step: "email" | "phone" | null | undefined): string {
  return step === "phone" ? "/verify" : "/verify-email";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [verificationStep, setVerificationStep] = useState<"email" | "phone" | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyAuthResponse = useCallback((res: AuthResponse) => {
    // Token is managed server-side as an httpOnly cookie by the /api proxy.
    // Unverified flows may return no session; keep user null in that case.
    setUser(res.requiresVerification ? null : (res.user ?? null));
    setRequiresVerification(!!res.requiresVerification);
    setVerificationStep(res.verificationStep ?? null);
    setMaskedPhone(res.maskedPhone ?? null);
  }, []);

  const refresh = useCallback(async (): Promise<AppUser | null> => {
    if (typeof window === "undefined") return null;
    // No localStorage check — session lives in the httpOnly cookie.
    // A 401 from /me means no valid session; the catch handles it.
    try {
      const me = await apiGet<AppUser>("/auth/me");
      setUser(me);
      const needsEmail = !me.emailVerified;
      setRequiresVerification(me.status === "pending_verification" || needsEmail);
      setVerificationStep(needsEmail ? "email" : null);
      return me;
    } catch {
      setUser(null);
      setVerificationStep(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await refresh();
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [refresh]);

  const login = useCallback(async (identifier: string) => {
    const res = await apiPost<AuthResponse>("/auth/login", { email: identifier });
    applyAuthResponse(res);
    return res;
  }, [applyAuthResponse]);

  const verifyLoginOtp = useCallback(async (identifier: string, code: string) => {
    const res = await apiPost<AuthResponse>("/auth/login/verify-otp", { identifier, code });
    applyAuthResponse(res);
    return res;
  }, [applyAuthResponse]);

  const register = useCallback(
    async (role: SelfRegisterRole, payload: RegisterPayload) => {
      const path =
        role === "customer"
          ? "/auth/register/customer"
          : role === "rental_provider"
            ? "/auth/register/rental-provider"
            : "/auth/register/service-provider";
      const res = await apiPost<AuthResponse>(path, payload);
      applyAuthResponse(res);
      return res;
    },
    [applyAuthResponse],
  );

  const verifyOtp = useCallback(async (code: string) => {
    const res = await apiPost<AuthResponse>("/auth/otp/verify", { code });
    applyAuthResponse({ ...res, requiresVerification: false });
    return res;
  }, [applyAuthResponse]);

  const requestOtp = useCallback(async () => {
    return apiPost<{ sent: boolean; maskedPhone: string }>("/auth/otp/request", {});
  }, []);

  const signOut = useCallback(() => {
    // Fire-and-forget cookie-clear. `keepalive: true` lets the request survive
    // the hard navigation below so the server-side cookie always gets cleared.
    if (typeof window !== 'undefined') {
      try {
        fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          keepalive: true,
        }).catch(() => {});
      } catch { /* keepalive may throw on older browsers; ignore */ }
    }
    setUser(null);
    setRequiresVerification(false);
    setVerificationStep(null);
    setMaskedPhone(null);
    // Hard-navigate to landing. This tears down the React tree synchronously,
    // preventing dashboard gates (RpOnboardingGate) and auth effects
    // (DashboardShell) from racing to redirect to /onboarding or /login during
    // the brief window where `user === null` but the URL is still a dashboard
    // sub-path.
    if (typeof window !== 'undefined') {
      window.location.replace('/');
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        requiresVerification,
        verificationStep,
        maskedPhone,
        login,
        verifyLoginOtp,
        register,
        verifyOtp,
        requestOtp,
        refresh,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
