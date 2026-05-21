"use client";

/**
 * Rental Provider — Account Setup (kyc-v3 design).
 *
 * Single-page accordion flow with top stepper, hero, and sticky bottom bar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Manrope, Instrument_Serif } from "next/font/google";
import { useRouter } from "next/navigation";
import {
  Bell, AlertCircle, Briefcase, Check, ChevronRight, ChevronLeft,
  FileText, Home, Lock, LogOut, Phone, Plus, Minus, Send, ShieldCheck, Sparkles,
  Trash2, Upload, User, Users, Pencil,
} from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import s from "./onboarding.module.css";

const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap", variable: "--font-serif" });

const cn = (...x: Array<string | false | null | undefined>) => x.filter(Boolean).join(" ");

// ───────── Static data ─────────

const NATIONALITIES = [
  "Afghan","Albanian","Algerian","American","Angolan","Argentinian","Armenian","Australian","Austrian",
  "Azerbaijani","Bahraini","Bangladeshi","Belgian","Bolivian","Bosnian","Brazilian","British","Bulgarian",
  "Cambodian","Cameroonian","Canadian","Chilean","Chinese","Colombian","Congolese","Croatian","Cuban",
  "Czech","Danish","Egyptian","Emirati","Ethiopian","Filipino","Finnish","French","Georgian","German",
  "Ghanaian","Greek","Guatemalan","Haitian","Honduran","Hungarian","Indian","Indonesian","Iranian","Iraqi",
  "Irish","Israeli","Italian","Jamaican","Japanese","Jordanian","Kazakh","Kenyan","Korean","Kuwaiti",
  "Lebanese","Libyan","Malaysian","Mexican","Moroccan","Namibian","Nepali","New Zealander","Nigerian",
  "Norwegian","Omani","Pakistani","Palestinian","Paraguayan","Peruvian","Polish","Portuguese","Qatari",
  "Romanian","Russian","Saudi","Serbian","Singaporean","Slovak","Somali","South African","Spanish",
  "Sri Lankan","Sudanese","Swedish","Swiss","Syrian","Taiwanese","Tanzanian","Thai","Tunisian","Turkish",
  "Ugandan","Ukrainian","Venezuelan","Vietnamese","Yemeni","Zambian","Zimbabwean",
].sort();

const TRADE_AUTHORITIES = [
  "Dubai DED","Abu Dhabi DED","Sharjah Economic Department","DMCC","JAFZA","RAKEZ","ADGM","DIFC",
  "Ajman DED","Fujairah DED","RAK DED","UAQ DED","Sharjah Free Zone","HFZA","SHAMS","IFZA",
];

const ACCOUNT_TYPES = [
  { id: "individual", title: "Individual Landlord", desc: "Private person owning properties under your own name.",                Icon: User,      docs: 1, entityType: "individual", companyType: null as null | "landlord" | "brokerage" | "agents" },
  { id: "landlord",   title: "Landlord Company",    desc: "Company that owns and lets its own properties.",                       Icon: Home,      docs: 2, entityType: "company",    companyType: "landlord" as const },
  { id: "brokerage",  title: "Brokerage Company",   desc: "Licensed brokerage managing properties for owners.",                   Icon: Briefcase, docs: 3, entityType: "company",    companyType: "brokerage" as const },
  { id: "agents",     title: "Agents Company",      desc: "Agents operating under a parent brokerage's licence.",                 Icon: Users,     docs: 4, entityType: "company",    companyType: "agents" as const },
] as const;

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

interface Shareholder { id: string; name: string; nationality: string; ownershipPercent: number }
interface ShDocState  { uploaded: boolean; url?: string; mimeType?: string; fileName?: string }

interface RpProfile {
  id: number; entityType: string; accountTypeConfirmedAt: string | null;
  nationality: string | null; companyName: string | null;
  tradeLicenseNumber: string | null; tradeLicenseAuthority: string | null;
  complianceStatus?: string; complianceNotes?: string | null;
  companyType?: "landlord" | "brokerage" | "agents" | null;
  parentBrokerageName?: string | null;
  shareholders?: Shareholder[] | null;
  hasPoa?: boolean | null; poaPersonName?: string | null;
  poaPersonPhone?: string | null; poaPersonEmail?: string | null;
  // Extended KYC fields
  dateOfBirth?: string | null;
  contactAddress?: string | null;
  emiratesIdNumber?: string | null;
  passportNumber?: string | null;
}

const newId = () => `sh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ───────── Page ─────────

export default function RentalProviderOnboardingPage() {
  const { user, refresh, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = () => { signOut(); };

  const [loadState, setLoadState] = useState<"loading" | "form" | "submitted" | "action_required">("loading");
  const [profile, setProfile] = useState<RpProfile | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [currentIdx, setCurrentIdx] = useState(0);

  const [accountKindId, setAccountKindId] = useState<typeof ACCOUNT_TYPES[number]["id"]>("individual");
  const kind = ACCOUNT_TYPES.find((k) => k.id === accountKindId)!;
  const isCompany = kind.entityType === "company";
  const isAgent = kind.companyType === "agents";

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [nationality, setNationality] = useState("");
  const [hasPoa, setHasPoa] = useState(false);
  const [poaPersonName, setPoaPersonName] = useState("");
  const [poaPersonPhone, setPoaPersonPhone] = useState("");
  const [poaPersonEmail, setPoaPersonEmail] = useState("");

  const [otpPhase, setOtpPhase] = useState<"idle" | "sending" | "sent" | "verifying" | "verified">("idle");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [tradeLicenseNumber, setTradeLicenseNumber] = useState("");
  const [tradeLicenseAuthority, setTradeLicenseAuthority] = useState("");
  const [parentBrokerageName, setParentBrokerageName] = useState("");
  const [brokerageOptions, setBrokerageOptions] = useState<Array<{ id: number; companyName: string }>>([]);

  // Extended KYC fields
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [emiratesIdNumber, setEmiratesIdNumber] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [shareholderCount, setShareholderCount] = useState(0);
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  // True once the user explicitly clicks "Save & continue" on the shareholders
  // section, OR loads a profile that already has shareholders. Prevents the
  // empty 0-shareholder default from being auto-marked complete.
  const [shareholdersConfirmed, setShareholdersConfirmed] = useState(false);

  const [shDocs, setShDocs] = useState<Record<string, ShDocState>>({});
  const [shUploading, setShUploading] = useState<string | null>(null);
  const [shUploadErrors, setShUploadErrors] = useState<Record<string, string>>({});
  const shFileInputRef = useRef<HTMLInputElement>(null);
  const shPendingKey = useRef<string | null>(null);

  const [checklist, setChecklist] = useState<Array<{ key: string; displayName: string; description: string; required: boolean; category: string; uploaded: boolean; fileUrl: string | null; mimeType: string | null }>>([]);

  // ── Load profile ──
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await apiGet<{ profile: RpProfile; checklist: typeof checklist }>("/profiles/rental-provider/me");
        const p = res.profile;
        setProfile(p);
        setProfileId(p.id);
        setChecklist(res.checklist ?? []);

        if (p.complianceStatus === "compliant") {
          router.replace("/rental-provider/dashboard");
          return;
        }
        if (p.accountTypeConfirmedAt && p.complianceStatus !== "action_required") {
          setLoadState("submitted");
          return;
        }

        const matched = ACCOUNT_TYPES.find(
          (k) => k.entityType === p.entityType && (k.companyType ?? null) === (p.companyType ?? null),
        );
        if (matched) setAccountKindId(matched.id);

        setFullName(user.name ?? "");
        setPhone(user.phone ?? "");
        if (user.phoneVerified) { setPhoneVerified(true); setOtpPhase("verified"); }

        if (p.nationality)               setNationality(p.nationality);
        if (p.companyName)               setCompanyName(p.companyName);
        if (p.tradeLicenseNumber)        setTradeLicenseNumber(p.tradeLicenseNumber);
        if (p.tradeLicenseAuthority)     setTradeLicenseAuthority(p.tradeLicenseAuthority);
        if (p.parentBrokerageName)       setParentBrokerageName(p.parentBrokerageName);
        if (p.hasPoa)                    setHasPoa(true);
        if (p.poaPersonName)             setPoaPersonName(p.poaPersonName);
        if (p.poaPersonPhone)            setPoaPersonPhone(p.poaPersonPhone);
        if (p.poaPersonEmail)            setPoaPersonEmail(p.poaPersonEmail);
        if (p.dateOfBirth)               setDateOfBirth(p.dateOfBirth);
        if (p.contactAddress)            setContactAddress(p.contactAddress);
        if (p.emiratesIdNumber)          setEmiratesIdNumber(p.emiratesIdNumber);
        if (p.passportNumber)            setPassportNumber(p.passportNumber);
        if (p.shareholders?.length) {
          setShareholderCount(p.shareholders.length);
          setShareholders(p.shareholders);
          setShareholdersConfirmed(true);
        } else if (p.accountTypeConfirmedAt) {
          // User has previously submitted with 0 shareholders — keep the
          // section marked as confirmed so they don't need to re-step through it.
          setShareholdersConfirmed(true);
        }

        try {
          const docs = await apiGet<Array<{ documentKey: string; fileUrl: string; mimeType: string }>>(
            `/documents?ownerType=rental_provider&ownerId=${p.id}`
          );
          const map: Record<string, ShDocState> = {};
          for (const d of docs) {
            if (d.documentKey.startsWith("sh_") || d.documentKey.startsWith("poa_")) {
              map[d.documentKey] = { uploaded: true, url: d.fileUrl, mimeType: d.mimeType };
            }
          }
          if (Object.keys(map).length) setShDocs((prev) => ({ ...prev, ...map }));
        } catch { /* none yet */ }

        setLoadState(p.complianceStatus === "action_required" ? "action_required" : "form");
      } catch {
        setFullName(user.name ?? "");
        setPhone(user.phone ?? "");
        if (user.phoneVerified) { setPhoneVerified(true); setOtpPhase("verified"); }
        setLoadState("form");
      }
    })();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiGet<Array<{ id: number; companyName: string }>>("/profiles/rental-provider/brokerages")
      .then((rows) => setBrokerageOptions(rows ?? []))
      .catch(() => setBrokerageOptions([]));
  }, []);

  const sections = useMemo(() => {
    const arr: Array<{ id: string; label: string }> = [
      { id: "account", label: "Account Type" },
      { id: "details", label: isCompany ? "Your Info" : "Your Details" },
    ];
    if (isCompany) {
      arr.push({ id: "business", label: "Business" });
      if (kind.companyType !== "agents") arr.push({ id: "shareholders", label: "Shareholders" });
    }
    arr.push({ id: "documents", label: "Documents" });
    return arr;
  }, [isCompany, kind.companyType]);

  useEffect(() => {
    if (currentIdx >= sections.length) setCurrentIdx(sections.length - 1);
  }, [sections.length, currentIdx]);

  const totalSharePct = shareholders.reduce((sum, sh) => sum + (sh.ownershipPercent || 0), 0);

  function checklistForKind(): Array<{ key: string; displayName: string; required: boolean; description: string }> {
    const COMPANY_BASE = [
      { key: "trade_license",   displayName: "Trade License",                       required: true,  description: "Valid UAE trade licence. Must be current — expired licences cannot be accepted." },
      { key: "emirates_id",     displayName: "Emirates ID",                         required: false, description: "Emirates ID (both sides) of a UAE national or resident representative. Optional." },
      { key: "passport",        displayName: "Passport",                            required: false, description: "Bio-data page of a valid passport. Optional." },
      { key: "visa",            displayName: "UAE Visa",                            required: false, description: "UAE residency or entry visa. Optional." },
    ];
    if (kind.id === "individual") return [
      { key: "emirates_id", displayName: "Emirates ID",          required: true,  description: "Clear scan of your Emirates ID (both sides). Required for UAE nationals and residents." },
      { key: "passport",    displayName: "Passport",             required: false, description: "Bio-data page of your valid passport. Required for non-UAE nationals." },
      { key: "visa",        displayName: "UAE Residency Visa",   required: false, description: "Residency visa page. Required for expatriate residents." },
    ];
    if (kind.id === "brokerage") return [
      ...COMPANY_BASE,
      { key: "brokerage_license", displayName: "Brokerage License", required: true, description: "Valid real-estate brokerage licence from the relevant emirate regulator." },
    ];
    if (kind.id === "agents") return [
      ...COMPANY_BASE,
      { key: "broker_registration",        displayName: "Broker Registration Number Certificate", required: true, description: "Real-estate agent registration certificate (BRN card or equivalent)." },
      { key: "parent_brokerage_agreement", displayName: "Agency Agreement with Parent Brokerage", required: true, description: "Signed agreement authorising you to operate under the parent brokerage." },
    ];
    return COMPANY_BASE;
  }

  const docsForKind = checklistForKind();

  const completion = useMemo(() => {
    const m: Record<string, boolean> = {};
    m.account = true;
    const detailsBase = !!fullName.trim() && phoneVerified;
    const detailsExtra = isCompany ? true : !!nationality.trim();
    const poaOk = !hasPoa || (
      !!poaPersonName.trim() &&
      !!poaPersonPhone.trim() &&
      !!poaPersonEmail.trim() &&
      /^\S+@\S+\.\S+$/.test(poaPersonEmail.trim()) &&
      !!shDocs.poa_document?.uploaded &&
      !!shDocs.poa_emirates_id?.uploaded
    );
    m.details = detailsBase && detailsExtra && poaOk;

    if (isCompany) {
      m.business =
        !!companyName.trim() &&
        !!tradeLicenseNumber.trim() &&
        !!tradeLicenseAuthority.trim() &&
        (!isAgent || !!parentBrokerageName.trim());

      if (kind.companyType !== "agents") {
        const hasAny = shareholders.length > 0;
        const allFilled = !hasAny || shareholders.every(
          (sh) => !!sh.name.trim() && sh.ownershipPercent > 0 && !!shDocs[`${sh.id}_emirates_id`]?.uploaded,
        );
        const totalOK = !hasAny || Math.abs(totalSharePct - 100) < 0.01;
        // Step is "done" only when:
        //   • the user has filled at least one valid shareholder OR
        //   • they explicitly confirmed 0 shareholders via "Save & continue".
        m.shareholders = (hasAny || shareholdersConfirmed) && allFilled && totalOK;
      }
    }

    const reqMissing = docsForKind.filter((d) => d.required && !checklist.find((c) => c.key === d.key && c.uploaded)).length;
    m.documents = reqMissing === 0 && docsForKind.length > 0;
    return m;
  }, [fullName, phoneVerified, isCompany, isAgent, kind, nationality, hasPoa, poaPersonName, poaPersonPhone, poaPersonEmail, shDocs, companyName, tradeLicenseNumber, tradeLicenseAuthority, parentBrokerageName, shareholders, totalSharePct, shareholdersConfirmed, checklist, docsForKind]);

  const completedCount = sections.filter((sec) => completion[sec.id]).length;
  const allDone = sections.every((sec) => completion[sec.id]);

  const goNext = () => setCurrentIdx((i) => Math.min(i + 1, sections.length - 1));
  const goBack = () => setCurrentIdx((i) => Math.max(i - 1, 0));
  const jumpTo = (i: number) => setCurrentIdx(i);

  // ── Phone OTP ──
  async function sendPhoneOtp() {
    if (!phone.trim()) { setPhoneError("Enter your phone number first."); return; }
    setPhoneError(null); setOtpPhase("sending");
    try {
      await apiPatch("/auth/me", { phone: phone.trim() });
      const r = await apiPost<{ sent: boolean; devOtp?: string }>("/auth/otp/request", {});
      if (r.devOtp) setDevOtp(r.devOtp);
      setOtpPhase("sent");
    } catch (e: unknown) {
      setPhoneError(e instanceof Error ? e.message : "Failed to send code.");
      setOtpPhase("idle");
    }
  }
  async function verifyPhoneOtp() {
    if (otpCode.length !== 6) { setPhoneError("Enter the 6-digit code."); return; }
    setPhoneError(null); setOtpPhase("verifying");
    try {
      await apiPost("/auth/otp/verify", { code: otpCode });
      await refresh();
      setPhoneVerified(true); setOtpPhase("verified");
    } catch (e: unknown) {
      setPhoneError(e instanceof Error ? e.message : "Invalid code.");
      setOtpPhase("sent");
    }
  }

  // ── Shareholders ──
  function changeShareholderCount(n: number) {
    const clamped = Math.max(0, Math.min(20, n));
    setShareholderCount(clamped);
    setShareholders((prev) => {
      if (clamped > prev.length) {
        return [...prev, ...Array.from({ length: clamped - prev.length }, () => ({
          id: newId(), name: "", nationality: "", ownershipPercent: 0,
        }))];
      }
      const removed = prev.slice(clamped);
      setShDocs((docs) => {
        const next = { ...docs };
        removed.forEach((sh) => Object.keys(next).forEach((k) => { if (k.startsWith(sh.id)) delete next[k]; }));
        return next;
      });
      return prev.slice(0, clamped);
    });
  }
  function updateShareholder(id: string, patch: Partial<Shareholder>) {
    setShareholders((prev) => prev.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)));
  }
  function removeShareholder(id: string) {
    setShareholders((prev) => prev.filter((sh) => sh.id !== id));
    setShareholderCount((c) => Math.max(0, c - 1));
    setShDocs((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => { if (k.startsWith(id)) delete next[k]; });
      return next;
    });
  }

  // ── Uploads ──
  function uploadClick(docKey: string) {
    shPendingKey.current = docKey;
    shFileInputRef.current?.click();
  }
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const docKey = shPendingKey.current;
    if (!file || !docKey || !profileId) return;
    e.target.value = "";

    if (!ALLOWED_MIME.includes(file.type)) {
      setShUploadErrors((p) => ({ ...p, [docKey]: "Only JPG, PNG, WebP or PDF files are allowed." }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setShUploadErrors((p) => ({ ...p, [docKey]: "File must be under 10 MB." }));
      return;
    }
    setShUploadErrors((p) => { const n = { ...p }; delete n[docKey]; return n; });
    setShUploading(docKey);
    const localPreviewUrl = URL.createObjectURL(file);

    try {
      const { uploadUrl, fileUrl, fileKey } = await apiPost<{ uploadUrl: string; fileUrl: string; fileKey: string }>(
        "/documents/upload-url",
        { ownerType: "rental_provider", ownerId: profileId, documentKey: docKey, mimeType: file.type, originalName: file.name },
      );
      const uploadTarget = (() => {
        try {
          const u = new URL(uploadUrl);
          return u.pathname.startsWith("/api/") ? u.pathname + u.search : uploadUrl;
        } catch { return uploadUrl; }
      })();
      const s3Res = await fetch(uploadTarget, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!s3Res.ok) throw new Error("Upload to storage failed");

      const suffix = docKey.split("_").slice(-2).join("_");
      const displayName =
        suffix.includes("trade_license") ? "Trade License"
        : suffix.includes("emirates_id") ? "Emirates ID"
        : suffix.includes("passport") ? "Passport"
        : suffix.includes("visa") ? "UAE Visa"
        : suffix.includes("moa") ? "MOA"
        : suffix.includes("brokerage_license") ? "Brokerage License"
        : suffix.includes("broker_registration") ? "Broker Registration Number Certificate"
        : suffix.includes("parent_brokerage_agreement") ? "Agency Agreement with Parent Brokerage"
        : suffix.includes("poa_document") ? "POA Document"
        : suffix.replace(/_/g, " ");
      const category = suffix.includes("license") || suffix.includes("registration") ? "license"
        : suffix.includes("agreement") || suffix.includes("moa") || suffix.includes("poa_document") ? "compliance"
        : "identity";

      await apiPost("/documents", {
        ownerType: "rental_provider", ownerId: profileId,
        category, documentKey: docKey, displayName,
        fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: "s3",
      });
      setShDocs((p) => ({ ...p, [docKey]: { uploaded: true, url: localPreviewUrl, mimeType: file.type, fileName: file.name } }));

      if (!docKey.startsWith("sh_") && !docKey.startsWith("poa_")) {
        apiGet<{ profile: RpProfile; checklist: typeof checklist }>("/profiles/rental-provider/me")
          .then((r) => setChecklist(r.checklist ?? []))
          .catch(() => {});
      }
    } catch (err) {
      URL.revokeObjectURL(localPreviewUrl);
      setShUploadErrors((p) => ({ ...p, [docKey]: err instanceof Error ? err.message : "Upload failed. Try again." }));
    } finally {
      setShUploading(null);
    }
  }

  async function handleSubmit() {
    setSubmitError(null);
    try {
      await apiPatch("/auth/me", { fullName });
      const payload: Record<string, unknown> = { entityType: kind.entityType };
      // Shared fields
      payload.contactAddress = contactAddress.trim() || null;
      if (kind.entityType === "individual") {
        payload.nationality = nationality.trim() || null;
        payload.dateOfBirth = dateOfBirth || null;
        payload.emiratesIdNumber = emiratesIdNumber.trim() || null;
        payload.passportNumber = passportNumber.trim() || null;
        payload.hasPoa = hasPoa;
        payload.poaPersonName  = hasPoa ? poaPersonName.trim()  : null;
        payload.poaPersonPhone = hasPoa ? poaPersonPhone.trim() : null;
        payload.poaPersonEmail = hasPoa ? poaPersonEmail.trim() : null;
      } else {
        payload.companyName = companyName.trim() || null;
        payload.tradeLicenseNumber = tradeLicenseNumber.trim() || null;
        payload.tradeLicenseAuthority = tradeLicenseAuthority.trim() || null;
        payload.emiratesIdNumber = emiratesIdNumber.trim() || null;
        payload.passportNumber = passportNumber.trim() || null;
        payload.companyType = kind.companyType;
        payload.parentBrokerageName = kind.companyType === "agents" ? parentBrokerageName.trim() : null;
        payload.shareholders = shareholders.length ? shareholders : null;
      }
      await apiPatch("/profiles/rental-provider/me", payload);
      await refresh();
      setLoadState("submitted");
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  const stateAt = (i: number): "active" | "done" | "locked" => {
    if (i === currentIdx) return "active";
    if (completion[sections[i].id]) return "done";
    return "locked";
  };

  const fontClass = cn(manrope.className, instrumentSerif.variable);

  if (loadState === "loading") {
    return (
      <div className={cn(s.app, fontClass)}>
        <div className={s.main}><p style={{ color: "var(--mute)" }}>Loading…</p></div>
      </div>
    );
  }

  if (loadState === "submitted") {
    const stages = [
      { key: "submitted", label: "Application submitted",        sub: "We&rsquo;ve received your details and documents.",             done: true  },
      { key: "review",    label: "Under compliance review",      sub: "Our team is verifying your identity and licences.",            done: false, current: true },
      { key: "approved",  label: "Approved &mdash; account active",   sub: "You&rsquo;ll be able to list properties and accept tenants.", done: false },
    ];

    return (
      <div className={cn(s.app, fontClass)}>
        {/* Minimal header — brand on the left, sign-out on the right */}
        <div className={s.topbar}>
          <div className={s.topbarRow}>
            <div className={s.tbLeft}>
              <div className={s.brand}>
                <span className={s.brandMark}>U</span>
                <span>UpNow</span>
              </div>
            </div>
            <div className={s.tbRight}>
              {user && (
                <button
                  type="button"
                  className={cn(s.btn, s.btnGhost, s.btnSm)}
                  onClick={handleSignOut}
                  title={`Signed in as ${user.email}`}
                >
                  <LogOut size={13} /> Sign out
                </button>
              )}
            </div>
          </div>
        </div>

        <div className={s.main} style={{ maxWidth: 640 }}>
          <div className={s.success}>
            <div className={s.successBadge}><Check size={38} strokeWidth={3} /></div>
            <h2 className={s.successH2}>Thank you. Your profile is <span className={s.serif}>under review</span></h2>
            <p className={s.successDesc}>
              We appreciate you taking the time to complete your account setup. Our compliance team typically responds within 1&ndash;2 business days. You&rsquo;ll receive an email the moment a decision is made.
            </p>

            {/* Timeline */}
            <div style={{ textAlign: "left", maxWidth: 420, margin: "8px auto 20px", padding: "20px 22px", background: "#fafbf6", border: "1px solid var(--line)", borderRadius: 14 }}>
              {stages.map((st, i) => {
                const Active = st.done || st.current;
                return (
                  <div key={st.key} style={{ display: "flex", gap: 14, paddingBottom: i < stages.length - 1 ? 16 : 0, position: "relative" }}>
                    {i < stages.length - 1 && (
                      <span style={{ position: "absolute", left: 13, top: 30, bottom: 0, width: 2, background: st.done ? "var(--green)" : "var(--line)" }} />
                    )}
                    <span
                      style={{
                        width: 28, height: 28, borderRadius: 99,
                        display: "grid", placeItems: "center", flexShrink: 0,
                        background: st.done ? "var(--green)" : st.current ? "color-mix(in srgb, var(--green) 12%, white)" : "var(--paper-2)",
                        color: st.done ? "#fff" : st.current ? "var(--green-d)" : "var(--mute)",
                        border: st.current ? "2px solid var(--green)" : "0",
                        animation: st.current ? "pulseAnim 1.8s ease-in-out infinite" : undefined,
                      }}
                    >
                      {st.done ? <Check size={14} strokeWidth={3} /> : <span style={{ fontSize: 11, fontWeight: 700 }}>{i + 1}</span>}
                    </span>
                    <div style={{ paddingTop: 2 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: Active ? "var(--ink)" : "var(--mute)" }}
                           dangerouslySetInnerHTML={{ __html: st.label }} />
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}
                           dangerouslySetInnerHTML={{ __html: st.sub }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {profile?.complianceNotes && (
              <div className={s.successRef} style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
                <AlertCircle size={14} /> <span>{profile.complianceNotes}</span>
              </div>
            )}

            <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 8 }}>
              We&rsquo;ll send you an email at <b style={{ color: "var(--ink-2)" }}>{user?.email}</b> once your account is approved.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(s.app, fontClass)}>
      <input
        ref={shFileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.pdf"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Topbar */}
      <div className={s.topbar}>
        <div className={s.topbarRow}>
          <div className={s.tbLeft}>
            <div className={s.brand}>
              <span className={s.brandMark}>U</span>
              <span>UpNow</span>
            </div>
            <span className={s.brandDivider} />
            <div className={s.crumbs}>Account / <b>Setup</b></div>
          </div>
          <div className={s.tbRight}>
            <span className={s.pillSave}><span className={s.dot} /> Draft saved</span>
            <span className={s.pillWarn}><span className={s.pulse} /> KYC required</span>
            <button className={s.iconBtn} aria-label="Notifications"><Bell size={18} /></button>
            {user && (
              <button
                type="button"
                className={cn(s.btn, s.btnGhost, s.btnSm)}
                onClick={handleSignOut}
                title={`Signed in as ${user.email}`}
              >
                <LogOut size={13} /> Sign out
              </button>
            )}
          </div>
        </div>

        <div className={s.stepperBar}>
          {sections.map((sec, i) => {
            const done = completion[sec.id] && i !== currentIdx;
            const active = i === currentIdx;
            const locked = !done && !active;
            return (
              <div key={sec.id} style={{ display: "contents" }}>
                <button
                  type="button"
                  className={cn(s.step, active && s.active, done && s.done, locked && s.locked)}
                  onClick={() => (!locked) && jumpTo(i)}
                >
                  <span className={s.stepNum}>{done ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
                  <span className={s.stepLbl}>{sec.label}</span>
                </button>
                {i < sections.length - 1 && (
                  <span className={cn(s.stepConnector, (done || i < currentIdx) && s.done)} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main */}
      <div className={s.main}>
        <div className={s.hero}>
          <div className={s.heroEyebrow}><ShieldCheck size={12} /> Account Verification</div>
          <h1 className={s.heroTitle}>Set up your <span className={s.serif}>rental account</span></h1>
          <p className={s.heroDesc}>Get verified to start collecting rent through UpNow. We&apos;ll guide you step by step — most providers finish in under 10 minutes.</p>
          <div className={s.metaStrip}>
            <span className={s.metaIc}><Sparkles size={14} /></span>
            <span><b>5–10 min</b> to complete</span>
            <span className={s.metaDot} />
            <span><b>1–2 days</b> review</span>
          </div>
        </div>

        {loadState === "action_required" && profile?.complianceNotes && (
          <div className={cn(s.shSummary, s.warn)}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle size={14} /> Action required
            </span>
            <b>{profile.complianceNotes}</b>
          </div>
        )}

        <div className={s.sections}>
          {sections.map((sec, idx) => {
            const sState = stateAt(idx);
            const n = idx + 1;
            return (
              <Section
                key={sec.id}
                n={n}
                state={sState}
                title={sectionTitle(sec.id, isCompany)}
                sub={sectionSub(sec.id, isCompany)}
                summary={sectionSummary(sec.id, { kind, fullName, phoneVerified, phone, nationality, companyName, tradeLicenseNumber, shareholders, totalSharePct, docsForKind, checklist })}
                onEdit={() => jumpTo(idx)}
              >
                {sec.id === "account" && (
                  <SectionAccountType
                    selectedId={accountKindId}
                    onSelect={(id) => {
                      setAccountKindId(id);
                      const k = ACCOUNT_TYPES.find((x) => x.id === id)!;
                      if (k.companyType === "agents") { setShareholderCount(0); setShareholders([]); }
                      if (k.entityType === "company") { setHasPoa(false); setPoaPersonName(""); setPoaPersonPhone(""); setPoaPersonEmail(""); }
                    }}
                    onContinue={goNext}
                  />
                )}

                {sec.id === "details" && (
                  <SectionDetails
                    isCompany={isCompany}
                    fullName={fullName} setFullName={setFullName}
                    phone={phone} setPhone={setPhone}
                    phoneVerified={phoneVerified}
                    otpPhase={otpPhase} otpCode={otpCode} setOtpCode={setOtpCode}
                    phoneError={phoneError} devOtp={devOtp}
                    sendPhoneOtp={sendPhoneOtp} verifyPhoneOtp={verifyPhoneOtp}
                    nationality={nationality} setNationality={setNationality}
                    dateOfBirth={dateOfBirth} setDateOfBirth={setDateOfBirth}
                    contactAddress={contactAddress} setContactAddress={setContactAddress}
                    emiratesIdNumber={emiratesIdNumber} setEmiratesIdNumber={setEmiratesIdNumber}
                    passportNumber={passportNumber} setPassportNumber={setPassportNumber}
                    hasPoa={hasPoa} setHasPoa={setHasPoa}
                    poaPersonName={poaPersonName} setPoaPersonName={setPoaPersonName}
                    poaPersonPhone={poaPersonPhone} setPoaPersonPhone={setPoaPersonPhone}
                    poaPersonEmail={poaPersonEmail} setPoaPersonEmail={setPoaPersonEmail}
                    shDocs={shDocs} shUploading={shUploading} shUploadErrors={shUploadErrors}
                    onUploadClick={uploadClick}
                    onBack={goBack} onContinue={goNext}
                  />
                )}

                {sec.id === "business" && (
                  <SectionBusiness
                    isAgent={isAgent}
                    companyName={companyName} setCompanyName={setCompanyName}
                    tradeLicenseNumber={tradeLicenseNumber} setTradeLicenseNumber={setTradeLicenseNumber}
                    tradeLicenseAuthority={tradeLicenseAuthority} setTradeLicenseAuthority={setTradeLicenseAuthority}
                    contactAddress={contactAddress} setContactAddress={setContactAddress}
                    emiratesIdNumber={emiratesIdNumber} setEmiratesIdNumber={setEmiratesIdNumber}
                    passportNumber={passportNumber} setPassportNumber={setPassportNumber}
                    parentBrokerageName={parentBrokerageName} setParentBrokerageName={setParentBrokerageName}
                    brokerageOptions={brokerageOptions}
                    onBack={goBack} onContinue={goNext}
                  />
                )}

                {sec.id === "shareholders" && (
                  <SectionShareholders
                    shareholders={shareholders}
                    shareholderCount={shareholderCount}
                    changeShareholderCount={changeShareholderCount}
                    updateShareholder={updateShareholder}
                    removeShareholder={removeShareholder}
                    totalSharePct={totalSharePct}
                    shDocs={shDocs} shUploading={shUploading} shUploadErrors={shUploadErrors}
                    onUploadClick={uploadClick}
                    onBack={goBack}
                    onContinue={() => { setShareholdersConfirmed(true); goNext(); }}
                  />
                )}

                {sec.id === "documents" && (
                  <SectionKyc
                    docs={docsForKind}
                    checklist={checklist}
                    shDocs={shDocs} shUploading={shUploading} shUploadErrors={shUploadErrors}
                    onUploadClick={uploadClick}
                    onBack={goBack}
                    onSubmit={handleSubmit}
                    submitError={submitError}
                    canSubmit={allDone}
                  />
                )}
              </Section>
            );
          })}
        </div>
      </div>

      <div className={s.actionBar}>
        <div className={s.actionLeft}>
          <div className={s.actionPl}>{completedCount} of {sections.length} steps complete</div>
          <div className={s.actionPs}>
            {allDone ? "Ready to submit ✓" : `Currently on step ${currentIdx + 1}: ${sections[currentIdx]?.label}`}
          </div>
        </div>
        <div className={s.actionRight}>
          <div className={s.progressThin}>
            <div className={s.progressFill} style={{ width: `${(completedCount / sections.length) * 100}%` }} />
          </div>
          <button className={cn(s.btn, s.btnGreen, s.btnLg)} disabled={!allDone} onClick={handleSubmit}>
            <Send size={14} /> Submit for review
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────── Subcomponents ─────────

function Section({ n, state, title, sub, summary, onEdit, children }: {
  n: number; state: "active" | "done" | "locked";
  title: string; sub: string; summary: string;
  onEdit: () => void; children: React.ReactNode;
}) {
  if (state === "active") {
    return (
      <div className={cn(s.sec, s.active)}>
        <div className={s.secActive}>
          <div className={s.secHead}>
            <div className={s.secHeadTitles}>
              <div className={s.secEyebrow}>Step {n}</div>
              <h2 className={s.secH2}>{title}</h2>
              <div className={s.secSub}>{sub}</div>
            </div>
          </div>
          {children}
        </div>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className={cn(s.sec, s.done)} onClick={onEdit}>
        <div className={s.secRow}>
          <div className={s.numCircle}><Check size={14} strokeWidth={3} /></div>
          <div className={s.secTitles}>
            <div className={s.secTtl}>{title}</div>
            <div className={s.secSummary}>{summary}</div>
          </div>
          <button className={cn(s.btn, s.btnMute, s.btnSm, s.editBtn)} type="button">
            <Pencil size={12} /> Edit
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={cn(s.sec, s.locked)}>
      <div className={s.secRow}>
        <div className={s.numCircle}>{n}</div>
        <div className={s.secTitles}>
          <div className={s.secTtl}>{title}</div>
          <div className={s.secSummary}>{sub}</div>
        </div>
        <span className={s.secLockIcon}><Lock size={12} /></span>
      </div>
    </div>
  );
}

function sectionTitle(id: string, isCompany: boolean) {
  switch (id) {
    case "account":      return "Account Type";
    case "details":      return isCompany ? "Your Information" : "Your Details";
    case "business":     return "Business Details";
    case "shareholders": return "Shareholders";
    case "documents":    return "KYC Documents";
    default: return id;
  }
}
function sectionSub(id: string, isCompany: boolean) {
  switch (id) {
    case "account":      return "Pick how you operate.";
    case "details":      return isCompany ? "Name and verified mobile." : "Name, mobile, and nationality.";
    case "business":     return "Registered company information.";
    case "shareholders": return "Anyone owning 25% or more of the company.";
    case "documents":    return "Upload required documents.";
    default: return "";
  }
}

interface SummaryCtx {
  kind: typeof ACCOUNT_TYPES[number];
  fullName: string; phoneVerified: boolean; phone: string;
  nationality: string; companyName: string; tradeLicenseNumber: string;
  shareholders: Shareholder[]; totalSharePct: number;
  docsForKind: Array<{ key: string; required: boolean }>;
  checklist: Array<{ key: string; uploaded: boolean }>;
}
function sectionSummary(id: string, c: SummaryCtx): string {
  switch (id) {
    case "account":
      return `${c.kind.title} · ${c.kind.docs} required document${c.kind.docs === 1 ? "" : "s"}`;
    case "details":
      return c.fullName
        ? `${c.fullName}${c.phoneVerified && c.phone ? " · " + c.phone : ""}${!c.kind.companyType && c.nationality ? " · " + c.nationality : ""}`
        : "Not provided";
    case "business":
      return c.companyName ? `${c.companyName}${c.tradeLicenseNumber ? " · Licence #" + c.tradeLicenseNumber : ""}` : "Not provided";
    case "shareholders":
      return c.shareholders.length === 0
        ? "No qualifying shareholders"
        : `${c.shareholders.length} shareholder${c.shareholders.length > 1 ? "s" : ""} · ${c.totalSharePct.toFixed(1)}%`;
    case "documents": {
      const requiredTotal = c.docsForKind.filter((d) => d.required).length;
      const requiredUploaded = c.docsForKind.filter((d) => d.required && c.checklist.find((cl) => cl.key === d.key && cl.uploaded)).length;
      return requiredUploaded >= requiredTotal
        ? `${requiredUploaded} of ${requiredTotal} required uploaded ✓`
        : `${requiredTotal - requiredUploaded} required document${requiredTotal - requiredUploaded === 1 ? "" : "s"} pending`;
    }
    default: return "";
  }
}

// Account Type ───────────────

function SectionAccountType({ selectedId, onSelect, onContinue }: {
  selectedId: string;
  onSelect: (id: typeof ACCOUNT_TYPES[number]["id"]) => void;
  onContinue: () => void;
}) {
  return (
    <div className={s.secBody}>
      <div className={s.acctGrid}>
        {ACCOUNT_TYPES.map((t) => {
          const active = t.id === selectedId;
          return (
            <div key={t.id} className={cn(s.acct, active && s.active)} onClick={() => onSelect(t.id)}>
              <div className={s.acctTop}>
                <div className={s.acctName}>{t.title}</div>
                <div className={s.acctRadio} />
              </div>
              <div className={s.acctDesc}>{t.desc}</div>
              <div className={s.acctMeta}>{t.docs} required document{t.docs === 1 ? "" : "s"}</div>
            </div>
          );
        })}
      </div>
      <div className={s.secFoot}>
        <div className={s.secFootHelp}><ShieldCheck size={14} /> You can change this anytime before submitting.</div>
        <button className={cn(s.btn, s.btnPrimary)} onClick={onContinue}>
          Continue <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// Details ──────────────────

function SectionDetails(props: {
  isCompany: boolean;
  fullName: string; setFullName: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  phoneVerified: boolean;
  otpPhase: "idle" | "sending" | "sent" | "verifying" | "verified";
  otpCode: string; setOtpCode: (v: string) => void;
  phoneError: string | null; devOtp: string | null;
  sendPhoneOtp: () => void; verifyPhoneOtp: () => void;
  nationality: string; setNationality: (v: string) => void;
  dateOfBirth: string; setDateOfBirth: (v: string) => void;
  contactAddress: string; setContactAddress: (v: string) => void;
  emiratesIdNumber: string; setEmiratesIdNumber: (v: string) => void;
  passportNumber: string; setPassportNumber: (v: string) => void;
  hasPoa: boolean; setHasPoa: (v: boolean) => void;
  poaPersonName: string; setPoaPersonName: (v: string) => void;
  poaPersonPhone: string; setPoaPersonPhone: (v: string) => void;
  poaPersonEmail: string; setPoaPersonEmail: (v: string) => void;
  shDocs: Record<string, ShDocState>; shUploading: string | null; shUploadErrors: Record<string, string>;
  onUploadClick: (key: string) => void;
  onBack: () => void; onContinue: () => void;
}) {
  const {
    isCompany, fullName, setFullName, phone, setPhone, phoneVerified,
    otpPhase, otpCode, setOtpCode, phoneError, devOtp, sendPhoneOtp, verifyPhoneOtp,
    nationality, setNationality,
    dateOfBirth, setDateOfBirth,
    contactAddress, setContactAddress,
    emiratesIdNumber, setEmiratesIdNumber,
    passportNumber, setPassportNumber,
    hasPoa, setHasPoa,
    poaPersonName, setPoaPersonName,
    poaPersonPhone, setPoaPersonPhone,
    poaPersonEmail, setPoaPersonEmail,
    shDocs, shUploading, shUploadErrors, onUploadClick, onBack, onContinue,
  } = props;

  const baseDone = !!fullName.trim() && phoneVerified;
  const poaOk = !hasPoa || (
    !!poaPersonName.trim() &&
    !!poaPersonPhone.trim() &&
    !!poaPersonEmail.trim() &&
    /^\S+@\S+\.\S+$/.test(poaPersonEmail.trim()) &&
    !!shDocs.poa_document?.uploaded &&
    !!shDocs.poa_emirates_id?.uploaded
  );
  const canContinue = baseDone && (isCompany || !!nationality.trim()) && poaOk;

  const poaSlots = [
    { id: "poa_document",    label: "POA Document",          required: true },
    { id: "poa_emirates_id", label: "Holder's Emirates ID",  required: true },
    { id: "poa_passport",    label: "Holder's Passport",     required: false },
    { id: "poa_visa",        label: "Holder's UAE Visa",     required: false },
  ];

  return (
    <div className={s.secBody}>
      <div className={cn(s.field, s.fieldFull)}>
        <label className={s.fieldLabel}>Full name <span className={s.req}>*</span></label>
        <div className={s.input}>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full legal name" />
        </div>
      </div>

      <div className={cn(s.field, s.fieldFull)}>
        <label className={s.fieldLabel}>Mobile number <span className={s.req}>*</span></label>
        <div className={s.sendRow}>
          <div className={cn(s.input, phoneVerified && s.okState)}>
            <span className={s.inputPrefix}>🇦🇪 +971</span>
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="50 123 4567" disabled={phoneVerified}
            />
          </div>
          {phoneVerified ? (
            <span className={cn(s.btn, s.btnGhost)} style={{ color: "var(--green-d)", borderColor: "#cfe7dc", background: "#fbfdfc", cursor: "default" }}>
              <Check size={12} strokeWidth={3} /> Verified
            </span>
          ) : (
            <button
              type="button" className={cn(s.btn, s.btnPrimary)}
              disabled={!phone.trim() || otpPhase === "sending" || otpPhase === "sent"}
              onClick={sendPhoneOtp}
            >
              <Phone size={14} /> {otpPhase === "sending" ? "Sending…" : "Send code"}
            </button>
          )}
        </div>
        {phoneError && <div className={s.err}><AlertCircle size={12} /> {phoneError}</div>}
        {(otpPhase === "sent" || otpPhase === "verifying") && !phoneVerified && (
          <div className={s.subCard}>
            {process.env.NODE_ENV !== "production" && devOtp && (
              <div style={{ background: "var(--warn-bg)", color: "var(--warn-fg)", padding: 10, borderRadius: 8, textAlign: "center", marginBottom: 10, fontFamily: "ui-monospace, monospace", fontWeight: 700, letterSpacing: 4 }}>
                Dev OTP: {devOtp}
              </div>
            )}
            <div className={s.sendRow}>
              <div className={s.input}>
                <input
                  type="text" inputMode="numeric" maxLength={6}
                  value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="6-digit code"
                />
              </div>
              <button
                type="button" className={cn(s.btn, s.btnPrimary)}
                disabled={otpCode.length !== 6 || otpPhase === "verifying"}
                onClick={verifyPhoneOtp}
              >
                {otpPhase === "verifying" ? "Verifying…" : "Verify"}
              </button>
            </div>
          </div>
        )}
      </div>

      {!isCompany && (
        <div className={cn(s.field, s.fieldFull)}>
          <label className={s.fieldLabel}>Nationality <span className={s.req}>*</span></label>
          <div className={cn(s.input, s.dropdown)}>
            <select value={nationality} onChange={(e) => setNationality(e.target.value)}>
              <option value="">Search nationality…</option>
              {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      )}

      {!isCompany && (
        <div className={s.grid2}>
          <div className={s.field}>
            <label className={s.fieldLabel}>Date of birth</label>
            <div className={s.input}>
              <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
          </div>
          <div className={s.field}>
            <label className={s.fieldLabel}>Emirates ID number</label>
            <div className={s.input}>
              <input value={emiratesIdNumber} onChange={(e) => setEmiratesIdNumber(e.target.value)} placeholder="784-XXXX-XXXXXXX-X" />
            </div>
          </div>
        </div>
      )}

      {!isCompany && (
        <div className={cn(s.field, s.fieldFull)}>
          <label className={s.fieldLabel}>Passport number</label>
          <div className={s.input}>
            <input value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} placeholder="e.g. A12345678" />
          </div>
        </div>
      )}

      <div className={cn(s.field, s.fieldFull)}>
        <label className={s.fieldLabel}>Contact address</label>
        <div className={s.input}>
          <input value={contactAddress} onChange={(e) => setContactAddress(e.target.value)} placeholder="Full mailing address" />
        </div>
      </div>

      {!isCompany && (
        <>
          <label className={cn(s.checkLine, hasPoa && s.on)}>
            <input type="checkbox" checked={hasPoa} onChange={(e) => setHasPoa(e.target.checked)} style={{ display: "none" }} />
            <span className={s.checkBox}>{hasPoa && <Check size={11} strokeWidth={3} />}</span>
            <span className={s.checkLineLbl}>
              Someone is managing this account on my behalf (Power of Attorney)
              <span className={s.checkLineSub}>Tick if a representative is authorised to act for you.</span>
            </span>
          </label>

          {hasPoa && (
            <div className={s.subCard}>
              <div className={cn(s.field, s.fieldFull)}>
                <label className={s.fieldLabel}>POA holder full name <span className={s.req}>*</span></label>
                <div className={s.input}>
                  <input value={poaPersonName} onChange={(e) => setPoaPersonName(e.target.value)} placeholder="Full legal name of the representative" />
                </div>
              </div>
              <div className={s.grid2}>
                <div className={s.field}>
                  <label className={s.fieldLabel}>POA holder phone <span className={s.req}>*</span></label>
                  <div className={s.input}>
                    <input type="tel" value={poaPersonPhone} onChange={(e) => setPoaPersonPhone(e.target.value)} placeholder="+971 50 123 4567" />
                  </div>
                </div>
                <div className={s.field}>
                  <label className={s.fieldLabel}>POA holder email <span className={s.req}>*</span></label>
                  <div className={s.input}>
                    <input type="email" value={poaPersonEmail} onChange={(e) => setPoaPersonEmail(e.target.value)} placeholder="name@example.com" />
                  </div>
                </div>
              </div>
              <div className={s.groupLabel}>POA Documents</div>
              <div className={s.docsGrid}>
                {poaSlots.map((p) => (
                  <DocMini key={p.id} docKey={p.id} label={p.label} required={p.required}
                    docs={shDocs} uploading={shUploading} errors={shUploadErrors} onUploadClick={onUploadClick}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className={s.secFoot}>
        <button type="button" className={cn(s.btn, s.btnGhost)} onClick={onBack}><ChevronLeft size={14} /> Back</button>
        <button type="button" className={cn(s.btn, s.btnPrimary)} disabled={!canContinue} onClick={onContinue}>
          Save &amp; continue <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function DocMini({ docKey, label, required, docs, uploading, errors, onUploadClick }: {
  docKey: string; label: string; required: boolean;
  docs: Record<string, ShDocState>;
  uploading: string | null; errors: Record<string, string>;
  onUploadClick: (key: string) => void;
}) {
  const v = docs[docKey];
  const isUploading = uploading === docKey;
  const err = errors[docKey];
  return (
    <div
      className={cn(s.docMini, v?.uploaded && s.uploaded)}
      onClick={() => !v?.uploaded && !isUploading && onUploadClick(docKey)}
    >
      <div className={s.docMiniTop}>
        <span className={s.docMiniNm}>{label}</span>
        {required && !v?.uploaded && <span className={cn(s.badge, s.badgeReq)}>Req</span>}
        {v?.uploaded && <span className={cn(s.badge, s.badgeDone)}><Check size={9} strokeWidth={3} /></span>}
      </div>
      {err && <div className={s.err} style={{ fontSize: 11 }}>{err}</div>}
      {v?.uploaded ? (
        <div className={s.row} style={{ justifyContent: "space-between", gap: 6 }}>
          <span className={s.docMiniFile}>{v.fileName ?? "Uploaded"}</span>
          <button type="button" className={cn(s.btn, s.btnSm, s.btnGhost)}
                  onClick={(e) => { e.stopPropagation(); onUploadClick(docKey); }}>
            Replace
          </button>
        </div>
      ) : (
        <div className={s.docMiniCta}>
          {isUploading ? <>Uploading…</> : <><Upload size={12} /> Click to upload</>}
        </div>
      )}
    </div>
  );
}

// Business ────────────────────

function SectionBusiness(props: {
  isAgent: boolean;
  companyName: string; setCompanyName: (v: string) => void;
  tradeLicenseNumber: string; setTradeLicenseNumber: (v: string) => void;
  tradeLicenseAuthority: string; setTradeLicenseAuthority: (v: string) => void;
  contactAddress: string; setContactAddress: (v: string) => void;
  emiratesIdNumber: string; setEmiratesIdNumber: (v: string) => void;
  passportNumber: string; setPassportNumber: (v: string) => void;
  parentBrokerageName: string; setParentBrokerageName: (v: string) => void;
  brokerageOptions: Array<{ id: number; companyName: string }>;
  onBack: () => void; onContinue: () => void;
}) {
  const {
    isAgent, companyName, setCompanyName, tradeLicenseNumber, setTradeLicenseNumber,
    tradeLicenseAuthority, setTradeLicenseAuthority,
    contactAddress, setContactAddress,
    emiratesIdNumber, setEmiratesIdNumber,
    passportNumber, setPassportNumber,
    parentBrokerageName, setParentBrokerageName,
    brokerageOptions, onBack, onContinue,
  } = props;

  const done = !!companyName.trim() && !!tradeLicenseNumber.trim() && !!tradeLicenseAuthority.trim() && (!isAgent || !!parentBrokerageName.trim());

  return (
    <div className={s.secBody}>
      <div className={cn(s.field, s.fieldFull)}>
        <label className={s.fieldLabel}>Company name <span className={s.req}>*</span></label>
        <div className={s.input}>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Registered business name" />
        </div>
      </div>
      <div className={s.grid2}>
        <div className={s.field}>
          <label className={s.fieldLabel}>Trade licence number <span className={s.req}>*</span></label>
          <div className={s.input}>
            <input value={tradeLicenseNumber} onChange={(e) => setTradeLicenseNumber(e.target.value)} placeholder="e.g. 1234567" />
          </div>
        </div>
        <div className={s.field}>
          <label className={s.fieldLabel}>Trade licence authority <span className={s.req}>*</span></label>
          <div className={cn(s.input, s.dropdown)}>
            <select value={tradeLicenseAuthority} onChange={(e) => setTradeLicenseAuthority(e.target.value)}>
              <option value="">Search authority…</option>
              {TRADE_AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {isAgent && (
        <div className={cn(s.field, s.fieldFull)}>
          <label className={s.fieldLabel}>Parent brokerage <span className={s.req}>*</span></label>
          <div className={s.hint}>The brokerage you operate under. Pick from registered firms or type the name.</div>
          <div className={s.input}>
            <input
              list="brokerage-options"
              value={parentBrokerageName}
              onChange={(e) => setParentBrokerageName(e.target.value)}
              placeholder="Search registered brokerages or type a name…"
            />
            <datalist id="brokerage-options">
              {brokerageOptions.map((b) => <option key={b.id} value={b.companyName} />)}
            </datalist>
          </div>
        </div>
      )}

      <div className={s.grid2}>
        <div className={s.field}>
          <label className={s.fieldLabel}>Signatory Emirates ID</label>
          <div className={s.input}>
            <input value={emiratesIdNumber} onChange={(e) => setEmiratesIdNumber(e.target.value)} placeholder="784-XXXX-XXXXXXX-X" />
          </div>
        </div>
        <div className={s.field}>
          <label className={s.fieldLabel}>Signatory passport no.</label>
          <div className={s.input}>
            <input value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} placeholder="e.g. A12345678" />
          </div>
        </div>
      </div>

      <div className={cn(s.field, s.fieldFull)}>
        <label className={s.fieldLabel}>Contact address</label>
        <div className={s.input}>
          <input value={contactAddress} onChange={(e) => setContactAddress(e.target.value)} placeholder="Registered business address" />
        </div>
      </div>

      <div className={s.secFoot}>
        <button type="button" className={cn(s.btn, s.btnGhost)} onClick={onBack}><ChevronLeft size={14} /> Back</button>
        <button type="button" className={cn(s.btn, s.btnPrimary)} disabled={!done} onClick={onContinue}>
          Save &amp; continue <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// Shareholders ───────────────

function SectionShareholders(props: {
  shareholders: Shareholder[];
  shareholderCount: number;
  changeShareholderCount: (n: number) => void;
  updateShareholder: (id: string, patch: Partial<Shareholder>) => void;
  removeShareholder: (id: string) => void;
  totalSharePct: number;
  shDocs: Record<string, ShDocState>; shUploading: string | null; shUploadErrors: Record<string, string>;
  onUploadClick: (key: string) => void;
  onBack: () => void; onContinue: () => void;
}) {
  const {
    shareholders, shareholderCount, changeShareholderCount, updateShareholder, removeShareholder,
    totalSharePct, shDocs, shUploading, shUploadErrors, onUploadClick, onBack, onContinue,
  } = props;

  const allFilled = shareholders.every(
    (sh) => !!sh.name.trim() && sh.ownershipPercent > 0 && !!shDocs[`${sh.id}_emirates_id`]?.uploaded,
  );
  const totalOK = shareholders.length === 0 || Math.abs(totalSharePct - 100) < 0.01;
  const done = shareholders.length === 0 || (allFilled && totalOK);
  const summaryClass = shareholders.length === 0 ? s.neutral : (totalOK ? s.ok : s.warn);

  return (
    <div className={s.secBody}>
      <div className={s.counterRow}>
        <div>
          <div className={s.counterLbl}>How many shareholders own 25% or more?</div>
          <div className={s.counterSub}>Enter 0 if none qualify.</div>
        </div>
        <div className={s.stepperNum}>
          <button onClick={() => changeShareholderCount(shareholderCount - 1)} disabled={shareholderCount <= 0}><Minus size={14} /></button>
          <span className={s.stepperNumVal}>{shareholderCount}</span>
          <button onClick={() => changeShareholderCount(shareholderCount + 1)} disabled={shareholderCount >= 20}><Plus size={14} /></button>
        </div>
      </div>

      {shareholders.length > 0 && (
        <div className={cn(s.shSummary, summaryClass)}>
          <span>Combined ownership</span>
          <b>{totalSharePct.toFixed(1)}% — {totalOK ? "fully declared ✓" : (totalSharePct > 100 ? "exceeds 100%" : "below 100%")}</b>
        </div>
      )}

      {shareholders.map((sh, idx) => (
        <div key={sh.id} className={s.shBlock}>
          <div className={s.shHead}>
            <div>
              <span className={s.shHeadNm}>Shareholder {idx + 1}</span>
              {sh.name && <span className={s.shHeadSub}>— {sh.name}</span>}
            </div>
            <button className={cn(s.btn, s.btnSm, s.btnDanger)} onClick={() => removeShareholder(sh.id)}>
              <Trash2 size={12} /> Remove
            </button>
          </div>
          <div className={s.grid3}>
            <div className={s.field}>
              <label className={s.fieldLabel}>Full name <span className={s.req}>*</span></label>
              <div className={s.input}>
                <input value={sh.name} onChange={(e) => updateShareholder(sh.id, { name: e.target.value })} placeholder="Full legal name" />
              </div>
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>Nationality <span className={s.req}>*</span></label>
              <div className={cn(s.input, s.dropdown)}>
                <select value={sh.nationality} onChange={(e) => updateShareholder(sh.id, { nationality: e.target.value })}>
                  <option value="">Search…</option>
                  {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>Ownership % <span className={s.req}>*</span></label>
              <div className={s.input}>
                <input
                  type="number" min={0} max={100} step={0.1}
                  value={sh.ownershipPercent || ""}
                  onChange={(e) => updateShareholder(sh.id, { ownershipPercent: parseFloat(e.target.value) || 0 })}
                  placeholder="51"
                />
                <span className={s.inputSuffix}>%</span>
              </div>
            </div>
          </div>
          <div className={s.groupLabel} style={{ marginTop: 18 }}>Identity Documents</div>
          <div className={cn(s.docsGrid, s.three)}>
            {[
              { id: `${sh.id}_emirates_id`, label: "Emirates ID", required: true },
              { id: `${sh.id}_passport`,    label: "Passport",    required: false },
              { id: `${sh.id}_visa`,        label: "UAE Visa",    required: false },
            ].map((d) => (
              <DocMini key={d.id} docKey={d.id} label={d.label} required={d.required}
                docs={shDocs} uploading={shUploading} errors={shUploadErrors} onUploadClick={onUploadClick}
              />
            ))}
          </div>
        </div>
      ))}

      {shareholders.length > 0 && shareholders.length < 20 && (
        <button type="button" className={cn(s.btn, s.btnGhost, s.btnSm)} onClick={() => changeShareholderCount(shareholderCount + 1)}>
          <Plus size={14} /> Add another shareholder
        </button>
      )}

      <div className={s.secFoot}>
        <button type="button" className={cn(s.btn, s.btnGhost)} onClick={onBack}><ChevronLeft size={14} /> Back</button>
        <button type="button" className={cn(s.btn, s.btnPrimary)} disabled={!done} onClick={onContinue}>
          Save &amp; continue <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// KYC ───────────────────────

function SectionKyc(props: {
  docs: Array<{ key: string; displayName: string; required: boolean; description: string }>;
  checklist: Array<{ key: string; uploaded: boolean; fileUrl: string | null; mimeType: string | null }>;
  shDocs: Record<string, ShDocState>;
  shUploading: string | null;
  shUploadErrors: Record<string, string>;
  onUploadClick: (key: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitError: string | null;
  canSubmit: boolean;
}) {
  const { docs, checklist, shDocs, shUploading, shUploadErrors, onUploadClick, onBack, onSubmit, submitError, canSubmit } = props;

  return (
    <div className={s.secBody}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {docs.map((d) => {
          const serverItem = checklist.find((c) => c.key === d.key);
          const local = shDocs[d.key];
          const uploaded = serverItem?.uploaded || local?.uploaded;
          const url = local?.url ?? serverItem?.fileUrl ?? null;
          const isUploading = shUploading === d.key;
          const err = shUploadErrors[d.key];
          return (
            <div key={d.key} className={cn(s.docRow, uploaded && s.uploaded)}>
              <div className={s.docRowIc}><FileText size={18} /></div>
              <div className={s.docRowMeta}>
                <div className={s.docRowTop}>
                  <span className={s.docRowName}>{d.displayName}</span>
                  {d.required ? (
                    uploaded
                      ? <span className={cn(s.badge, s.badgeDone)}><Check size={9} strokeWidth={3} /> Uploaded</span>
                      : <span className={cn(s.badge, s.badgeReq)}>Required</span>
                  ) : (
                    <span className={cn(s.badge, s.badgeOpt)}>Optional</span>
                  )}
                </div>
                <div className={s.docRowDesc}>{d.description}</div>
                {err && <div className={s.err} style={{ marginTop: 6 }}><AlertCircle size={12} /> {err}</div>}
                {uploaded && url && (
                  <div className={s.docRowFile}>
                    <FileText size={14} />
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>View file</a>
                  </div>
                )}
              </div>
              <div className={s.row} style={{ gap: 6 }}>
                <button type="button" className={cn(s.btn, s.btnSm, uploaded ? s.btnGhost : s.btnPrimary)}
                  onClick={() => onUploadClick(d.key)} disabled={isUploading}>
                  {isUploading ? "…" : uploaded ? "Replace" : <><Upload size={12} /> Upload</>}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {submitError && (
        <div className={cn(s.shSummary, s.warn)} style={{ marginTop: 14 }}>
          <span><AlertCircle size={14} /> {submitError}</span>
        </div>
      )}

      <div className={s.secFoot}>
        <button type="button" className={cn(s.btn, s.btnGhost)} onClick={onBack}><ChevronLeft size={14} /> Back</button>
        <button type="button" className={cn(s.btn, s.btnGreen)} disabled={!canSubmit} onClick={onSubmit}>
          <Send size={14} /> Submit for review
        </button>
      </div>
    </div>
  );
}
