import Link from "next/link";
import { Home, Building2, Wrench, ArrowRight } from "lucide-react";

const choices = [
  {
    icon: Home,
    title: "Sign Up as Customer",
    desc: "Find a place to rent and book trusted home services across the UAE.",
    href: "/register/customer",
    cta: "Create customer account",
  },
  {
    icon: Building2,
    title: "Sign Up as Rental Provider",
    desc: "List apartments, offices, or warehouses and manage tenancies in one dashboard.",
    href: "/register/rental-provider",
    cta: "Create rental account",
  },
  {
    icon: Wrench,
    title: "Sign Up as Service Provider",
    desc: "Offer maintenance and home services to customers across the UAE.",
    href: "/register/service-provider",
    cta: "Create service account",
  },
];

/**
 * Per Jira SCRUM-1 (T-101): three separate sign-up CTAs on the landing page,
 * each going to a role-specific registration page. Manager / Technician are
 * invite-only and intentionally absent.
 *
 * Visual language: matches UpNow Marketplace `ProviderCTA` — primary green
 * gradient panel, white inner cards, rounded-full primary CTA buttons.
 */
export function SignupChoice() {
  return (
    <section
      id="signup"
      style={{
        background: "linear-gradient(180deg, var(--base-100) 0%, #f0faf6 100%)",
        paddingBlock: 96,
      }}
    >
      <div className="container text-center">
        <p
          className="text-xs font-semibold uppercase tracking-[0.15em]"
          style={{ color: "var(--primary)" }}
        >
          Get started
        </p>
        <h2
          className="font-bold mt-3"
          style={{ fontSize: 42, letterSpacing: "-0.02em", color: "var(--neutral-900)" }}
        >
          Pick the path that matches you
        </h2>
        <p
          className="mt-3 max-w-2xl mx-auto"
          style={{ color: "var(--neutral-500)", fontSize: 18, lineHeight: 1.6 }}
        >
          Customers, rental providers, and service providers each get a dedicated workspace.
          Manager and Technician accounts are invite-only.
        </p>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 text-start">
          {choices.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className="flex flex-col"
                style={{
                  backgroundColor: "#ffffff",
                  border: "1px solid var(--base-200)",
                  borderRadius: 20,
                  padding: 32,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 48,
                    height: 48,
                    backgroundColor: "var(--primary-light)",
                    borderRadius: 12,
                  }}
                >
                  <Icon size={22} style={{ color: "var(--primary)" }} />
                </div>
                <h3
                  className="font-bold mt-5"
                  style={{ fontSize: 20, color: "var(--neutral-900)" }}
                >
                  {c.title}
                </h3>
                <p
                  className="text-sm mt-2 flex-1"
                  style={{ color: "var(--neutral-500)", lineHeight: 1.6 }}
                >
                  {c.desc}
                </p>
                <Link
                  href={c.href}
                  className="inline-flex items-center gap-2 self-start mt-6 rounded-full px-5 py-2.5 font-medium text-sm text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  {c.cta}
                  <ArrowRight size={16} />
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
