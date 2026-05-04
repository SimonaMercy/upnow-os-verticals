# UpNow Frontend — Sprint Backlog

Tracker of record: Jira `SCRUM` project at `upnow-team.atlassian.net`. This file is the **agent-facing index** so any AI agent (or human) can immediately see what's next without leaving the repo.

## Status legend

| Symbol | Meaning |
|---|---|
| 🟢 Done | Merged, build passes, in `main` |
| 🟡 In Progress | Branch open, work underway |
| 🔵 Ready | Spec finalized, unblocked, AI/human can start now |
| ⚪ Blocked | Waiting on another ticket / decision |
| 🔴 Issue | Bug or rework needed |

---

## Sprint 1 — Auth & Identity (May 5–11, 6 working days)

Goal: registration, login, OTP, password reset, KYC upload UI; admin invite acceptance page.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-1xx | `app/v2/(auth)/register` | Registration form (RHF + Zod) with phone OTP step |
| 🔵 | SCRUM-1xx | `app/v2/(auth)/login` | Login + "Stay logged in" silent refresh |
| 🔵 | SCRUM-1xx | `app/v2/(auth)/forgot-password` | OTP-based reset flow |
| 🔵 | SCRUM-1xx | `app/v2/dashboard/profile/kyc` | KYC document upload (presigned URL flow) |
| 🔵 | SCRUM-1xx | `app/invite/[token]` | Manager/technician invite acceptance |

SRS: [docs/sprint-01-srs.html](../docs/sprint-01-srs.html)

---

## Sprint 2 — Rental Provider & Properties (May 12–21, 9 working days)

Goal: RP onboarding wizard, property listing wizard, public property browse.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-2xx | `app/v2/onboarding/rp` | RP onboarding wizard (multi-step) |
| 🔵 | SCRUM-2xx | `app/v2/dashboard/rp/properties/new` | Property listing wizard (mirrors `Mockups/upnow_property_listing_wizard_mockup.html`) |
| 🔵 | SCRUM-2xx | `app/v2/dashboard/rp/properties` | Property list + status pills |
| 🔵 | SCRUM-2xx | `app/v2/spaces` | Public browse (filters, map, cards) |
| 🔵 | SCRUM-2xx | `app/v2/spaces/[slug]` | Space detail page + inquire CTA |

SRS: [docs/sprint-02-srs.html](../docs/sprint-02-srs.html)

---

## Sprint 3 — Services Marketplace, Maintenance & Disputes (May 23–Jun 4, 9 working days)

Goal: customer books service, escrow paid upfront, tracks technician, signs off; SP/tech dashboards; dispute UI.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-3xx | `app/v2/services` | Service category browse (mirrors `Mockups/upnow_tenant_services_journey_mockup.html`) |
| 🔵 | SCRUM-3xx | `app/v2/services/[slug]/book` | Booking flow with escrow payment upfront |
| 🔵 | SCRUM-3xx | `app/v2/dashboard/customer/bookings/[id]` | Live booking tracker (Pending → Escrow Held → ... → Escrow Released) |
| 🔵 | SCRUM-3xx | `app/v2/dashboard/sp` | SP dashboard (jobs, dispatch) |
| 🔵 | SCRUM-3xx | `app/v2/dashboard/tech` | Technician day view + status updates + photo upload |
| 🔵 | SCRUM-3xx | `app/v2/dashboard/customer/maintenance/new` | Maintenance request form |
| 🔵 | SCRUM-3xx | `app/v2/dashboard/*/disputes/[id]` | Dispute detail + evidence upload |

SRS: [docs/sprint-03-srs.html](../docs/sprint-03-srs.html)

> 🚫 UAE Holiday Blackout: May 26–29 (no work)

---

## Sprint 4 — Tenancy Lifecycle (Jun 6–15, 9 working days)

Goal: lead pipeline, in-portal offer, contract sign, move-in inspection, renewals.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-4xx | `app/v2/dashboard/am/leads` | Leads kanban (New → Contacted → Viewing → Offer Sent → Approved → Converted) |
| 🔵 | SCRUM-4xx | `app/v2/dashboard/am/leads/[id]/offer` | **Send offer directly from portal** |
| 🔵 | SCRUM-4xx | `app/v2/dashboard/am/contracts/new` | Tenancy contract wizard (mirrors `Mockups/upnow_tenancy_contract_workflow_mockup.html`) |
| 🔵 | SCRUM-4xx | `app/v2/dashboard/customer/contract` | Customer e-sign view |
| 🔵 | SCRUM-4xx | `app/v2/dashboard/am/move-in/[id]` | Move-in inspection checklist + photo capture |
| 🔵 | SCRUM-4xx | `app/v2/dashboard/am/renewals` | Renewal pipeline (90/60/30-day reminders) |

SRS: [docs/sprint-04-srs.html](../docs/sprint-04-srs.html)

---

## Sprint 5 — Admin Intelligence (Jun 16–23, 7 working days)

Goal: admin dashboards, fee config UI, reports, bulk ops.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin` | Admin home (KPIs, queues) |
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin/users` | User management + bulk suspend/export |
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin/fees` | Fee configuration UI |
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin/reports` | Reports (revenue, completion rate, dispute rate) |
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin/disputes` | Dispute mediation queue |

SRS: [docs/sprint-05-srs.html](../docs/sprint-05-srs.html)

---

## Sprint 6 — Notifications (Jun 24–Jul 2, 8 working days)

Goal: in-app notification center, preference settings, push opt-in.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-6xx | `components/upnow/NotificationBell` | In-app notification dropdown |
| 🔵 | SCRUM-6xx | `app/v2/dashboard/notifications` | Notification inbox |
| 🔵 | SCRUM-6xx | `app/v2/dashboard/settings/notifications` | Channel preferences (email/SMS/push) |
| 🔵 | SCRUM-6xx | `lib/push.ts` | FCM web push opt-in + device token registration |

SRS: [docs/sprint-07-srs.html](../docs/sprint-07-srs.html)

---

## Sprint 7 — Polish & Launch (Jul 4–9, 6 working days)

Goal: a11y pass, perf, SEO, error/empty/loading states, prep prod deploy.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-7xx | all | Bug bash from prior sprints |
| 🔵 | SCRUM-7xx | all | Loading + error + empty states for every async surface |
| 🔵 | SCRUM-7xx | all | Lighthouse ≥ 90 on key public pages |
| 🔵 | SCRUM-7xx | all | a11y audit (axe) — no serious violations |
| 🔵 | SCRUM-7xx | all | OG/SEO meta + sitemap |

SRS: [docs/sprint-08-srs.html](../docs/sprint-08-srs.html)

> Project close: **Jul 9** · Grace period: Jul 11–16 (6 working days)

---

## Updating this file

When you complete a task:

```
| 🟢 | SCRUM-XXX | `app/v2/services/[slug]/book` | Booking flow · `<commit-sha>` |
```

When you start work, set status `🟡 In Progress` and add your branch name. When blocked, switch to `⚪ Blocked` with the reason.
