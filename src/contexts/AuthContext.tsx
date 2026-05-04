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
  | "tenant"
  | "service_provider"
  | "rental_provider"
  | "technician"
  | "manager"
  | "admin"
  | "super_admin";

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
}

export interface RegisterPayload {
  email: string;
  name: string;
  password: string;
  role?: "tenant" | "service_provider" | "rental_provider";
  firstName?: string;
  lastName?: string;
  phone?: string;
}

interface AuthContextValue {
  user: AppUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<AppUser>;
  register: (payload: RegisterPayload) => Promise<AppUser>;
  refresh: () => Promise<AppUser | null>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  loading: true,
  login: async () => {
    throw new Error("AuthProvider missing");
  },
  register: async () => {
    throw new Error("AuthProvider missing");
  },
  refresh: async () => null,
  signOut: () => {},
});

interface AuthResponse {
  access_token: string;
  user: AppUser;
}

const TOKEN_KEY = "upnow_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<AppUser | null> => {
    if (typeof window === "undefined") return null;
    if (!localStorage.getItem(TOKEN_KEY)) {
      setUser(null);
      return null;
    }
    try {
      const me = await apiGet<AppUser>("/auth/me");
      setUser(me);
      return me;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiPost<AuthResponse>("/auth/login", { email, password });
    localStorage.setItem(TOKEN_KEY, res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const res = await apiPost<AuthResponse>("/auth/register", payload);
    localStorage.setItem(TOKEN_KEY, res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        register,
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
