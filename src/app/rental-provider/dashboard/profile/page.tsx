"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle, Phone, Mail, AlertCircle, Loader2 } from "lucide-react";
import { DashboardPage } from "@/components/dashboard/DashboardWidgets";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const UAE_EMIRATES = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Ras Al Khaimah",
  "Fujairah",
  "Umm Al Quwain",
] as const;

const NATIONALITIES = [
  "Emirati", "Saudi Arabian", "Kuwaiti", "Qatari", "Bahraini", "Omani",
  "Afghan", "Albanian", "Algerian", "American", "Argentinian", "Australian",
  "Austrian", "Azerbaijani", "Bangladeshi", "Belgian", "Belarusian", "Bolivian",
  "Brazilian", "British", "Bulgarian", "Cambodian", "Cameroonian", "Canadian",
  "Chilean", "Chinese", "Colombian", "Croatian", "Czech", "Danish", "Dutch",
  "Egyptian", "Ethiopian", "Finnish", "French", "Georgian", "German", "Ghanaian",
  "Greek", "Hungarian", "Indian", "Indonesian", "Iranian", "Iraqi", "Irish",
  "Italian", "Jamaican", "Japanese", "Jordanian", "Kazakh", "Kenyan", "Korean",
  "Lebanese", "Libyan", "Malaysian", "Maldivian", "Mauritanian", "Mexican",
  "Moroccan", "Mozambican", "Namibian", "Nepalese", "New Zealander", "Nigerian",
  "Norwegian", "Pakistani", "Palestinian", "Peruvian", "Philippine", "Polish",
  "Portuguese", "Romanian", "Russian", "Serbian", "Singaporean", "Somali",
  "South African", "Spanish", "Sri Lankan", "Sudanese", "Swedish", "Swiss",
  "Syrian", "Taiwanese", "Tajik", "Tanzanian", "Thai", "Tunisian", "Turkish",
  "Ugandan", "Ukrainian", "Uzbek", "Venezuelan", "Vietnamese", "Yemeni",
  "Zambian", "Zimbabwean",
] as const;

const UAE_LICENSING_AUTHORITIES = [
  "DED Dubai",
  "Abu Dhabi Department of Economic Development",
  "Sharjah Economic Development Department",
  "Ajman Department of Economic Development",
  "Ras Al Khaimah Economic Zone (RAKEZ)",
  "Fujairah Free Zone",
  "Umm Al Quwain DED",
  "DIFC (Dubai International Financial Centre)",
  "ADGM (Abu Dhabi Global Market)",
  "JAFZA (Jebel Ali Free Zone)",
  "DMCC (Dubai Multi Commodities Centre)",
  "Dubai Silicon Oasis Authority",
  "Dubai Airport Free Zone (DAFZA)",
  "Abu Dhabi Free Zone Authority (ADFZA)",
  "Sharjah Free Zone Authority (SHAMS)",
  "Other",
] as const;

const schema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  dateOfBirth: z.string().optional(),
  nationality: z.string().optional(),
  gender: z.enum(["male", "female", "prefer_not_to_say"]).optional(),
  entityType: z.enum(["individual", "company"]),
  companyName: z.string().optional(),
  tradeLicenseNumber: z.string().optional(),
  tradeLicenseAuthority: z.string().optional(),
  authorizedSignatoryName: z.string().optional(),
  emiratesIdNumber: z.string().optional(),
  passportNumber: z.string().optional(),
  legalNoticesAddress: z.string().optional(),
  hasPoa: z.boolean(),
  // Contact & banking
  contactAddress: z.string().optional(),
  bankAccountName: z.string().optional(),
  bankIban: z.string().optional(),
  bankName: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.hasPoa) {
    if (!data.authorizedSignatoryName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Full name of the authorized signatory is required",
        path: ["authorizedSignatoryName"],
      });
    }
    if (!data.emiratesIdNumber?.trim() && !data.passportNumber?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one identity document for the signatory",
        path: ["emiratesIdNumber"],
      });
    }
  }
});

type FormValues = z.infer<typeof schema>;

interface RpProfile {
  entityType: string;
  companyName: string | null;
  contactAddress: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string | null;
  tradeLicenseNumber: string | null;
  tradeLicenseAuthority: string | null;
  authorizedSignatoryName: string | null;
  emiratesIdNumber: string | null;
  passportNumber: string | null;
  legalNoticesAddress: string | null;
  hasPoa: boolean;
  bankAccountName: string | null;
  bankIban: string | null;
  bankName: string | null;
}

export default function RentalProviderProfilePage() {
  const { user, refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [lockedEntityType, setLockedEntityType] = useState<string | null>(null);

  // ── Phone-change state machine ────────────────────────────────────────────
  type PhonePhase = "idle" | "entering" | "verifying";
  const [phonePhase, setPhonePhase] = useState<PhonePhase>("idle");
  const [pendingPhone, setPendingPhone] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneDone, setPhoneDone] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: "",
      dateOfBirth: "",
      nationality: "",
      gender: undefined,
      entityType: "individual",
      companyName: "",
      tradeLicenseNumber: "",
      tradeLicenseAuthority: "",
      authorizedSignatoryName: "",
      emiratesIdNumber: "",
      passportNumber: "",
      legalNoticesAddress: "",
      hasPoa: false,
      contactAddress: "",
      bankAccountName: "",
      bankIban: "",
      bankName: "",
    },
  });
  const hasPoa = useWatch({ control, name: "hasPoa" });
  const entityType = useWatch({ control, name: "entityType" });

  useEffect(() => {
    apiGet<{ profile: RpProfile }>("/profiles/rental-provider/me")
      .then(({ profile }) => {
        const et = (profile.entityType ?? "individual") as "individual" | "company";
        reset({
          fullName: user?.name ?? "",
          dateOfBirth: profile.dateOfBirth ?? "",
          nationality: profile.nationality ?? "",
          gender: (profile.gender as "male" | "female" | "prefer_not_to_say") ?? undefined,
          entityType: et,
          companyName: profile.companyName ?? "",
          tradeLicenseNumber: profile.tradeLicenseNumber ?? "",
          tradeLicenseAuthority: profile.tradeLicenseAuthority ?? "",
          authorizedSignatoryName: profile.authorizedSignatoryName ?? "",
          emiratesIdNumber: profile.emiratesIdNumber ?? "",
          passportNumber: profile.passportNumber ?? "",
          legalNoticesAddress: profile.legalNoticesAddress ?? "",
          hasPoa: profile.hasPoa ?? false,
          contactAddress: profile.contactAddress ?? "",
          bankAccountName: profile.bankAccountName ?? "",
          bankIban: profile.bankIban ?? "",
          bankName: profile.bankName ?? "",
        });
        // Lock entity type if it was explicitly chosen (not just the default placeholder).
        if (profile.entityType) setLockedEntityType(profile.entityType);
      })
      .catch(() => {
        reset((prev) => ({ ...prev, fullName: user?.name ?? "" }));
      })
      .finally(() => setLoading(false));
  }, [reset, user?.name]);

  const onSubmit = async (data: FormValues) => {
    setServerError(null);
    setSaved(false);
    try {
      await Promise.all([
        apiPatch("/auth/me", { fullName: data.fullName }),
        apiPatch("/profiles/rental-provider/me", {
          entityType: data.entityType,
          companyName: data.companyName || null,
          contactAddress: data.contactAddress || null,
          dateOfBirth: data.dateOfBirth || null,
          nationality: data.nationality || null,
          gender: data.gender || null,
          tradeLicenseNumber: data.tradeLicenseNumber || null,
          tradeLicenseAuthority: data.tradeLicenseAuthority || null,
          authorizedSignatoryName: data.authorizedSignatoryName || null,
          emiratesIdNumber: data.emiratesIdNumber || null,
          passportNumber: data.passportNumber || null,
          legalNoticesAddress: data.legalNoticesAddress || null,
          hasPoa: data.hasPoa,
          poaPersonName: data.authorizedSignatoryName || null,
          bankAccountName: data.bankAccountName || null,
          bankIban: data.bankIban || null,
          bankName: data.bankName || null,
        }),
      ]);
      await refresh();
      setSaved(true);
      setLockedEntityType(data.entityType);
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  // ── Phone handlers ────────────────────────────────────────────────────────
  const sendPhoneOtp = async () => {
    setPhoneError(null);
    if (!/^\+?\d{7,15}$/.test(phoneInput.replace(/\s/g, ""))) {
      setPhoneError("Enter a valid phone number, e.g. +971 50 123 4567");
      return;
    }
    setPhoneBusy(true);
    try {
      await apiPatch("/auth/me", { phone: phoneInput.trim() });
      await apiPost("/auth/otp/request", {});
      setPendingPhone(phoneInput.trim());
      setPhonePhase("verifying");
      setOtpInput("");
    } catch (e: unknown) {
      setPhoneError(e instanceof Error ? e.message : "Could not send code");
    } finally {
      setPhoneBusy(false);
    }
  };

  const verifyPhoneOtp = async () => {
    setPhoneError(null);
    if (otpInput.trim().length !== 6) {
      setPhoneError("Enter the 6-digit code");
      return;
    }
    setPhoneBusy(true);
    try {
      await apiPost("/auth/otp/verify", { code: otpInput.trim() });
      await refresh();
      setPhonePhase("idle");
      setPhoneDone(true);
      setPhoneInput("");
      setOtpInput("");
    } catch (e: unknown) {
      setPhoneError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setPhoneBusy(false);
    }
  };

  if (loading) {
    return (
      <DashboardPage title="My Profile">
        <p className="text-sm" style={{ color: "var(--color-neutral-500)" }}>Loading…</p>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage
      title="My Profile"
      subtitle="Update your personal details, business information and contact address."
    >
      {/* ── Two-column grid ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">

        {/* ── LEFT: main profile form ───────────────────────────── */}
        <div
          className="rounded-2xl border bg-white p-8"
          style={{ borderColor: "var(--color-base-200)", boxShadow: "0 4px 24px rgba(15,23,42,0.06)" }}
        >
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">

            {/* Full name */}
            <Input
              label="Full name"
              placeholder="Your full legal name"
              error={errors.fullName?.message}
              autoComplete="name"
              {...register("fullName")}
            />

            {/* DOB / Gender / Nationality */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Date of birth"
                type="date"
                error={errors.dateOfBirth?.message}
                {...register("dateOfBirth")}
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: "var(--color-neutral-700)" }}>
                  Gender
                </label>
                <select
                  {...register("gender")}
                  className="w-full rounded-xl border border-[var(--color-base-200)] bg-white px-4 py-2.5 text-sm text-[var(--color-neutral-900)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--color-neutral-700)" }}>
                Nationality
              </label>
              <select
                {...register("nationality")}
                className="w-full rounded-xl border border-[var(--color-base-200)] bg-white px-4 py-2.5 text-sm text-[var(--color-neutral-900)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <option value="">Select nationality…</option>
                {NATIONALITIES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            {/* Entity type — hidden, value still submitted */}
            <input type="hidden" {...register("entityType")} />

            {entityType === "company" && (
              <>
                <hr style={{ borderColor: "var(--color-base-200)" }} />

                <p className="text-sm font-semibold" style={{ color: "var(--color-neutral-700)" }}>
                  Company details
                </p>

                <Input
                  label="Company name"
                  placeholder="Registered business name"
                  autoComplete="organization"
                  {...register("companyName")}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="License number"
                    placeholder="e.g. CN-1234567"
                    {...register("tradeLicenseNumber")}
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" style={{ color: "var(--color-neutral-700)" }}>
                      Licensing authority
                    </label>
                    <select
                      {...register("tradeLicenseAuthority")}
                      className="w-full rounded-xl border border-[var(--color-base-200)] bg-white px-4 py-2.5 text-sm text-[var(--color-neutral-900)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                    >
                      <option value="">Select authority…</option>
                      {UAE_LICENSING_AUTHORITIES.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            <hr style={{ borderColor: "var(--color-base-200)" }} />

            {/* Authorized signatory */}
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                {...register("hasPoa")}
                className="h-4 w-4 rounded border-[var(--color-base-200)] accent-[var(--color-primary)]"
              />
              <span className="text-sm" style={{ color: "var(--color-neutral-700)" }}>
                Someone else is acting as authorized signatory on my behalf
              </span>
            </label>

            {hasPoa && (
              <>
                <Input
                  label="Full name"
                  placeholder="Full name of the authorized signatory"
                  {...register("authorizedSignatoryName")}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Emirates ID number"
                    placeholder="784-XXXX-XXXXXXX-X"
                    error={errors.emiratesIdNumber?.message}
                    {...register("emiratesIdNumber")}
                  />
                  <Input
                    label="Passport number"
                    placeholder="e.g. A12345678"
                    {...register("passportNumber")}
                  />
                </div>
              </>
            )}

            <hr style={{ borderColor: "var(--color-base-200)" }} />

            {/* Legal notices address */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--color-neutral-700)" }}>
                Legal notices address
              </label>
              <textarea
                {...register("legalNoticesAddress")}
                rows={3}
                placeholder="Full address where legal correspondence should be sent"
                className="w-full rounded-xl border border-[var(--color-base-200)] bg-white px-4 py-2.5 text-sm text-[var(--color-neutral-900)] placeholder:text-[var(--color-neutral-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
              />
            </div>

            <hr style={{ borderColor: "var(--color-base-200)" }} />

            {/* Contact address */}
            <p className="text-sm font-semibold" style={{ color: "var(--color-neutral-700)" }}>
              Contact address
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--color-neutral-700)" }}>
                Property / office address
              </label>
              <textarea
                {...register("contactAddress")}
                rows={3}
                placeholder="Your contact or business address in the UAE"
                className="w-full rounded-xl border border-[var(--color-base-200)] bg-white px-4 py-2.5 text-sm text-[var(--color-neutral-900)] placeholder:text-[var(--color-neutral-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
              />
            </div>

            <hr style={{ borderColor: "var(--color-base-200)" }} />

            {/* Banking */}
            <p className="text-sm font-semibold" style={{ color: "var(--color-neutral-700)" }}>
              Bank account details
            </p>
            <p className="text-xs -mt-2" style={{ color: "var(--color-neutral-400)" }}>
              Required for rent disbursements. Must match your registered business name.
            </p>

            <Input
              label="Account holder name"
              placeholder="Name on bank account"
              {...register("bankAccountName")}
              error={errors.bankAccountName?.message}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="IBAN"
                placeholder="AE07 0331 2345 6789 0123 456"
                {...register("bankIban")}
                error={errors.bankIban?.message}
              />
              <Input
                label="Bank name"
                placeholder="e.g. Emirates NBD"
                {...register("bankName")}
                error={errors.bankName?.message}
              />
            </div>

            {/* Feedback */}
            {saved && (
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3"
                style={{
                  backgroundColor: "var(--color-teal-50, #f0faf7)",
                  border: "1px solid var(--color-teal-200, #c3e8df)",
                }}
              >
                <CheckCircle size={16} style={{ color: "var(--color-primary)" }} />
                <p className="text-sm font-medium" style={{ color: "var(--color-primary)" }}>
                  Profile saved successfully.
                </p>
              </div>
            )}
            {serverError && (
              <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: "color-mix(in srgb, var(--color-error) 8%, white)", color: "var(--color-error)" }}>
                <AlertCircle size={14} className="flex-shrink-0" />
                <p className="text-sm">{serverError}</p>
              </div>
            )}

            <Button type="submit" disabled={isSubmitting} size="lg" className="self-start mt-1">
              {isSubmitting ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </div>

        {/* ── RIGHT column ──────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Phone number card */}
          <div
            className="rounded-2xl border bg-white p-6"
            style={{ borderColor: "var(--color-base-200)", boxShadow: "0 4px 24px rgba(15,23,42,0.06)" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Phone size={15} style={{ color: "var(--color-primary)" }} />
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-neutral-700)" }}>
                Phone number
              </h3>
            </div>

            {/* Current phone display */}
            <div
              className="flex items-center gap-2 rounded-xl border px-3 py-2.5 mb-4"
              style={{ borderColor: "var(--color-base-200)", backgroundColor: "var(--color-base-100)" }}
            >
              <span className="flex-1 text-sm" style={{ color: user?.phone ? "var(--color-neutral-700)" : "var(--color-neutral-400)" }}>
                {user?.phone ?? "No phone set"}
              </span>
              {user?.phoneVerified && (
                <CheckCircle size={13} style={{ color: "var(--color-primary)" }} />
              )}
            </div>

            {phoneDone && (
              <div className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 mb-3" style={{ background: "color-mix(in srgb, var(--color-primary) 8%, white)" }}>
                <CheckCircle size={13} style={{ color: "var(--color-primary)" }} />
                <p className="text-xs font-medium" style={{ color: "var(--color-primary)" }}>Phone verified!</p>
              </div>
            )}

            {/* ── Idle: show change button ── */}
            {phonePhase === "idle" && !phoneDone && (
              <button
                type="button"
                onClick={() => { setPhonePhase("entering"); setPhoneError(null); setPhoneInput(user?.phone ?? ""); }}
                className="w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-base-100)]"
                style={{ borderColor: "var(--color-base-200)", color: "var(--color-primary)" }}
              >
                {user?.phone ? "Change phone" : "Add phone"}
              </button>
            )}

            {phoneDone && (
              <button
                type="button"
                onClick={() => { setPhoneDone(false); setPhonePhase("entering"); setPhoneError(null); setPhoneInput(user?.phone ?? ""); }}
                className="w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-base-100)]"
                style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-500)" }}
              >
                Change again
              </button>
            )}

            {/* ── Entering: phone input ── */}
            {phonePhase === "entering" && (
              <div className="flex flex-col gap-3">
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="+971 50 123 4567"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  style={{
                    borderColor: phoneError ? "var(--color-error)" : "var(--color-base-200)",
                    color: "var(--color-neutral-900)",
                  }}
                />
                {phoneError && (
                  <p className="text-xs" style={{ color: "var(--color-error)" }}>{phoneError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={sendPhoneOtp}
                    disabled={phoneBusy}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: "var(--color-primary)" }}
                  >
                    {phoneBusy ? <Loader2 size={14} className="animate-spin" /> : "Send code"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPhonePhase("idle"); setPhoneError(null); }}
                    className="rounded-xl border px-4 py-2.5 text-sm transition-colors hover:bg-[var(--color-base-100)]"
                    style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-500)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Verifying: OTP input ── */}
            {phonePhase === "verifying" && (
              <div className="flex flex-col gap-3">
                <p className="text-xs" style={{ color: "var(--color-neutral-500)" }}>
                  Code sent to <span className="font-medium" style={{ color: "var(--color-neutral-700)" }}>{pendingPhone}</span>
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-xl border-2 px-4 py-3 text-center text-xl font-bold tracking-widest outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  style={{
                    borderColor: phoneError ? "var(--color-error)" : "var(--color-base-200)",
                    color: "var(--color-neutral-900)",
                  }}
                />
                {phoneError && (
                  <p className="text-xs" style={{ color: "var(--color-error)" }}>{phoneError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={verifyPhoneOtp}
                    disabled={phoneBusy}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: "var(--color-primary)" }}
                  >
                    {phoneBusy ? <Loader2 size={14} className="animate-spin" /> : "Verify"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPhonePhase("entering"); setPhoneError(null); }}
                    className="rounded-xl border px-4 py-2.5 text-sm transition-colors hover:bg-[var(--color-base-100)]"
                    style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-500)" }}
                  >
                    Back
                  </button>
                </div>
                <button
                  type="button"
                  onClick={sendPhoneOtp}
                  disabled={phoneBusy}
                  className="text-xs underline underline-offset-2 text-left"
                  style={{ color: "var(--color-neutral-400)" }}
                >
                  Resend code
                </button>
              </div>
            )}
          </div>

          {/* Account info card */}
          <div
            className="rounded-2xl border bg-white p-6"
            style={{ borderColor: "var(--color-base-200)", boxShadow: "0 4px 24px rgba(15,23,42,0.06)" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Mail size={15} style={{ color: "var(--color-primary)" }} />
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-neutral-700)" }}>
                Account
              </h3>
            </div>
            <div className="flex flex-col gap-3 text-xs" style={{ color: "var(--color-neutral-500)" }}>
              <div className="flex justify-between items-center">
                <span>Email</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium" style={{ color: "var(--color-neutral-700)" }}>
                    {user?.email ?? "—"}
                  </span>
                  {user?.emailVerified && (
                    <CheckCircle size={12} style={{ color: "var(--color-primary)" }} />
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span>Role</span>
                <span className="font-medium capitalize" style={{ color: "var(--color-neutral-700)" }}>
                  {user?.role?.replace(/_/g, " ") ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Status</span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                  style={{
                    backgroundColor: user?.status === "active"
                      ? "color-mix(in srgb, var(--color-primary) 10%, white)"
                      : "var(--color-base-100)",
                    color: user?.status === "active"
                      ? "var(--color-primary)"
                      : "var(--color-neutral-500)",
                  }}
                >
                  {user?.status ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardPage>
  );
}