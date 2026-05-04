"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, FormEvent } from "react";
import { useAuth, RegisterPayload } from "@/contexts/AuthContext";

const ROLES: { value: NonNullable<RegisterPayload["role"]>; label: string }[] = [
  { value: "tenant", label: "Tenant — looking for a place / services" },
  { value: "rental_provider", label: "Rental Provider — list a property" },
  { value: "service_provider", label: "Service Provider — offer home services" },
];

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RegisterPayload["role"]>("tenant");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ name, email, phone: phone || undefined, password, role });
      router.push("/v2");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Create your UpNow account</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Join the UAE&apos;s rentals + services marketplace.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field label="Full name" value={name} onChange={setName} autoComplete="name" required />
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <Field label="Phone (optional)" type="tel" value={phone} onChange={setPhone} autoComplete="tel" placeholder="+971 50 123 4567" />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
            hint="Minimum 8 characters."
          />

          <label className="block">
            <span className="block text-sm font-medium text-neutral-700 mb-1">I am a…</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RegisterPayload["role"])}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900 bg-white"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <div className="text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-400 text-white font-medium py-2.5 rounded-lg transition"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-sm text-neutral-600 mt-6 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-neutral-900 font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  required,
  placeholder,
  hint,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
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
        placeholder={placeholder}
        className="w-full border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900"
      />
      {hint && <span className="block text-xs text-neutral-500 mt-1">{hint}</span>}
    </label>
  );
}
