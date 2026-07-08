/**
 * Service Provider — Onboarding Wizard (dashboard/service-provider/onboarding)
 *
 * Multi-step wizard for SP profile setup:
 *   Step 1: Business info (company name, entity type, trade license)
 *   Step 2: Service categories + coverage areas
 *   Step 3: Team size + operational capacity
 *   Step 4: KYC documents upload (presigned URL flow)
 *   Step 5: Review + submit
 *
 * On completion, PATCH /profiles/service-provider with the collected data.
 * Uses react-hook-form + Zod per schema in _schema.ts next to this file.
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
  Building2,
  Layers,
  MapPin,
  UserCheck,
  Users,
  ShieldCheck,
  Clock,
  Info,
  PhoneCall,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Schibsted_Grotesk } from "next/font/google";
import { SpJobReady } from "@/components/upnow/SpJobReady";

// One journey, one place: after the 7 registration steps the SAME page flows
// into the "Get job-ready" phase (design part B) — no second URL.
const grotesk = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { KycDocumentsPanel } from "@/components/dashboard/KycDocumentsPanel";
import { DayPicker } from "react-day-picker";
import { format, parse, isValid, subYears } from "date-fns";
import "react-day-picker/style.css";

// ─── Step definitions ─────────────────────────────────────────────────────────

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
    label: "Business basics",
    subtitle: "Tell us about your business",
    icon: Building2,
    description: "Your trading name, legal entity type, and the name of the owner or authorised signatory.",
  },
  {
    id: 2,
    label: "Service categories",
    subtitle: "What do you offer?",
    icon: Layers,
    description: "Select all the service categories your business operates in. You must pick at least one.",
  },
  {
    id: 3,
    label: "Service area",
    subtitle: "Where do you operate?",
    icon: MapPin,
    description: "Select the emirates you serve. Customers use this to find providers near them.",
  },
  {
    id: 4,
    label: "Your strength",
    subtitle: "Capacity & contact",
    icon: Users,
    description: "Help us size the work we send you — team, vehicles, and who answers customer queries. You'll fine-tune this after approval.",
  },
  {
    id: 5,
    label: "Owner details",
    subtitle: "Personal information",
    icon: UserCheck,
    description: "Your Emirates ID, nationality, and date of birth. This helps us verify your identity for KYC.",
  },
  {
    id: 6,
    label: "Documents",
    subtitle: "Upload your KYC files",
    icon: ShieldCheck,
    description: "Required for identity verification before you can receive service bookings.",
  },
] as const;

// ─── Zod schemas ──────────────────────────────────────────────────────────────

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

const businessSchema = z.object({
  entityType: z.enum(["individual", "company"]),
  businessName: z.string().min(2, "Business name must be at least 2 characters").max(150),
  ownerName: z.string().min(2, "Owner name must be at least 2 characters").max(150),
});
type BusinessValues = z.infer<typeof businessSchema>;

const categoriesSchema = z.object({
  serviceCategories: z
    .array(z.string())
    .min(1, "Select at least one service category"),
});
type CategoriesValues = z.infer<typeof categoriesSchema>;

const areaSchema = z.object({
  emiratesServed: z
    .array(z.string())
    .min(1, "Select at least one emirate"),
});
type AreaValues = z.infer<typeof areaSchema>;

const ownerDetailsSchema = z.object({
  emiratesIdNumber: z.string().optional(),
  nationality: z.string().optional(),
  dateOfBirth: z.string().optional(),
});
type OwnerDetailsValues = z.infer<typeof ownerDetailsSchema>;

// ─── SP profile type ──────────────────────────────────────────────────────────

interface SpProfile {
  id: number;
  entityType: string;
  accountTypeConfirmedAt: string | null;
  businessName: string | null;
  ownerName: string | null;
  serviceCategories: string[];
  emiratesServed: string[];
  gender: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  emiratesIdNumber: string | null;
  teamSizeBand?: string | null;
  fleetSizeBand?: string | null;
  opsContactName?: string | null;
  opsContactPhone?: string | null;
  opsContactWhatsapp?: boolean;
  opsContactLanguages?: string[] | null;
}

// ─── Service category options ─────────────────────────────────────────────────

// The 10-category Catalog v2 marketplace taxonomy (migr 0107; mirrors the PG
// service_category enum + the seeded service_categories rows). Every category
// is an on-site/manual trade — which UAE freelance permits do NOT cover, so
// the whole list is company-only (see the eligibility gate in the step).
const SERVICE_CATEGORIES: { value: string; label: string }[] = [
  { value: "home_cleaning",       label: "Home Cleaning" },
  { value: "ac_services",         label: "AC Services" },
  { value: "plumbing",            label: "Plumbing" },
  { value: "electrical",          label: "Electrical" },
  { value: "handyman",            label: "Handyman" },
  { value: "painting",            label: "Painting" },
  { value: "pest_control",        label: "Pest Control" },
  { value: "car_vehicle",         label: "Car & Vehicle" },
  { value: "landscaping_outdoor", label: "Landscaping & Outdoor" },
  { value: "commercial_services", label: "Commercial Services" },
];

// ─── UAE Emirates ─────────────────────────────────────────────────────────────

const EMIRATES: { value: string; label: string }[] = [
  { value: "dubai",          label: "Dubai" },
  { value: "abu_dhabi",      label: "Abu Dhabi" },
  { value: "sharjah",        label: "Sharjah" },
  { value: "ajman",          label: "Ajman" },
  { value: "ras_al_khaimah", label: "Ras Al Khaimah" },
  { value: "fujairah",       label: "Fujairah" },
  { value: "umm_al_quwain",  label: "Umm Al Quwain" },
];

// ─── Nationalities ────────────────────────────────────────────────────────────

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

// ─── Shared UI components ─────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
      style={{
        background: "color-mix(in srgb, var(--color-error) 8%, white)",
        color: "var(--color-error)",
      }}
    >
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      {message}
    </div>
  );
}

function Stepper({
  current,
  completed,
  onStepClick,
  jobReady,
}: {
  current: number;
  completed: Set<number>;
  onStepClick: (id: number) => void;
  jobReady?: { active: boolean; unlocked: boolean; done: number; onClick: () => void };
}) {
  // A step is reachable if it is completed (can re-edit) or is the current step
  // or comes right after the last completed step. Future-incomplete steps are locked.
  const maxReachable = Math.max(current, ...[...completed]);

  return (
    <nav className="flex flex-col gap-1">
      {STEPS.map((step) => {
        const done = completed.has(step.id);
        const active = step.id === current;
        const reachable = step.id <= maxReachable;
        const Icon = step.icon;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => reachable && onStepClick(step.id)}
            disabled={!reachable}
            className="flex items-center gap-4 px-4 py-3 rounded-2xl transition-colors text-left w-full"
            style={{
              background: active
                ? "color-mix(in srgb, var(--color-primary) 8%, white)"
                : "transparent",
              cursor: reachable ? "pointer" : "default",
              opacity: reachable ? 1 : 0.45,
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
              <p
                className="text-xs leading-tight mt-0.5 truncate"
                style={{ color: "var(--color-neutral-400)" }}
              >
                {step.subtitle}
              </p>
            </div>
          </button>
        );
      })}

      {/* Terminal stage — not a form step. Rendering the compliance review as a
          visible pipeline stage (Careem pattern) so approval is never a surprise
          black hole after submit. */}
      <div
        className="flex items-center gap-4 px-4 py-3 rounded-2xl mt-1"
        style={{
          borderTop: "1px dashed var(--color-base-200)",
          opacity: 0.9,
        }}
      >
        <div
          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
          style={{
            background: "color-mix(in srgb, var(--color-primary) 10%, white)",
          }}
        >
          <Clock className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
        </div>
        <div className="min-w-0">
          <p
            className="text-sm font-semibold leading-tight"
            style={{ color: "var(--color-neutral-700)" }}
          >
            Review by UpNow
          </p>
          <p
            className="text-xs leading-tight mt-0.5"
            style={{ color: "var(--color-neutral-400)" }}
          >
            Verified within 48 hours
          </p>
        </div>
      </div>
    
      {/* Full-journey stage: the operational profile lives on this SAME page. */}
      {jobReady && (
        <button
          type="button"
          disabled={!jobReady.unlocked}
          onClick={() => jobReady.unlocked && jobReady.onClick()}
          className="flex items-center gap-4 px-4 py-3 rounded-2xl transition-colors text-left w-full"
          style={{
            background: jobReady.active
              ? "color-mix(in srgb, var(--color-primary) 8%, white)"
              : "transparent",
            cursor: jobReady.unlocked ? "pointer" : "default",
            opacity: jobReady.unlocked ? 1 : 0.45,
          }}
        >
          <div
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{
              background: jobReady.done === 5
                ? "var(--color-success, #22c55e)"
                : jobReady.active
                  ? "var(--color-primary)"
                  : "var(--color-base-200)",
            }}
          >
            <Check className="w-5 h-5" style={{ color: jobReady.active || jobReady.done === 5 ? "#fff" : "var(--color-neutral-400)" }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight" style={{ color: jobReady.active ? "var(--color-primary)" : "var(--color-neutral-700)" }}>
              Get job-ready{jobReady.done > 0 && ` · ${jobReady.done}/5`}
            </p>
            <p className="text-xs leading-tight mt-0.5 truncate" style={{ color: "var(--color-neutral-400)" }}>
              Coverage · team · vehicles · hours · rules
            </p>
          </div>
        </button>
      )}
      </nav>
  );
}

// ─── Step 0 · Phone verification ──────────────────────────────────────────────

function PhoneStep({ onDone }: { onDone: () => void }) {
  const { user, refresh } = useAuth();
  const [phase, setPhase] = useState<"enter" | "verify">("enter");
  const [savedPhone, setSavedPhone] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

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
      const otpRes = await apiPost<{ sent: boolean; devOtp?: string }>("/auth/otp/request", {});
      if (otpRes.devOtp) setDevOtp(otpRes.devOtp);
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
      setServerError(
        e instanceof Error ? e.message : "Invalid code. Please try again.",
      );
    }
  };

  const resend = async () => {
    setServerError(null);
    try {
      const otpRes = await apiPost<{ sent: boolean; devOtp?: string }>("/auth/otp/request", {});
      if (otpRes.devOtp) setDevOtp(otpRes.devOtp);
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
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-neutral-700)" }}
          >
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

        {/* OTP shown in all environments until SMS/email delivery is fully wired. */}
        {devOtp && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 mb-0.5">Your OTP code</p>
            <p className="text-2xl font-mono font-bold tracking-[0.3em] text-amber-900">{devOtp}</p>
          </div>
        )}

        <div>
          <label
            className="block text-sm font-medium mb-3"
            style={{ color: "var(--color-neutral-700)" }}
          >
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
              borderColor: otpForm.formState.errors.code
                ? "var(--color-error)"
                : "var(--color-base-200)",
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
          <Button
            type="submit"
            disabled={otpForm.formState.isSubmitting}
            className="w-full sm:w-auto"
          >
            {otpForm.formState.isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Verify &amp; continue{" "}
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
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
      <Button
        type="submit"
        disabled={phoneForm.formState.isSubmitting}
        className="w-full sm:w-auto"
      >
        {phoneForm.formState.isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            Send verification code <ChevronRight className="w-4 h-4 ml-1" />
          </>
        )}
      </Button>
    </form>
  );
}

// ─── Step 1 · Business basics ─────────────────────────────────────────────────

function BusinessBasicsStep({ onDone }: { onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BusinessValues>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      entityType: "company",
      businessName: "",
      ownerName: "",
    },
  });

  const entityTypeValue = useWatch({ control, name: "entityType" });

  useEffect(() => {
    apiGet<{ profile: SpProfile }>("/profiles/service-provider/me")
      .then(({ profile }) => {
        reset({
          entityType: (profile.entityType as "individual" | "company") ?? "company",
          businessName: profile.businessName ?? "",
          ownerName: profile.ownerName ?? "",
        });
      })
      .catch(() => {})
      .finally(() => setInitialLoaded(true));
  }, [reset]);

  const onSubmit = async (vals: BusinessValues) => {
    setServerError(null);
    try {
      await apiPatch("/profiles/service-provider/me", {
        entityType: vals.entityType,
        businessName: vals.businessName,
        ownerName: vals.ownerName,
      });
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  if (!initialLoaded) {
    return (
      <div className="flex items-center gap-3 py-8">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-primary)" }}
        />
        <span
          className="text-sm"
          style={{ color: "var(--color-neutral-500)" }}
        >
          Loading&hellip;
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Entity type picker */}
      <div className="flex flex-col gap-2">
        <label
          className="text-sm font-medium"
          style={{ color: "var(--color-neutral-700)" }}
        >
          Entity type <span style={{ color: "var(--color-error)" }}>*</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(
            [
              {
                value: "company",
                title: "Company",
                desc: "Registered UAE entity with a trade licence — full access to every service category. Includes sole-establishment professional licences.",
              },
              {
                value: "individual",
                title: "Solo trader / Freelancer",
                desc: "Freelance permit or eTrader licence holder, operating in your own name.",
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setValue("entityType", opt.value)}
              className="rounded-2xl border-2 p-5 text-left transition-all"
              style={{
                borderColor:
                  entityTypeValue === opt.value
                    ? "var(--color-primary)"
                    : "var(--color-base-200)",
                background:
                  entityTypeValue === opt.value
                    ? "color-mix(in srgb, var(--color-primary) 6%, white)"
                    : "white",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-sm font-bold"
                  style={{
                    color:
                      entityTypeValue === opt.value
                        ? "var(--color-primary)"
                        : "var(--color-neutral-800)",
                  }}
                >
                  {opt.title}
                </span>
                <div
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                  style={{
                    borderColor:
                      entityTypeValue === opt.value
                        ? "var(--color-primary)"
                        : "var(--color-base-200)",
                  }}
                >
                  {entityTypeValue === opt.value && (
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: "var(--color-primary)" }}
                    />
                  )}
                </div>
              </div>
              <p
                className="text-xs leading-relaxed"
                style={{ color: "var(--color-neutral-500)" }}
              >
                {opt.desc}
              </p>
            </button>
          ))}
        </div>
        <input type="hidden" {...register("entityType")} />
        {errors.entityType && (
          <p className="text-xs" style={{ color: "var(--color-error)" }}>
            {errors.entityType.message}
          </p>
        )}

        {/* Consequence panel — the fork is a legal split, not a label. UAE law
            reserves manual home services for licensed companies (FDL 9/2022;
            freelance permits cover professional/digital work only), so the
            individual path signposts instead of failing at review time. */}
        {entityTypeValue === "individual" ? (
          <div
            className="flex gap-3 rounded-2xl px-4 py-3.5 mt-1"
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
            }}
          >
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#92400e" }} />
            <div className="text-xs leading-relaxed" style={{ color: "#92400e" }}>
              <p className="font-semibold mb-1">What a freelance permit covers</p>
              <p>
                UAE freelance permits and eTrader licences cover professional and
                digital services only. <b>Hands-on home services</b> (cleaning, AC,
                plumbing, electrical, handyman, pest control) <b>legally require a
                licensed company</b>. If you hold a sole-establishment professional
                licence (e.g. Technical Services), select <b>Company</b> — that licence
                qualifies. Otherwise you can join a licensed company as a technician,
                or our team can guide you on getting licensed.
              </p>
            </div>
          </div>
        ) : (
          <div
            className="flex gap-3 rounded-2xl px-4 py-3.5 mt-1"
            style={{
              background: "color-mix(in srgb, var(--color-primary) 5%, white)",
              border: "1px solid color-mix(in srgb, var(--color-primary) 15%, white)",
            }}
          >
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "var(--color-primary)" }} />
            <p className="text-xs leading-relaxed" style={{ color: "var(--color-neutral-600)" }}>
              You&apos;ll upload your trade licence in the Documents step. Your licence
              activities must cover the service categories you select — we check this
              during review.
            </p>
          </div>
        )}
      </div>

      <Input
        label="Business / trading name *"
        placeholder="e.g. Al Noor Technical Services"
        autoComplete="organization"
        {...register("businessName")}
        error={errors.businessName?.message}
      />

      <Input
        label="Owner / authorised signatory name *"
        placeholder="Full legal name"
        autoComplete="name"
        {...register("ownerName")}
        error={errors.ownerName?.message}
      />

      {serverError && <ErrorBanner message={serverError} />}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            Save &amp; continue <ChevronRight className="w-4 h-4 ml-1" />
          </>
        )}
      </Button>
    </form>
  );
}

// ─── Step 2 · Service categories ──────────────────────────────────────────────

function ServiceCategoriesStep({ onDone }: { onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [entityType, setEntityType] = useState<string>("company");
  // Live taxonomy from the admin-configured catalog (active categories only);
  // the hardcoded list is only the fallback if the public endpoint is down.
  const [categoryOptions, setCategoryOptions] =
    useState<{ value: string; label: string }[]>(SERVICE_CATEGORIES);

  const {
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CategoriesValues>({
    resolver: zodResolver(categoriesSchema),
    defaultValues: { serviceCategories: [] },
  });

  useEffect(() => {
    apiGet<{ profile: SpProfile }>("/profiles/service-provider/me")
      .then(({ profile }) => {
        reset({ serviceCategories: profile.serviceCategories ?? [] });
        setEntityType(profile.entityType ?? "company");
      })
      .catch(() => {})
      .finally(() => setInitialLoaded(true));

    fetch("/api/catalog/public")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { categories?: { code: string; name: string }[] }) => {
        if (d.categories?.length) {
          setCategoryOptions(d.categories.map((c) => ({ value: c.code, label: c.name })));
        }
      })
      .catch(() => {}); // keep the static fallback
  }, [reset]);

  // Eligibility matrix (SP_ONBOARDING_V2_DESIGN §3): every catalog category is
  // an on-site/manual trade, which UAE freelance permits and eTrader licences
  // do not cover — so solo traders cannot select any of them. Signpost, don't
  // silently fail at review time.
  const isIndividual = entityType === "individual";

  const onSubmit = async (vals: CategoriesValues) => {
    setServerError(null);
    try {
      await apiPatch("/profiles/service-provider/me", {
        serviceCategories: vals.serviceCategories,
      });
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  if (!initialLoaded) {
    return (
      <div className="flex items-center gap-3 py-8">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-primary)" }}
        />
        <span className="text-sm" style={{ color: "var(--color-neutral-500)" }}>
          Loading&hellip;
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {isIndividual && (
        <div
          className="flex gap-3 rounded-2xl px-4 py-3.5"
          style={{ background: "#fffbeb", border: "1px solid #fde68a" }}
        >
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#92400e" }} />
          <div className="text-xs leading-relaxed" style={{ color: "#92400e" }}>
            <p className="font-semibold mb-1">
              These categories require a licensed company
            </p>
            <p>
              All current UpNow service categories are hands-on, on-site trades —
              UAE freelance permits and eTrader licences don&apos;t cover them. If you
              hold a trade licence or a sole-establishment professional licence, go
              back to the previous step and select <b>Company</b>. Otherwise you can
              join a licensed company as a technician, or contact us for guidance
              on getting licensed.
            </p>
          </div>
        </div>
      )}
      <Controller
        control={control}
        name="serviceCategories"
        render={({ field }) => (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {categoryOptions.map((cat) => {
              const selected = field.value.includes(cat.value);
              return (
                <button
                  key={cat.value}
                  type="button"
                  disabled={isIndividual}
                  onClick={() => {
                    if (isIndividual) return;
                    const next = selected
                      ? field.value.filter((v) => v !== cat.value)
                      : [...field.value, cat.value];
                    field.onChange(next);
                  }}
                  className="flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all"
                  style={{
                    borderColor: selected
                      ? "var(--color-primary)"
                      : "var(--color-base-200)",
                    background: selected
                      ? "color-mix(in srgb, var(--color-primary) 6%, white)"
                      : "white",
                    opacity: isIndividual ? 0.45 : 1,
                    cursor: isIndividual ? "not-allowed" : "pointer",
                  }}
                >
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-all"
                    style={{
                      borderColor: selected
                        ? "var(--color-primary)"
                        : "var(--color-base-200)",
                      background: selected ? "var(--color-primary)" : "white",
                    }}
                  >
                    {selected && <Check className="w-3 h-3" style={{ color: "#fff" }} />}
                  </div>
                  <span
                    className="text-sm font-medium"
                    style={{
                      color: selected
                        ? "var(--color-primary)"
                        : "var(--color-neutral-800)",
                    }}
                  >
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      />
      {errors.serviceCategories && (
        <p className="text-xs" style={{ color: "var(--color-error)" }}>
          {errors.serviceCategories.message}
        </p>
      )}

      {serverError && <ErrorBanner message={serverError} />}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            Save &amp; continue <ChevronRight className="w-4 h-4 ml-1" />
          </>
        )}
      </Button>
    </form>
  );
}

// ─── Step 3 · Service area ────────────────────────────────────────────────────

function ServiceAreaStep({ onDone }: { onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const {
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AreaValues>({
    resolver: zodResolver(areaSchema),
    defaultValues: { emiratesServed: [] },
  });

  useEffect(() => {
    apiGet<{ profile: SpProfile }>("/profiles/service-provider/me")
      .then(({ profile }) => {
        reset({ emiratesServed: profile.emiratesServed ?? [] });
      })
      .catch(() => {})
      .finally(() => setInitialLoaded(true));
  }, [reset]);

  const onSubmit = async (vals: AreaValues) => {
    setServerError(null);
    try {
      await apiPatch("/profiles/service-provider/me", {
        emiratesServed: vals.emiratesServed,
      });
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  if (!initialLoaded) {
    return (
      <div className="flex items-center gap-3 py-8">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-primary)" }}
        />
        <span className="text-sm" style={{ color: "var(--color-neutral-500)" }}>
          Loading&hellip;
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Controller
        control={control}
        name="emiratesServed"
        render={({ field }) => (
          <div className="flex flex-col gap-3">
            {EMIRATES.map((em) => {
              const selected = field.value.includes(em.value);
              return (
                <button
                  key={em.value}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? field.value.filter((v) => v !== em.value)
                      : [...field.value, em.value];
                    field.onChange(next);
                  }}
                  className="flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-all"
                  style={{
                    borderColor: selected
                      ? "var(--color-primary)"
                      : "var(--color-base-200)",
                    background: selected
                      ? "color-mix(in srgb, var(--color-primary) 6%, white)"
                      : "white",
                  }}
                >
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-all"
                    style={{
                      borderColor: selected
                        ? "var(--color-primary)"
                        : "var(--color-base-200)",
                      background: selected ? "var(--color-primary)" : "white",
                    }}
                  >
                    {selected && (
                      <Check className="w-3 h-3" style={{ color: "#fff" }} />
                    )}
                  </div>
                  <span
                    className="text-sm font-semibold"
                    style={{
                      color: selected
                        ? "var(--color-primary)"
                        : "var(--color-neutral-800)",
                    }}
                  >
                    {em.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      />
      {errors.emiratesServed && (
        <p className="text-xs" style={{ color: "var(--color-error)" }}>
          {errors.emiratesServed.message}
        </p>
      )}

      {serverError && <ErrorBanner message={serverError} />}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            Save &amp; continue <ChevronRight className="w-4 h-4 ml-1" />
          </>
        )}
      </Button>
    </form>
  );
}

// ─── Step 4 · Your strength (capacity signals + customer-queries contact) ────

const TEAM_BANDS = ["1-2", "3-5", "6-15", "16-50", "50+"];
const FLEET_BANDS = ["0", "1", "2-3", "4-10", "10+"];
const CONTACT_LANGUAGES = ["English", "Arabic", "Hindi/Urdu", "Tagalog", "Other"];

function BandChips({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o;
        return (
          <button key={o} type="button" onClick={() => onChange(o)}
            className="rounded-full border-2 px-5 py-2.5 text-sm font-semibold transition-all"
            style={{
              borderColor: on ? "var(--color-primary)" : "var(--color-base-200)",
              background: on ? "color-mix(in srgb, var(--color-primary) 8%, white)" : "white",
              color: on ? "var(--color-primary)" : "var(--color-neutral-700)",
            }}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function StrengthStep({ onDone }: { onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [teamBand, setTeamBand] = useState("");
  const [fleetBand, setFleetBand] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState(true);
  const [languages, setLanguages] = useState<string[]>(["English"]);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    apiGet<{ profile: SpProfile }>("/profiles/service-provider/me")
      .then(({ profile }) => {
        setTeamBand(profile.teamSizeBand ?? "");
        setFleetBand(profile.fleetSizeBand ?? "");
        // Pre-fill the contact from the signatory — editable if someone else handles queries.
        setContactName(profile.opsContactName ?? profile.ownerName ?? "");
        setContactPhone(profile.opsContactPhone ?? "");
        setWhatsapp(profile.opsContactWhatsapp ?? true);
        setLanguages(profile.opsContactLanguages?.length ? profile.opsContactLanguages : ["English"]);
      })
      .catch(() => {})
      .finally(() => setInitialLoaded(true));
  }, []);

  const nameOk = contactName.trim().length >= 2;
  const phoneOk = /^\+?\d{8,16}$/.test(contactPhone.replace(/[\s-]/g, ""));
  const valid = teamBand && fleetBand && nameOk && phoneOk;

  const onSubmit = async () => {
    setTouched(true);
    if (!valid) return;
    setServerError(null);
    setSubmitting(true);
    try {
      await apiPatch("/profiles/service-provider/me", {
        teamSizeBand: teamBand,
        fleetSizeBand: fleetBand,
        opsContactName: contactName.trim(),
        opsContactPhone: contactPhone.replace(/[\s-]/g, ""),
        opsContactWhatsapp: whatsapp,
        opsContactLanguages: languages,
      });
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
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
    <div className="space-y-7">
      <div>
        <p className="mb-2.5 text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>People in the field</p>
        <BandChips value={teamBand} options={TEAM_BANDS} onChange={setTeamBand} />
        {touched && !teamBand && <p className="mt-1.5 text-xs text-red-600">Pick your team size</p>}
      </div>

      <div>
        <p className="mb-2.5 text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>Service vehicles</p>
        <BandChips value={fleetBand} options={FLEET_BANDS} onChange={setFleetBand} />
        {touched && !fleetBand && <p className="mt-1.5 text-xs text-red-600">Pick your vehicle count</p>}
        <p className="mt-2 text-xs" style={{ color: "var(--color-neutral-400)" }}>
          Signals, not commitments — your exact roster and fleet come after approval.
        </p>
      </div>

      <div className="rounded-2xl border p-5" style={{ borderColor: "var(--color-base-200)" }}>
        <p className="text-sm font-bold" style={{ color: "var(--color-neutral-900)" }}>Who answers customer queries?</p>
        <p className="mb-4 mt-1 text-xs leading-relaxed" style={{ color: "var(--color-neutral-500)" }}>
          Customers and UpNow support reach this person about bookings. Expect to reply within 2 working hours.
        </p>

        <label className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--color-neutral-700)" }}>Name</label>
        <input value={contactName} onChange={(e) => setContactName(e.target.value)}
          className="mb-1 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2"
          style={{ borderColor: "var(--color-base-200)" }} placeholder="Contact name" />
        {touched && !nameOk && <p className="mb-2 text-xs text-red-600">Contact name is required</p>}

        <label className="mb-1.5 mt-3 block text-xs font-semibold" style={{ color: "var(--color-neutral-700)" }}>Mobile</label>
        <div className="flex gap-2">
          <span className="flex items-center rounded-xl border px-3.5 text-sm font-semibold" style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-500)", background: "var(--color-base-100)" }}>+971</span>
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputMode="tel"
            className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2"
            style={{ borderColor: "var(--color-base-200)" }} placeholder="50 712 3482" />
        </div>
        {touched && !phoneOk && <p className="mt-1 text-xs text-red-600">Enter a valid mobile (8–16 digits)</p>}
        <p className="mt-1.5 text-xs" style={{ color: "var(--color-neutral-400)" }}>
          Pre-filled from your details — edit if someone else handles queries.
        </p>

        <button type="button" onClick={() => setWhatsapp((v) => !v)}
          className="mt-4 flex w-full items-center justify-between rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--color-base-200)" }}>
          <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--color-neutral-900)" }}>
            <PhoneCall size={15} style={{ color: "var(--color-primary)" }} /> Available on WhatsApp
          </span>
          <span className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{ background: whatsapp ? "var(--color-primary)" : "var(--color-base-300)" }}>
            <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: whatsapp ? "translateX(22px)" : "translateX(2px)" }} />
          </span>
        </button>

        <p className="mb-2 mt-4 text-xs font-semibold" style={{ color: "var(--color-neutral-700)" }}>
          Languages spoken <span className="font-normal" style={{ color: "var(--color-neutral-400)" }}>(optional)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {CONTACT_LANGUAGES.map((lang) => {
            const on = languages.includes(lang);
            return (
              <button key={lang} type="button"
                onClick={() => setLanguages((ls) => on ? ls.filter((l) => l !== lang) : [...ls, lang])}
                className="rounded-full border px-4 py-2 text-xs font-semibold transition-all"
                style={{
                  borderColor: on ? "var(--color-primary)" : "var(--color-base-200)",
                  background: on ? "color-mix(in srgb, var(--color-primary) 8%, white)" : "white",
                  color: on ? "var(--color-primary)" : "var(--color-neutral-600)",
                }}>
                {lang}{on && " ✓"}
              </button>
            );
          })}
        </div>
      </div>

      {serverError && <p className="text-sm text-red-600">{serverError}</p>}

      <button type="button" onClick={() => void onSubmit()} disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-60"
        style={{ background: "var(--color-primary)" }}>
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Continue
      </button>
    </div>
  );
}

// ─── Step 5 · Owner details (skippable) ──────────────────────────────────────

function OwnerDetailsStep({ onDone }: { onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [dobOpen, setDobOpen] = useState(false);
  const [dobMonth, setDobMonth] = useState<Date>(subYears(new Date(), 25));
  const [natSearch, setNatSearch] = useState("");
  const [natOpen, setNatOpen] = useState(false);
  const natRef = useRef<HTMLDivElement>(null);
  const dobRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<OwnerDetailsValues>({
    resolver: zodResolver(ownerDetailsSchema),
    defaultValues: {
      emiratesIdNumber: "",
      nationality: "",
      dateOfBirth: "",
    },
  });

  const dobValue = watch("dateOfBirth");
  const selectedDate =
    dobValue && isValid(parse(dobValue, "yyyy-MM-dd", new Date()))
      ? parse(dobValue, "yyyy-MM-dd", new Date())
      : undefined;

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (natRef.current && !natRef.current.contains(e.target as Node))
        setNatOpen(false);
      if (dobRef.current && !dobRef.current.contains(e.target as Node))
        setDobOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    apiGet<{ profile: SpProfile }>("/profiles/service-provider/me")
      .then(({ profile }) => {
        if (profile.nationality) setNatSearch(profile.nationality);
        if (profile.dateOfBirth) {
          const d = parse(profile.dateOfBirth, "yyyy-MM-dd", new Date());
          if (isValid(d)) setDobMonth(d);
        }
        reset({
          emiratesIdNumber: profile.emiratesIdNumber ?? "",
          nationality: profile.nationality ?? "",
          dateOfBirth: profile.dateOfBirth ?? "",
        });
      })
      .catch(() => {})
      .finally(() => setInitialLoaded(true));
  }, [reset]);

  const onSubmit = async (vals: OwnerDetailsValues) => {
    setServerError(null);
    try {
      await apiPatch("/profiles/service-provider/me", {
        emiratesIdNumber: vals.emiratesIdNumber || null,
        nationality: vals.nationality || null,
        dateOfBirth: vals.dateOfBirth || null,
      });
      onDone();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const filteredNats = NATIONALITIES.filter((n) =>
    n.toLowerCase().includes(natSearch.toLowerCase()),
  ).slice(0, 30);

  if (!initialLoaded) {
    return (
      <div className="flex items-center gap-3 py-8">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-primary)" }}
        />
        <span className="text-sm" style={{ color: "var(--color-neutral-500)" }}>
          Loading&hellip;
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Input
        label="Emirates ID number"
        placeholder="784-1990-1234567-8"
        autoComplete="off"
        {...register("emiratesIdNumber")}
        error={errors.emiratesIdNumber?.message}
      />

      {/* ── Nationality ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label
          className="text-sm font-medium"
          style={{ color: "var(--color-neutral-700)" }}
        >
          Nationality
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
                    borderColor: natOpen
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
                          color:
                            field.value === nat
                              ? "var(--color-primary)"
                              : "var(--color-neutral-800)",
                          background:
                            field.value === nat
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
      </div>

      {/* ── Date of birth ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label
          className="text-sm font-medium"
          style={{ color: "var(--color-neutral-700)" }}
        >
          Date of birth
        </label>
        <div className="relative" ref={dobRef}>
          <button
            type="button"
            onClick={() => setDobOpen((o) => !o)}
            className="w-full flex items-center justify-between rounded-xl border bg-white px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            style={{
              borderColor: dobOpen
                ? "var(--color-primary)"
                : "var(--color-base-200)",
              color: selectedDate
                ? "var(--color-neutral-900)"
                : "var(--color-neutral-400)",
            }}
          >
            <span>
              {selectedDate
                ? format(selectedDate, "d MMMM yyyy")
                : "Select your date of birth"}
            </span>
            <ChevronDown
              className="w-4 h-4 flex-shrink-0"
              style={{ color: "var(--color-neutral-400)" }}
            />
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
                    setValue("dateOfBirth", format(date, "yyyy-MM-dd"), {
                      shouldValidate: true,
                    });
                    setDobOpen(false);
                  }
                }}
              />
            </div>
          )}
        </div>
        <input type="hidden" {...register("dateOfBirth")} />
      </div>

      {serverError && <ErrorBanner message={serverError} />}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            Save &amp; continue <ChevronRight className="w-4 h-4 ml-1" />
          </>
        )}
      </Button>
    </form>
  );
}

// ─── Step 6 · Documents ───────────────────────────────────────────────────────

function DocumentsStep({ onDone }: { onDone: () => void }) {
  return (
    <KycDocumentsPanel
      profileApiPath="/profiles/service-provider/me"
      ownerType="service_provider"
      onAllRequiredUploaded={onDone}
      continueLabel="Go to my dashboard"
    />
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ServiceProviderOnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"wizard" | "jobready">("wizard");
  const [jrDone, setJrDone] = useState(0);
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

      // Step 1 — business basics confirmed (entityType confirmed + businessName)
      try {
        const data = await apiGet<{
          profile: SpProfile;
          checklist?: Array<{ required?: boolean; uploaded?: boolean }>;
        }>("/profiles/service-provider/me");
        const p = data.profile;
        if (p?.accountTypeConfirmedAt && p?.businessName) done.add(1);
        // Step 2 — at least one service category selected
        if (p?.serviceCategories && p.serviceCategories.length > 0) done.add(2);
        // Step 3 — at least one emirate selected
        if (p?.emiratesServed && p.emiratesServed.length > 0) done.add(3);
        // Step 4 — strength signals (bands + customer-queries contact)
        if (p?.teamSizeBand && p?.fleetSizeBand && p?.opsContactName) done.add(4);
        // Step 5 — owner details (optional step, skip if no data but also don't block)
        // We consider it done if at least one field is filled
        if (p?.emiratesIdNumber || p?.nationality || p?.dateOfBirth) done.add(5);
        // Step 6 — documents: every required doc uploaded, or already approved
        const checklist = data.checklist ?? [];
        const requiredMissing = checklist.filter((c) => c.required && !c.uploaded).length;
        if ((checklist.length > 0 && requiredMissing === 0)) done.add(6);
        try {
          const kyc = await apiGet<{ isCompliant?: boolean }>("/profiles/service-provider/me/kyc-status");
          if (kyc?.isCompliant) done.add(6);
        } catch { /* tolerated */ }
      } catch {
        // profile not created yet — steps 1–4 stay incomplete
      }

      setCompleted(done);
      apiGet<{ cards: Record<string, { complete: boolean }> }>("/service-provider/job-ready")
        .then((jr) => setJrDone(Object.values(jr.cards).filter((c) => c.complete).length))
        .catch(() => {});
      const firstIncomplete = STEPS.find((s) => !done.has(s.id));
      if (!firstIncomplete) {
        // Registration done → same page flows into the operational phase.
        setPhase("jobready");
        setInitializing(false);
        return;
      }
      setStep(firstIncomplete.id);
      setInitializing(false);
    })();
  }, [user, router]);

  const advance = (fromStep: number) => {
    const newCompleted = new Set([...completed, fromStep]);
    setCompleted(newCompleted);
    // If the user came back to re-edit an already-completed step, return them to
    // the first step that still needs attention rather than the very next one.
    const firstIncomplete = STEPS.find((s) => !newCompleted.has(s.id));
    if (firstIncomplete) {
      setStep(firstIncomplete.id);
    } else {
      setPhase("jobready");
    }
  };

  const currentStep = STEPS[step];

  const stepperJobReady = {
    active: phase === "jobready",
    unlocked: completed.size === STEPS.length || phase === "jobready",
    done: jrDone,
    onClick: () => setPhase("jobready"),
  };

  if (!initializing && phase === "jobready") {
    return (
      <div className={grotesk.className} style={{ background: "#F7F8F6", minHeight: "100%", color: "#182420" }}>
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="grid items-start gap-6 lg:grid-cols-[300px_1fr]">
            <aside
              className="hidden rounded-3xl p-4 lg:block"
              style={{ background: "#fff", border: "1px solid #EEF0EC" }}
            >
              <Stepper
                current={-1}
                completed={completed}
                onStepClick={(id) => { setPhase("wizard"); setStep(id); }}
                jobReady={stepperJobReady}
              />
            </aside>
            <main>
              <SpJobReady />
            </main>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-base-100, #f9f8f6)" }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {initializing ? (
          <div className="flex items-center justify-center py-24">
            <Loader2
              className="w-8 h-8 animate-spin"
              style={{ color: "var(--color-primary)" }}
            />
          </div>
        ) : null}

        <div className={initializing ? "hidden" : ""}>
          {/* Page header */}
          <div className="mb-8">
            <h1
              className="text-3xl font-bold"
              style={{ color: "var(--color-neutral-900)" }}
            >
              Complete your provider profile
            </h1>
            <p
              className="mt-1.5 text-base"
              style={{ color: "var(--color-neutral-500)" }}
            >
              {completed.size} of {STEPS.length} steps complete &mdash; finish
              setup, then our team verifies your profile within 48 hours and you
              can start receiving bookings.
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 items-start">
            {/* Sidebar */}
            <aside
              className="w-full lg:w-72 flex-shrink-0 rounded-3xl p-5"
              style={{
                background: "#fff",
                border: "1px solid var(--color-base-200)",
              }}
            >
              <Stepper
                current={step}
                completed={completed}
                onStepClick={setStep}
                jobReady={stepperJobReady}
              />

              <div className="mt-6 px-4">
                <div
                  className="flex justify-between text-xs mb-1.5"
                  style={{ color: "var(--color-neutral-400)" }}
                >
                  <span>Progress</span>
                  <span>
                    {Math.round((completed.size / STEPS.length) * 100)}%
                  </span>
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--color-base-200)" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.round((completed.size / STEPS.length) * 100)}%`,
                      background: "var(--color-primary)",
                    }}
                  />
                </div>
              </div>

              {/* Concierge fallback — assisted onboarding for the pilot cohort */}
              <a
                href="mailto:support@upnow.ae?subject=Help%20me%20finish%20my%20provider%20onboarding"
                className="mt-5 flex items-start gap-3 rounded-2xl px-4 py-3.5 transition-colors"
                style={{
                  background: "color-mix(in srgb, var(--color-primary) 5%, white)",
                  border: "1px solid color-mix(in srgb, var(--color-primary) 15%, white)",
                }}
              >
                <PhoneCall
                  className="w-4 h-4 flex-shrink-0 mt-0.5"
                  style={{ color: "var(--color-primary)" }}
                />
                <span className="text-xs leading-relaxed" style={{ color: "var(--color-neutral-600)" }}>
                  <span className="font-semibold block" style={{ color: "var(--color-neutral-800)" }}>
                    Prefer to do this together?
                  </span>
                  Reach out and we&apos;ll call you back within 48 hours to finish
                  setup with you.
                </span>
              </a>
            </aside>

            {/* Content card */}
            <main
              className="flex-1 w-full rounded-3xl p-8"
              style={{
                background: "#fff",
                border: "1px solid var(--color-base-200)",
              }}
            >
              {/* Step header */}
              <div
                className="mb-8 pb-6"
                style={{ borderBottom: "1px solid var(--color-base-200)" }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background:
                        "color-mix(in srgb, var(--color-primary) 10%, white)",
                    }}
                  >
                    <currentStep.icon
                      className="w-5 h-5"
                      style={{ color: "var(--color-primary)" }}
                    />
                  </div>
                  <h2
                    className="text-xl font-bold"
                    style={{ color: "var(--color-neutral-900)" }}
                  >
                    {currentStep.subtitle}
                  </h2>
                </div>
                <p
                  className="text-sm leading-relaxed pl-[52px]"
                  style={{ color: "var(--color-neutral-500)" }}
                >
                  {currentStep.description}
                </p>
              </div>

              {/* Form */}
              <div className="max-w-lg">
                {step === 0 && <PhoneStep onDone={() => advance(0)} />}
                {step === 1 && (
                  <BusinessBasicsStep onDone={() => advance(1)} />
                )}
                {step === 2 && (
                  <ServiceCategoriesStep onDone={() => advance(2)} />
                )}
                {step === 3 && <ServiceAreaStep onDone={() => advance(3)} />}
                {step === 4 && <StrengthStep onDone={() => advance(4)} />}
                {step === 5 && <OwnerDetailsStep onDone={() => advance(5)} />}
                {step === 6 && <DocumentsStep onDone={() => advance(6)} />}
              </div>

              {/* Skip — available only on optional steps (owner details) or before final docs */}
              {step < 5 && (
                <div
                  className="mt-8 pt-6"
                  style={{ borderTop: "1px solid var(--color-base-200)" }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      const next = STEPS.find(
                        (s) => s.id > step && !completed.has(s.id),
                      );
                      if (next) setStep(next.id);
                      else setPhase("jobready");
                    }}
                    className="text-sm underline underline-offset-2"
                    style={{ color: "var(--color-neutral-400)" }}
                  >
                    Skip this step &mdash; I&apos;ll complete it later
                  </button>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
