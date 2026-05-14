/**
 * Rental Provider — Onboarding Wizard (rental-provider/dashboard/onboarding)
 *
 * Multi-step wizard for RP profile setup:
 *   Step 1: Account type (individual / company)
 *   Step 2: Business details (company name, trade license, RERA number)
 *   Step 3: KYC documents upload (Emirates ID, passport, trade license, etc.)
 *   Step 4: Review + submit for admin approval
 *
 * On completion, PATCH /profiles/rental-provider then redirects to /portfolio.
 * Uses react-hook-form + Zod. Backend controller/service for onboarding module
 * is SCRUM-204 (🔵 Ready — not yet implemented).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Check,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Phone,
  User,
  Building2,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { KycDocumentsPanel } from "@/components/dashboard/KycDocumentsPanel";
import { DayPicker } from "react-day-picker";
import { format, parse, isValid, subYears } from "date-fns";
import "react-day-picker/style.css";

// ─── step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  {
    id: 0,
    label: "Phone",
    subtitle: "Verify your mobile number",
    icon: Phone,
    description: "We'll send a one-time code to confirm ownership of your number.",
  },
  {
    id: 1,
    label: "Your name",
    subtitle: "How should we address you?",
    icon: User,
    description: "Enter your full name as it appears on your official ID.",
  },
  {
    id: 2,
    label: "Account type",
    subtitle: "Individual or company?",
    icon: Building2,
    description: "Tell us how you operate as a rental provider in the UAE.",
  },
  {
    id: 3,
    label: "Your details",
    subtitle: "Personal & business info",
    icon: UserCheck,
    description: "Your personal information and, if you operate as a company, your trade licence details.",
  },
  {
    id: 4,
    label: "Documents",
    subtitle: "Upload your KYC files",
    icon: ShieldCheck,
    description: "Required for identity verification before you can list properties.",
  },
] as const;

// ─── zod schemas ───────────────────────────────────────────────────────────────

const phoneSchema = z.object({
  phone: z
    .string()
    .min(1, "Phone is required")
    .regex(/^\+?\d{8,16}$/, "Enter a valid phone number (8\u201316 digits)"),
});
type PhoneValues = z.infer<typeof phoneSchema>;

const otpSchema = z.object({
  code: z.string().length(6, "Enter the 6-digit code"),
});
type OtpValues = z.infer<typeof otpSchema>;

const nameSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters").max(150),
});
type NameValues = z.infer<typeof nameSchema>;

const accountSchema = z.object({
  entityType: z.enum(["individual", "company"]),
});
type AccountValues = z.infer<typeof accountSchema>;

const businessSchema = z.object({
  gender: z.enum(["male", "female", "other"], { error: "Select your gender" }),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  nationality: z.string().min(2, "Nationality is required"),
  // company-only — shown/required conditionally in the UI
  companyName: z.string().optional(),
  tradeLicenseNumber: z.string().optional(),
  tradeLicenseAuthority: z.string().optional(),
});
type BusinessValues = z.infer<typeof businessSchema>;

// ─── RP profile type (for progress check) ─────────────────────────────────────

interface RpProfile {
  id: number;
  entityType: string;
  /** NULL until the user explicitly submits step 2. Used to distinguish "default" from "confirmed". */
  accountTypeConfirmedAt: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  companyName: string | null;
  tradeLicenseNumber: string | null;
  tradeLicenseAuthority: string | null;
}

// ─── Sidebar stepper ──────────────────────────────────────────────────────────

function Stepper({
  current,
  completed,
  onStepClick,
}: {
  current: number;
  completed: Set<number>;
  onStepClick: (id: number) => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {STEPS.map((step) => {
        const done = completed.has(step.id);
        const active = step.id === current;
        const Icon = step.icon;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => !done && onStepClick(step.id)}
            disabled={done}
            className="flex items-center gap-4 px-4 py-3 rounded-2xl transition-colors text-left w-full"
            style={{
              background: active
                ? "color-mix(in srgb, var(--color-primary) 8%, white)"
                : "transparent",
              cursor: done ? "default" : "pointer",
              opacity: done ? 0.6 : 1,
            }}
          >
            <div
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all"
              style={{
                background: done
                  ? "var(--color-success, #22c55e)"
                  : active
                    ? "var(--color-primary)"
                    : "var(--color-base-200)",
              }}
            >
              {done ? (
                <Check className="w-5 h-5" style={{ color: "#fff" }} />
              ) : (
                <Icon
                  className="w-5 h-5"
                  style={{ color: active ? "#fff" : "var(--color-neutral-400)" }}
                />
              )}
            </div>
            <div className="min-w-0">
              <p
                className="text-sm font-semibold leading-tight"
                style={{
                  color: active
                    ? "var(--color-primary)"
                    : done
                      ? "var(--color-neutral-700)"
                      : "var(--color-neutral-400)",
                }}
              >
                {step.label}
              </p>
              <p className="text-xs leading-tight mt-0.5 truncate" style={{ color: "var(--color-neutral-400)" }}>
                {step.subtitle}
              </p>
            </div>
          </button>
        );
      })}
    </nav>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
      style={{ background: "color-mix(in srgb, var(--color-error) 8%, white)", color: "var(--color-error)" }}
    >
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      {message}
    </div>
  );
}

// ─── Step 0 \xb7 Phone verification ──────────────────────────────────────────────

function PhoneStep({ onDone }: { onDone: () => void }) {
  const { user, refresh } = useAuth();
  const [phase, setPhase] = useState<"enter" | "verify">("enter");
  const [savedPhone, setSavedPhone] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const phoneForm = useForm<PhoneValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: user?.phone ?? "" },
  });
  const otpForm = useForm<OtpValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { code: "" },
  });

  const savePhone = async (vals: PhoneValues) => {
    setServerError(null);
    try {
      await apiPatch("/auth/me", { phone: vals.phone });
      setSavedPhone(vals.phone);
      await apiPost("/auth/otp/request", {});
      setPhase("verify");
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const verifyOtp = async (vals: OtpValues) => {
    setServerError(null);
    try {
      await apiPost("/auth/otp/verify", { code: vals.code });
      await refresh();
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Invalid code. Please try again.");
    }
  };

  const resend = async () => {
    setServerError(null);
    try {
      await apiPost("/auth/otp/request", {});
    } catch {
      setServerError("Could not resend. Please wait a moment and try again.");
    }
  };

  if (phase === "verify") {
    return (
      <form onSubmit={otpForm.handleSubmit(verifyOtp)} className="space-y-6">
        <div
          className="rounded-2xl px-5 py-4"
          style={{ background: "var(--color-base-100)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-neutral-700)" }}>
            Code sent to{" "}
            <span style={{ color: "var(--color-primary)" }}>{savedPhone}</span>
          </p>
          <button
            type="button"
            onClick={() => setPhase("enter")}
            className="text-xs mt-1 underline underline-offset-2"
            style={{ color: "var(--color-neutral-500)" }}
          >
            Use a different number
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-3" style={{ color: "var(--color-neutral-700)" }}>
            Verification code
          </label>
          <input
            {...otpForm.register("code")}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="w-full rounded-2xl border-2 px-6 py-4 text-center text-3xl font-bold tracking-[1rem] outline-none transition-all"
            style={{
              borderColor: otpForm.formState.errors.code ? "var(--color-error)" : "var(--color-base-200)",
              color: "var(--color-neutral-900)",
            }}
          />
          {otpForm.formState.errors.code && (
            <p className="text-sm mt-2" style={{ color: "var(--color-error)" }}>
              {otpForm.formState.errors.code.message}
            </p>
          )}
        </div>

        {serverError && <ErrorBanner message={serverError} />}

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Button type="submit" disabled={otpForm.formState.isSubmitting} className="w-full sm:w-auto">
            {otpForm.formState.isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>Verify &amp; continue <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
          <button
            type="button"
            onClick={resend}
            className="text-sm font-medium underline underline-offset-2"
            style={{ color: "var(--color-primary)" }}
          >
            Resend code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={phoneForm.handleSubmit(savePhone)} className="space-y-6">
      <Input
        label="Mobile number"
        placeholder="+971 50 123 4567"
        type="tel"
        autoComplete="tel"
        {...phoneForm.register("phone")}
        error={phoneForm.formState.errors.phone?.message}
      />
      {serverError && <ErrorBanner message={serverError} />}
      <Button type="submit" disabled={phoneForm.formState.isSubmitting} className="w-full sm:w-auto">
        {phoneForm.formState.isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>Send verification code <ChevronRight className="w-4 h-4 ml-1" /></>
        )}
      </Button>
    </form>
  );
}

// ─── Step 1 \xb7 Full name ────────────────────────────────────────────────────────

function NameStep({ onDone }: { onDone: () => void }) {
  const { user, refresh } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<NameValues>({
    resolver: zodResolver(nameSchema),
    defaultValues: { fullName: user?.name ?? "" },
  });

  const onSubmit = async (vals: NameValues) => {
    setServerError(null);
    try {
      await apiPatch("/auth/me", { fullName: vals.fullName });
      await refresh();
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Input
        label="Full name"
        placeholder="e.g. Mohammed Al Rashidi"
        autoComplete="name"
        {...register("fullName")}
        error={errors.fullName?.message}
      />
      {serverError && <ErrorBanner message={serverError} />}
      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>Save &amp; continue <ChevronRight className="w-4 h-4 ml-1" /></>
        )}
      </Button>
    </form>
  );
}

// ─── Step 2 \xb7 Account type ────────────────────────────────────────────────────

function AccountTypeStep({ onDone }: { onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const { register, handleSubmit, control, reset, setValue, formState: { errors, isSubmitting } } =
    useForm<AccountValues>({
      resolver: zodResolver(accountSchema),
      defaultValues: { entityType: "individual" },
    });
  const entityType = useWatch({ control, name: "entityType" });

  useEffect(() => {
    apiGet<{ profile: { entityType: string } }>("/profiles/rental-provider/me")
      .then(({ profile }) => {
        reset({
          entityType: (profile.entityType ?? "individual") as "individual" | "company",
        });
      })
      .catch(() => { /* defaults are fine */ })
      .finally(() => setInitialLoaded(true));
  }, [reset]);

  const onSubmit = async (vals: AccountValues) => {
    setServerError(null);
    try {
      await apiPatch("/profiles/rental-provider/me", {
        entityType: vals.entityType,
      });
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  if (!initialLoaded) {
    return (
      <div className="flex items-center gap-3 py-8">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-primary)" }} />
        <span className="text-sm" style={{ color: "var(--color-neutral-500)" }}>Loading&hellip;</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {([
          { value: "individual", title: "Individual", desc: "Private landlord, no company registration" },
          { value: "company",    title: "Company",    desc: "Registered UAE entity with a trade license" },
        ] as const).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setValue("entityType", opt.value)}
            className="rounded-2xl border-2 p-5 text-left transition-all"
            style={{
              borderColor: entityType === opt.value ? "var(--color-primary)" : "var(--color-base-200)",
              background: entityType === opt.value
                ? "color-mix(in srgb, var(--color-primary) 6%, white)"
                : "white",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm font-bold"
                style={{ color: entityType === opt.value ? "var(--color-primary)" : "var(--color-neutral-800)" }}
              >
                {opt.title}
              </span>
              <div
                className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                style={{
                  borderColor: entityType === opt.value ? "var(--color-primary)" : "var(--color-base-200)",
                }}
              >
                {entityType === opt.value && (
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--color-primary)" }} />
                )}
              </div>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--color-neutral-500)" }}>
              {opt.desc}
            </p>
          </button>
        ))}
      </div>
      <input type="hidden" {...register("entityType")} />

      {serverError && <ErrorBanner message={serverError} />}

      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>Save &amp; continue <ChevronRight className="w-4 h-4 ml-1" /></>
        )}
      </Button>
    </form>
  );
}

// ─── Nationality list ─────────────────────────────────────────────────────────

const NATIONALITIES = [
  "Afghan", "Albanian", "Algerian", "American", "Angolan", "Argentinian",
  "Armenian", "Australian", "Austrian", "Azerbaijani",
  "Bahraini", "Bangladeshi", "Belgian", "Bolivian", "Bosnian", "Brazilian",
  "British", "Bulgarian",
  "Cambodian", "Cameroonian", "Canadian", "Chilean", "Chinese", "Colombian",
  "Congolese", "Croatian", "Cuban", "Czech",
  "Danish",
  "Egyptian", "Emirati", "Ethiopian",
  "Filipino", "Finnish", "French",
  "Georgian", "German", "Ghanaian", "Greek", "Guatemalan",
  "Haitian", "Honduran", "Hungarian",
  "Indian", "Indonesian", "Iranian", "Iraqi", "Irish", "Israeli", "Italian",
  "Jamaican", "Japanese", "Jordanian",
  "Kazakh", "Kenyan", "Korean", "Kuwaiti",
  "Lebanese", "Libyan",
  "Malaysian", "Mexican", "Moroccan",
  "Namibian", "Nepali", "New Zealander", "Nigerian", "Norwegian",
  "Omani",
  "Pakistani", "Palestinian", "Paraguayan", "Peruvian", "Polish", "Portuguese",
  "Qatari",
  "Romanian", "Russian",
  "Saudi", "Serbian", "Singaporean", "Slovak", "Somali", "South African",
  "Spanish", "Sri Lankan", "Sudanese", "Swedish", "Swiss", "Syrian",
  "Taiwanese", "Tanzanian", "Thai", "Tunisian", "Turkish",
  "Ugandan", "Ukrainian",
  "Venezuelan", "Vietnamese",
  "Yemeni",
  "Zambian", "Zimbabwean",
].sort();

// ─── UAE Trade Licence Authorities ───────────────────────────────────────────

const TRADE_AUTHORITIES = [
  "ADGM — Abu Dhabi Global Market",
  "ADIO — Abu Dhabi Investment Office",
  "ADPC — Abu Dhabi Ports Company",
  "CBUAE — Central Bank of the UAE",
  "DAEM — Ajman Free Zone",
  "DDA — Dubai Development Authority",
  "DED — Dubai Economy & Tourism (DET)",
  "DED Abu Dhabi — Abu Dhabi DED",
  "DED Ajman — Ajman DED",
  "DED Fujairah — Fujairah DED",
  "DED RAK — Ras Al Khaimah DED",
  "DED Sharjah — Sharjah DED",
  "DED Umm Al Quwain — UAQ DED",
  "DHCC — Dubai Healthcare City",
  "DIFC — Dubai International Financial Centre",
  "DIP — Dubai Industrial Park",
  "DKP — Dubai Knowledge Park",
  "DLFZ — Dubai Logistics City",
  "DMCC — Dubai Multi Commodities Centre",
  "DMC — Dubai Media City",
  "DSO — Dubai Silicon Oasis",
  "DSOA — Dubai South (JAFZA South)",
  "DTC — Dubai Textile City",
  "DWTC — Dubai World Trade Centre",
  "FZCO — JAFZA (Jebel Ali Free Zone)",
  "HFZA — Hamriyah Free Zone Authority",
  "IFZA — International Free Zone Authority",
  "KIZAD — Khalifa Industrial Zone Abu Dhabi",
  "RAKEZ — Ras Al Khaimah Economic Zone",
  "SAIF Zone — Sharjah Airport International Free Zone",
  "SHAMS — Sharjah Media City",
  "Sharjah FZ — Sharjah Free Zone",
  "TWOFOUR54 — Abu Dhabi Media Zone",
  "UAQ FTZ — Umm Al Quwain Free Trade Zone",
];

// ─── Step 3 · Your details ────────────────────────────────────────────────────

function BusinessDetailsStep({ onDone }: { onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [entityType, setEntityType] = useState<"individual" | "company">("individual");
  const [dobOpen, setDobOpen] = useState(false);
  const [dobMonth, setDobMonth] = useState<Date>(subYears(new Date(), 25));
  const [natSearch, setNatSearch] = useState("");
  const [natOpen, setNatOpen] = useState(false);
  const [authSearch, setAuthSearch] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const natRef = useRef<HTMLDivElement>(null);
  const dobRef = useRef<HTMLDivElement>(null);
  const authRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BusinessValues>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      gender: undefined,
      dateOfBirth: "",
      nationality: "",
      companyName: "",
      tradeLicenseNumber: "",
      tradeLicenseAuthority: "",
    },
  });

  const dobValue = watch("dateOfBirth");
  const selectedDate = dobValue && isValid(parse(dobValue, "yyyy-MM-dd", new Date()))
    ? parse(dobValue, "yyyy-MM-dd", new Date())
    : undefined;

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (natRef.current && !natRef.current.contains(e.target as Node)) setNatOpen(false);
      if (dobRef.current && !dobRef.current.contains(e.target as Node)) setDobOpen(false);
      if (authRef.current && !authRef.current.contains(e.target as Node)) setAuthOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    apiGet<{ profile: RpProfile }>("/profiles/rental-provider/me")
      .then(({ profile }) => {
        setEntityType((profile.entityType as "individual" | "company") ?? "individual");
        if (profile.nationality) setNatSearch(profile.nationality);
        if (profile.tradeLicenseAuthority) setAuthSearch(profile.tradeLicenseAuthority);
        if (profile.dateOfBirth) {
          const d = parse(profile.dateOfBirth, "yyyy-MM-dd", new Date());
          if (isValid(d)) setDobMonth(d);
        }
        reset({
          gender: (profile.gender as "male" | "female" | "other" | undefined) ?? undefined,
          dateOfBirth: profile.dateOfBirth ?? "",
          nationality: profile.nationality ?? "",
          companyName: profile.companyName ?? "",
          tradeLicenseNumber: profile.tradeLicenseNumber ?? "",
          tradeLicenseAuthority: profile.tradeLicenseAuthority ?? "",
        });
      })
      .catch(() => {})
      .finally(() => setInitialLoaded(true));
  }, [reset]);

  const onSubmit = async (vals: BusinessValues) => {
    setServerError(null);
    if (entityType === "company") {
      if (!vals.companyName?.trim()) { setServerError("Company name is required"); return; }
      if (!vals.tradeLicenseNumber?.trim()) { setServerError("Trade licence number is required"); return; }
      if (!vals.tradeLicenseAuthority?.trim()) { setServerError("Trade licence authority is required"); return; }
    }
    try {
      await apiPatch("/profiles/rental-provider/me", {
        gender: vals.gender,
        dateOfBirth: vals.dateOfBirth || null,
        nationality: vals.nationality,
        ...(entityType === "company" && {
          companyName: vals.companyName || null,
          tradeLicenseNumber: vals.tradeLicenseNumber || null,
          tradeLicenseAuthority: vals.tradeLicenseAuthority || null,
        }),
      });
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  if (!initialLoaded) {
    return (
      <div className="flex items-center gap-3 py-8">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-primary)" }} />
        <span className="text-sm" style={{ color: "var(--color-neutral-500)" }}>Loading&hellip;</span>
      </div>
    );
  }

  const filteredNats = NATIONALITIES.filter((n) =>
    n.toLowerCase().includes(natSearch.toLowerCase()),
  ).slice(0, 30);

  const filteredAuths = TRADE_AUTHORITIES.filter((a) =>
    a.toLowerCase().includes(authSearch.toLowerCase()),
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

      {/* ── Gender ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-[var(--color-neutral-700)]">
          Gender <span className="text-[var(--color-error)]">*</span>
        </label>
        <Controller
          control={control}
          name="gender"
          render={({ field }) => (
            <div
              className="inline-flex rounded-xl p-1 gap-1"
              style={{ background: "var(--color-base-100)", border: "1px solid var(--color-base-200)" }}
            >
              {(["male", "female", "other"] as const).map((opt) => {
                const sel = field.value === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => field.onChange(opt)}
                    className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all capitalize"
                    style={{
                      background: sel ? "white" : "transparent",
                      color: sel ? "var(--color-primary)" : "var(--color-neutral-500)",
                      boxShadow: sel ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          )}
        />
        {errors.gender && (
          <p className="text-xs text-[var(--color-error)]">{errors.gender.message}</p>
        )}
      </div>

      {/* ── Date of birth ──────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-[var(--color-neutral-700)]">
          Date of birth <span className="text-[var(--color-error)]">*</span>
        </label>
        <div className="relative" ref={dobRef}>
          <button
            type="button"
            onClick={() => setDobOpen((o) => !o)}
            className="w-full flex items-center justify-between rounded-xl border bg-white px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            style={{
              borderColor: errors.dateOfBirth
                ? "var(--color-error)"
                : dobOpen
                ? "var(--color-primary)"
                : "var(--color-base-200)",
              color: selectedDate ? "var(--color-neutral-900)" : "var(--color-neutral-400)",
            }}
          >
            <span>{selectedDate ? format(selectedDate, "d MMMM yyyy") : "Select your date of birth"}</span>
            <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-neutral-400)" }} />
          </button>

          {dobOpen && (
            <div
              className="absolute z-30 mt-2 rounded-2xl border bg-white shadow-xl overflow-hidden"
              style={{ borderColor: "var(--color-base-200)", padding: "12px" }}
            >
              <DayPicker
                mode="single"
                selected={selectedDate}
                month={dobMonth}
                onMonthChange={setDobMonth}
                captionLayout="dropdown"
                startMonth={new Date(1920, 0)}
                endMonth={subYears(new Date(), 18)}
                onSelect={(date) => {
                  if (date) {
                    setValue("dateOfBirth", format(date, "yyyy-MM-dd"), { shouldValidate: true });
                    setDobOpen(false);
                  }
                }}
              />
            </div>
          )}
        </div>
        <input type="hidden" {...register("dateOfBirth")} />
        {errors.dateOfBirth && (
          <p className="text-xs text-[var(--color-error)]">{errors.dateOfBirth.message}</p>
        )}
      </div>

      {/* ── Nationality ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-[var(--color-neutral-700)]">
          Nationality <span className="text-[var(--color-error)]">*</span>
        </label>
        <Controller
          control={control}
          name="nationality"
          render={({ field }) => (
            <div className="relative" ref={natRef}>
              <div className="relative">
                <input
                  type="text"
                  value={natSearch}
                  onFocus={() => setNatOpen(true)}
                  onChange={(e) => {
                    setNatSearch(e.target.value);
                    setNatOpen(true);
                    if (!e.target.value) field.onChange("");
                  }}
                  placeholder="Search nationality…"
                  autoComplete="off"
                  className="w-full rounded-xl border bg-white px-4 py-2.5 pr-10 text-sm text-[var(--color-neutral-900)] placeholder:text-[var(--color-neutral-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
                  style={{
                    borderColor: errors.nationality
                      ? "var(--color-error)"
                      : natOpen
                      ? "var(--color-primary)"
                      : "var(--color-base-200)",
                  }}
                />
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4"
                  style={{ color: "var(--color-neutral-400)" }}
                />
              </div>
              {natOpen && filteredNats.length > 0 && (
                <ul
                  className="absolute z-20 mt-1.5 w-full max-h-56 overflow-y-auto rounded-2xl border bg-white shadow-xl py-1"
                  style={{ borderColor: "var(--color-base-200)" }}
                >
                  {filteredNats.map((nat) => (
                    <li key={nat}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          field.onChange(nat);
                          setNatSearch(nat);
                          setNatOpen(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm transition-colors"
                        style={{
                          color: field.value === nat ? "var(--color-primary)" : "var(--color-neutral-800)",
                          background: field.value === nat
                            ? "color-mix(in srgb, var(--color-primary) 6%, white)"
                            : "white",
                          fontWeight: field.value === nat ? 500 : 400,
                        }}
                      >
                        {nat}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        />
        {errors.nationality && (
          <p className="text-xs text-[var(--color-error)]">{errors.nationality.message}</p>
        )}
      </div>

      {/* ── Company details ────────────────────────────────────── */}
      {entityType === "company" && (
        <>
          <hr style={{ borderColor: "var(--color-base-200)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--color-neutral-700)" }}>
            Company information
          </p>
          <Input
            label="Company name *"
            placeholder="Registered business name"
            autoComplete="organization"
            {...register("companyName")}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Trade licence number *"
              placeholder="e.g. 1234567"
              {...register("tradeLicenseNumber")}
            />
            <Controller
              control={control}
              name="tradeLicenseAuthority"
              render={({ field }) => (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-[var(--color-neutral-700)]">
                    Trade licence authority *
                  </label>
                  <div className="relative" ref={authRef}>
                    <div className="relative">
                      <input
                        type="text"
                        value={authSearch}
                        onFocus={() => setAuthOpen(true)}
                        onChange={(e) => {
                          setAuthSearch(e.target.value);
                          setAuthOpen(true);
                          if (!e.target.value) field.onChange("");
                        }}
                        placeholder="Search authority…"
                        autoComplete="off"
                        className="w-full rounded-xl border bg-white px-4 py-2.5 pr-10 text-sm text-[var(--color-neutral-900)] placeholder:text-[var(--color-neutral-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
                        style={{
                          borderColor: authOpen
                            ? "var(--color-primary)"
                            : "var(--color-base-200)",
                        }}
                      />
                      <ChevronDown
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4"
                        style={{ color: "var(--color-neutral-400)" }}
                      />
                    </div>
                    {authOpen && filteredAuths.length > 0 && (
                      <ul
                        className="absolute z-20 mt-1.5 w-full max-h-56 overflow-y-auto rounded-2xl border bg-white shadow-xl py-1"
                        style={{ borderColor: "var(--color-base-200)" }}
                      >
                        {filteredAuths.map((auth) => (
                          <li key={auth}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                field.onChange(auth);
                                setAuthSearch(auth);
                                setAuthOpen(false);
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm transition-colors"
                              style={{
                                color: field.value === auth ? "var(--color-primary)" : "var(--color-neutral-800)",
                                background: field.value === auth
                                  ? "color-mix(in srgb, var(--color-primary) 6%, white)"
                                  : "white",
                                fontWeight: field.value === auth ? 500 : 400,
                              }}
                            >
                              {auth}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            />
          </div>
        </>
      )}

      {serverError && <ErrorBanner message={serverError} />}

      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>Save &amp; continue <ChevronRight className="w-4 h-4 ml-1" /></>
        )}
      </Button>
    </form>
  );
}

// ─── Step 4 · Documents ────────────────────────────────────────────────────────

function DocumentsStep({ onDone }: { onDone: () => void }) {
  return (
    <KycDocumentsPanel
      profileApiPath="/profiles/rental-provider/me"
      ownerType="rental_provider"
      onAllRequiredUploaded={onDone}
      continueLabel="Go to my dashboard"
    />
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function RentalProviderOnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [initializing, setInitializing] = useState(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      const done = new Set<number>();

      // Step 0 — phone verified in DB
      if (user.phoneVerified) done.add(0);

      // Step 1 — name explicitly set (not the auto-generated email local-part)
      const emailLocalPart = user.email?.split("@")[0] ?? "";
      if (user.name && user.name !== emailLocalPart && user.name.trim().length > 2) done.add(1);

      // Step 2 — user explicitly confirmed their account type (individual or company)
      // entityType alone is unreliable: the DB row is created at registration with
      // entityType='individual' (the default), so it's never null for new accounts.
      try {
        const data = await apiGet<{ profile: RpProfile }>("/profiles/rental-provider/me");
        if (data.profile?.accountTypeConfirmedAt) done.add(2);
        // Step 3 — personal details filled (gender + nationality are the minimum)
        if (data.profile?.gender && data.profile?.nationality) done.add(3);
      } catch {
        // profile not created yet — steps 2 & 3 stay incomplete
      }

      setCompleted(done);
      // Open at the first step that still needs attention
      const firstIncomplete = STEPS.find((s) => !done.has(s.id));
      if (!firstIncomplete) {
        // All done — go straight to the dashboard
        router.replace("/dashboard/rental-provider");
        return;
      }
      setStep(firstIncomplete.id);
      setInitializing(false);
    })();
  }, [user]);

  const advance = (fromStep: number) => {
    const newCompleted = new Set([...completed, fromStep]);
    setCompleted(newCompleted);
    // Jump to the next step that hasn't been completed yet
    const next = STEPS.find((s) => s.id > fromStep && !newCompleted.has(s.id));
    if (next) {
      setStep(next.id);
    } else {
      router.replace("/dashboard/rental-provider");
    }
  };

  const currentStep = STEPS[step];

  return (
    <div className="min-h-screen" style={{ background: "var(--color-base-100, #f9f8f6)" }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">

        {/* Page header */}
        {initializing ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--color-primary)" }} />
          </div>
        ) : null}
        <div className={initializing ? "hidden" : ""}
        >
        <div className="mb-8">
          <h1 className="text-3xl font-bold" style={{ color: "var(--color-neutral-900)" }}>
            Complete your profile
          </h1>
          <p className="mt-1.5 text-base" style={{ color: "var(--color-neutral-500)" }}>
            {completed.size} of {STEPS.length} steps complete &mdash; finish setup to start listing properties.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* Sidebar */}
          <aside
            className="w-full lg:w-64 flex-shrink-0 rounded-3xl p-5"
            style={{ background: "#fff", border: "1px solid var(--color-base-200)" }}
          >
            <Stepper current={step} completed={completed} onStepClick={setStep} />

            <div className="mt-6 px-4">
              <div
                className="flex justify-between text-xs mb-1.5"
                style={{ color: "var(--color-neutral-400)" }}
              >
                <span>Progress</span>
                <span>{Math.round((completed.size / STEPS.length) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-base-200)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round((completed.size / STEPS.length) * 100)}%`,
                    background: "var(--color-primary)",
                  }}
                />
              </div>
            </div>
          </aside>

          {/* Content card */}
          <main
            className="flex-1 w-full rounded-3xl p-8"
            style={{ background: "#fff", border: "1px solid var(--color-base-200)" }}
          >
            {/* Step header */}
            <div className="mb-8 pb-6" style={{ borderBottom: "1px solid var(--color-base-200)" }}>
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 10%, white)" }}
                >
                  <currentStep.icon className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
                </div>
                <h2 className="text-xl font-bold" style={{ color: "var(--color-neutral-900)" }}>
                  {currentStep.subtitle}
                </h2>
              </div>
              <p className="text-sm leading-relaxed pl-[52px]" style={{ color: "var(--color-neutral-500)" }}>
                {currentStep.description}
              </p>
            </div>

            {/* Form */}
            <div className="max-w-lg">
              {step === 0 && <PhoneStep onDone={() => advance(0)} />}
              {step === 1 && <NameStep onDone={() => advance(1)} />}
              {step === 2 && <AccountTypeStep onDone={() => advance(2)} />}
              {step === 3 && <BusinessDetailsStep onDone={() => advance(3)} />}
              {step === 4 && <DocumentsStep onDone={() => advance(4)} />}
            </div>

            {/* Skip — not available on the final Documents step */}
            {step < 4 && (
              <div className="mt-8 pt-6" style={{ borderTop: "1px solid var(--color-base-200)" }}>
                <button
                  type="button"
                  onClick={() => { const next = STEPS.find((s) => s.id > step && !completed.has(s.id)); if (next) setStep(next.id); else router.replace("/dashboard/rental-provider"); }}
                  className="text-sm underline underline-offset-2"
                  style={{ color: "var(--color-neutral-400)" }}
                >
                  Skip this step \u2014 I&apos;ll complete it later
                </button>
              </div>
            )}
          </main>

        </div>
        </div>{/* end initializing wrapper */}
      </div>
    </div>
  );
}
