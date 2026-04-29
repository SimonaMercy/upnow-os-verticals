"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { apiPost } from "@/lib/api";

export type UserRole =
  | "customer"
  | "service-provider"
  | "space-provider"
  | "technician"
  | "manager"
  | "admin";

export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

interface AuthContextValue {
  user: AppUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  loading: true,
  login: async () => {},
  signOut: () => {},
});

interface LoginResponse {
  access_token: string;
  user: AppUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-hydrate from stored token on mount
  useEffect(() => {
    const token = localStorage.getItem("upnow_token");
    const stored = localStorage.getItem("upnow_user");
    if (token && stored) {
      try {
        setUser(JSON.parse(stored) as AppUser);
      } catch {
        localStorage.removeItem("upnow_token");
        localStorage.removeItem("upnow_user");
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiPost<LoginResponse>("/auth/login", { email, password });
    localStorage.setItem("upnow_token", res.access_token);
    localStorage.setItem("upnow_user", JSON.stringify(res.user));
    setUser(res.user);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem("upnow_token");
    localStorage.removeItem("upnow_user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, loading, login, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
