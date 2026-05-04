"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push("/v2");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to UpNow</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Welcome back — enter your credentials below.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />

          {error && (
            <div className="text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-400 text-white font-medium py-2.5 rounded-lg transition"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-sm text-neutral-600 mt-6 text-center">
          New to UpNow?{" "}
          <Link href="/register" className="text-neutral-900 font-medium underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-neutral-700 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        className="w-full border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900"
      />
    </label>
  );
}
