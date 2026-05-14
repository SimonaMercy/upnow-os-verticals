/**
 * Admin — KYC Review Queue (dashboard/admin/kyc)
 *
 * Lists all users with kycStatus='pending_review' sorted by submission date.
 * Admin can click through to the per-user detail page to approve/reject docs.
 *
 * Data: GET /admin/kyc/pending — returns users awaiting document review.
 * Actions forward to /dashboard/admin/kyc/rental-provider/:id (or tenant/:id).
 */
"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import Link from "next/link";
import {
  Building2,
  Wrench,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ComplianceStatus =
  | "COMPLIANT"
  | "PENDING_REVIEW"
  | "ACTION_REQUIRED"
  | "EXPIRED"
  | "PAUSED";

interface ProviderUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

interface RentalProvider {
  id: number;
  userId: number;
  user?: ProviderUser;
  entityType?: string;
  companyName?: string;
  complianceStatus: ComplianceStatus;
  complianceNotes?: string;
  tradeLicenseNumber?: string;
  emiratesIdNumber?: string;
  bankIban?: string;
  contactAddress?: string;
  createdAt: string;
}

interface ServiceProvider {
  id: number;
  userId: number;
  user?: ProviderUser;
  entityType?: string;
  businessName?: string;
  ownerName?: string;
  serviceCategory?: string;
  complianceStatus: ComplianceStatus;
  complianceNotes?: string;
  averageRating?: number;
  totalReviews?: number;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function complianceColor(s: ComplianceStatus) {
  switch (s) {
    case "COMPLIANT":
      return "bg-emerald-100 text-emerald-800";
    case "PENDING_REVIEW":
      return "bg-amber-100 text-amber-800";
    case "ACTION_REQUIRED":
      return "bg-red-100 text-red-800";
    case "EXPIRED":
      return "bg-gray-100 text-gray-700";
    case "PAUSED":
      return "bg-orange-100 text-orange-800";
  }
}

function complianceIcon(s: ComplianceStatus) {
  switch (s) {
    case "COMPLIANT":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "PENDING_REVIEW":
      return <Clock className="h-3.5 w-3.5" />;
    case "ACTION_REQUIRED":
      return <AlertCircle className="h-3.5 w-3.5" />;
    case "EXPIRED":
      return <XCircle className="h-3.5 w-3.5" />;
    case "PAUSED":
      return <AlertCircle className="h-3.5 w-3.5" />;
  }
}

function kycScore(rp: RentalProvider) {
  const fields = [
    rp.entityType,
    rp.contactAddress,
    rp.tradeLicenseNumber,
    rp.emiratesIdNumber,
    rp.bankIban,
    rp.companyName,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}

function spKycScore(sp: ServiceProvider) {
  const fields = [sp.entityType, sp.businessName ?? sp.ownerName, sp.serviceCategory];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums w-8">{score}%</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = "rental" | "service";

export default function AdminKycPage() {
  const [tab, setTab] = useState<Tab>("rental");
  const [rps, setRps] = useState<RentalProvider[]>([]);
  const [sps, setSps] = useState<ServiceProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rpData, spData] = await Promise.all([
        apiGet<RentalProvider[]>("/admin/kyc/rental-providers"),
        apiGet<ServiceProvider[]>("/admin/kyc/service-providers"),
      ]);
      setRps(rpData);
      setSps(spData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rpByStatus = (s: ComplianceStatus) => rps.filter((r) => r.complianceStatus === s).length;
  const spByStatus = (s: ComplianceStatus) => sps.filter((r) => r.complianceStatus === s).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">KYC Review Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Review provider compliance, submitted documents, and profile completeness
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "RP Pending Review", count: rpByStatus("PENDING_REVIEW"), color: "text-amber-600", bg: "bg-amber-50" },
          { label: "RP Action Required", count: rpByStatus("ACTION_REQUIRED"), color: "text-red-600", bg: "bg-red-50" },
          { label: "SP Pending Review", count: spByStatus("PENDING_REVIEW"), color: "text-amber-600", bg: "bg-amber-50" },
          { label: "SP Action Required", count: spByStatus("ACTION_REQUIRED"), color: "text-red-600", bg: "bg-red-50" },
        ].map((c) => (
          <div key={c.label} className={`${c.bg} rounded-xl p-4`}>
            <div className={`text-2xl font-bold ${c.color}`}>{c.count}</div>
            <div className="text-xs text-gray-600 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {(
            [
              { id: "rental" as Tab, label: "Rental Providers", Icon: Building2, count: rps.length },
              { id: "service" as Tab, label: "Service Providers", Icon: Wrench, count: sps.length },
            ]
          ).map(({ id, label, Icon, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  tab === id ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Rental Providers table */}
      {tab === "rental" && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Provider</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Entity</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">KYC Completeness</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Registered</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-400">Loading…</td>
                </tr>
              )}
              {!loading && rps.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-400">No rental providers found</td>
                </tr>
              )}
              {rps.map((rp) => {
                const name = rp.user ? `${rp.user.firstName} ${rp.user.lastName}` : `RP #${rp.id}`;
                return (
                  <tr key={rp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{name}</div>
                      {rp.user?.email && <div className="text-xs text-gray-400">{rp.user.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 capitalize">
                      {rp.entityType?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${complianceColor(rp.complianceStatus)}`}>
                        {complianceIcon(rp.complianceStatus)}
                        {rp.complianceStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBar score={kycScore(rp)} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(rp.createdAt).toLocaleDateString("en-AE")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/admin/kyc/rental-provider/${rp.id}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        Review <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Service Providers table */}
      {tab === "service" && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Provider</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">KYC Completeness</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Rating</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Registered</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td>
                </tr>
              )}
              {!loading && sps.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">No service providers found</td>
                </tr>
              )}
              {sps.map((sp) => {
                const name = sp.businessName ?? sp.ownerName ?? (sp.user ? `${sp.user.firstName} ${sp.user.lastName}` : `SP #${sp.id}`);
                return (
                  <tr key={sp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{name}</div>
                      {sp.user?.email && <div className="text-xs text-gray-400">{sp.user.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 capitalize">
                      {sp.serviceCategory?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${complianceColor(sp.complianceStatus)}`}>
                        {complianceIcon(sp.complianceStatus)}
                        {sp.complianceStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBar score={spKycScore(sp)} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {sp.averageRating != null ? (
                        <span className="flex items-center gap-1">
                          <span className="text-amber-500">★</span>
                          {sp.averageRating.toFixed(1)}
                          <span className="text-xs text-gray-400">({sp.totalReviews ?? 0})</span>
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(sp.createdAt).toLocaleDateString("en-AE")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/admin/kyc/service-provider/${sp.id}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        Review <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

