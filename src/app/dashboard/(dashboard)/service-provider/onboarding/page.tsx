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
  ShieldCheck,
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
    label: "Owner details",
    subtitle: "Personal information",
    icon: UserCheck,
    description: "Your Emirates ID, nationality, and date of birth. This helps us verify your identity for KYC.",
  },
  {
    id: 5,
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
}

// ─── Service category options ─────────────────────────────────────────────────

const SERVICE_CATEGORIES: { value: string; label: string }[] = [
  { value: "cleaning",           label: "Cleaning" },
  { value: "maintenance",        label: "Maintenance & Repairs" },
  { value: "renovation",         label: "Renovation" },
  { value: "electricity_water",  label: "Electricity & Water" },
  { value: "fire_safety",        label: "Fire Safety" },
  { value: "security",           label: "Security" },
  { value: "landscaping",        label: "Landscaping & Gardening" },
  { value: "pest_control",       label: "Pest Control" },
  { value: "elevator",           label: "Elevator & Lifting" },
  { value: "waste",              label: "Waste Management" },
  { value: "insurance",          label: "Insurance" },
  { value: "government",         label: "Government Services" },
  { value: "other",              label: "Other" },
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
}: {
  current: number;
  completed: Set<number>;
  onStepClick: (id: number) => void;
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
                value: "individual",
                title: "Sole trader / Freelancer",
                desc: "Operating as an individual with your personal Emirates ID",
              },
              {
                value: "company",
                title: "Company",
                desc: "Registered UAE entity with a trade licence",
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
      })
      .catch(() => {})
      .finally(() => setInitialLoaded(true));
  }, [reset]);

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
      <Controller
        control={control}
        name="serviceCategories"
        render={({ field }) => (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SERVICE_CATEGORIES.map((cat) => {
              const selected = field.value.includes(cat.value);
              return (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => {
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

// ─── Step 4 · Owner details (skippable) ──────────────────────────────────────

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

// ─── Step 5 · Documents ───────────────────────────────────────────────────────

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
        const data = await apiGet<{ profile: SpProfile }>(
          "/profiles/service-provider/me",
        );
        const p = data.profile;
        if (p?.accountTypeConfirmedAt && p?.businessName) done.add(1);
        // Step 2 — at least one service category selected
        if (p?.serviceCategories && p.serviceCategories.length > 0) done.add(2);
        // Step 3 — at least one emirate selected
        if (p?.emiratesServed && p.emiratesServed.length > 0) done.add(3);
        // Step 4 — owner details (optional step, skip if no data but also don't block)
        // We consider it done if at least one field is filled
        if (p?.emiratesIdNumber || p?.nationality || p?.dateOfBirth) done.add(4);
      } catch {
        // profile not created yet — steps 1–4 stay incomplete
      }

      setCompleted(done);
      const firstIncomplete = STEPS.find((s) => !done.has(s.id));
      if (!firstIncomplete) {
        router.replace("/dashboard/service-provider");
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
      router.replace("/dashboard/service-provider");
    }
  };

  const currentStep = STEPS[step];

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
              setup to start receiving bookings.
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
                {step === 4 && <OwnerDetailsStep onDone={() => advance(4)} />}
                {step === 5 && <DocumentsStep onDone={() => advance(5)} />}
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
                      else router.replace("/dashboard/service-provider");
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
