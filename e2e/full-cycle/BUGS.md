# Full-cycle E2E — real app bugs found

> **Fix status (2026-06-12, RP scope):**
> **FIXED** — BUG-02 (onboarding submit gate), BUG-04 (admin KYC status case), BUG-05 (lease-term wipe: backend merge + edit prefill), BUG-06 (furnishing persisted, migration 0061), BUG-07 (listing card photo URL), BUG-08 (rejected resubmittable + error toast), BUG-09 (street column, migration 0059 + both mappers), BUG-10 (fee auto-recalc only fills blanks), BUG-11 (cleared fields PATCH null), BUG-12 (Studio + '6+'/'5+' round-trip), BUG-13 (created_by_rp_id, migration 0062), BUG-14 (cleared email now errors explicitly), BUG-15 (POA writes gated on hasPoa), BUG-16 (wizard coerces fee numbers), BUG-17 (gender '' no longer blocks save), BUG-19 (document_owner_type 'technician', migration 0060), BUG-20 (ManagerMetaDto accepts all 19 flags), BUG-21 (invite-accept redirects to role home), BUG-22 (landlord name falls back to user name).
> **OPEN (reported only)** — BUG-01 (Tailwind scanning — mitigated via gitignore/artifact relocation), BUG-03 (no admin UI for customer-doc verification), BUG-23 (no admin SP review UI), BUG-24 (contract revert has no backend route).
> **INVALID** — BUG-18 (false positive — see entry).
> Migrations 0059–0062 are applied to upnow_prod_clone and upnow_e2e; remember to run the migration runner on PROD with the next deploy.

## BUG-01 — Tailwind v4 source scanner ingests binary Playwright artifacts and wedges the dev server (500 on every page)

- **Severity:** high (intermittent, but when it strikes the entire frontend serves 500 until the dev server is restarted)
- **Repro:**
  1. Run any Playwright suite that writes artifacts into `upnow-frontend/playwright-report-fullcycle/` (HTML reporter `data/*.webm|*.zip|*.png`) — this dir is NOT gitignored (repo-root `.gitignore` only covers `upnow-frontend/playwright-report/` and `upnow-frontend/test-results/`).
  2. Touch any watched file so Tailwind rescans sources (e.g. the suite writing `e2e/full-cycle/.state.json` is enough).
  3. Tailwind v4's automatic source detection (`@import "tailwindcss"` in `src/app/globals.css`, no `@source` config) walks every non-gitignored file, extracts garbage "class candidates" from binary content, and generates invalid CSS.
- **Expected:** build artifacts/test outputs are never scanned as utility-class sources; dev server stays healthy.
- **Actual:** `next dev` fails compiling `globals.css` with `Parsing CSS source code failed … .bg-\[var\(--l\14 �-base-200\)\] … Unexpected token Delim('\u{14}')` and every route returns 500. The poisoned candidate set lives in the dev process memory, so it persists even after the offending file is deleted — only a dev-server restart clears it. Observed live during this suite (frontend log `GET /login 500`, overlay "Build Error: Parsing CSS source code failed").
- **Suspected file:** `upnow-frontend/src/app/globals.css:1` (bare `@import "tailwindcss"` with no source scoping) + missing gitignore entries for `playwright-report-fullcycle/` (and any non-default `NEXT_DIST_DIR`, e.g. `.next-e2e/`).
- **Suggested fix:** add `@source` directives (or `source(…)` import param) limiting scanning to `src/**`, and/or gitignore `playwright-report-fullcycle/` + `.next-e2e/`.
- **Test-stack mitigation applied (not an app change):** created `upnow-frontend/playwright-report-fullcycle/.gitignore` containing `*` so the ignore-aware scanner skips the report dir; e2e frontend dev server was restarted (same documented command/env, distDir `.next-e2e`).

## BUG-02 — Company RP onboarding can never be submitted: "Submit for review" stays disabled even when all steps (incl. required Trade License) are complete

- **Severity:** critical (every company-entity rental provider — landlord company / brokerage / agents — is hard-blocked from finishing onboarding; only individuals can submit)
- **Repro (UI, verified live):**
  1. Register a fresh rental provider, land on `/rental-provider/dashboard/onboarding`.
  2. Verify phone, pick **Landlord Company** as the account type.
  3. Fill Your Information, Business (company name, trade licence number, authority), Shareholders (2 shareholders summing 100%, EID uploaded for each).
  4. On the Documents step upload the required **Trade License** — the row flips to “Uploaded ✓”.
  5. Sticky bar still says **“4 of 5 steps complete”** and **Submit for review stays disabled** forever.
- **Expected:** with every section complete, Submit enables and the company profile is submitted for compliance review.
- **Actual:** the Documents step never registers as complete for company account types, so submission is impossible (chicken-and-egg: the PATCH that would mark the profile as a company only happens on submit).
- **Root cause:**
  - `upnow-frontend/src/app/rental-provider/dashboard/onboarding/page.tsx:298` — `completion.documents` requires each required doc key to appear `uploaded` in `checklist`, which is the **server** checklist from `GET /profiles/rental-provider/me` (the locally tracked `shDocs[key].uploaded` is ignored for this check, although the row UI uses it to render “Uploaded”).
  - `upnow-backend/src/profiles/rental-provider.service.ts:187` → `documents.service.getChecklist(...)` → `document-requirements.ts:getDocumentRequirements(ownerType, rp.entityType, rp.companyType)` builds the checklist from the **persisted** profile, which stays `entity_type='individual'` until the final submit PATCH. So the server checklist never contains a `trade_license` item, and uploading it can never satisfy the frontend gate.
- **Suspected files:** `upnow-frontend/src/app/rental-provider/dashboard/onboarding/page.tsx:296-299` (completion ignores local uploads), `upnow-backend/src/profiles/rental-provider.service.ts:182-193` (checklist derived from stale entityType).
- **Suggested fix:** count `shDocs[d.key]?.uploaded` in the frontend completion check, or persist entityType/companyType when the account-type step is confirmed so the server checklist matches the chosen account type.

## BUG-03 — Admin has NO UI to verify customer KYC documents — Customers tab is read-only, so customer docs stay "attached" and kyc_status stays "pending_review" forever

- **Severity:** high (the customer KYC review loop can never be closed through the product; every self-registered customer is stuck at `users.kyc_status='pending_review'` with all docs `status='attached'`)
- **Repro (UI, verified live on the e2e stack):**
  1. Customer registers and uploads 4 KYC docs on `/welcome` (spec 01 — tenant 122 / user 425, docs 2686-2689 all `status='attached'`).
  2. Log in as super_admin → `/dashboard/admin/kyc?tab=tenants` → select the customer card.
  3. The detail panel lists the 4 documents with an amber `attached` badge and a `View` link — **there is no Verify/Approve button or any other review action** anywhere in the panel (the only action is the account Active/Inactive toggle).
- **Expected:** an admin reviewing a pending customer document can approve (verify) or reject it, flipping `documents.status` → `processed` and ultimately `users.kyc_status` → verified.
- **Actual:** the Customers tab `TenantContentPanel` renders status badges + View links only. The backend endpoint exists and works (`POST /admin/kyc/documents/:id/verify`, admin.controller.ts:222) but no frontend surface calls it for customer docs — the only caller in the whole frontend is the RP detail page (`grep` confirms `admin/kyc/documents/.../verify` appears solely in `admin/kyc/rental-provider/[id]/page.tsx:308`). There is also no customer-equivalent of the RP "Full page" review screen. Additionally nothing in the backend ever promotes `users.kyc_status` beyond `pending_review` (only `promoteToKycPending` exists, users.service.ts:206).
- **Suspected files:** `upnow-frontend/src/app/dashboard/(dashboard)/admin/kyc/page.tsx:676-775` (`TenantContentPanel` — no review actions), `upnow-backend/src/users/users.service.ts:206` (no kyc_status promotion past pending_review).
- **Suggested fix:** add a Verify/Reject button per attached doc in `TenantContentPanel` wired to `POST /admin/kyc/documents/:id/verify` / `POST /documents/:id/reject`, and promote `users.kyc_status` when all required docs are processed.

## BUG-04 — RP KYC detail page compares document statuses against UPPERCASE values while the API returns lowercase — Verify button is dead code and status badges render unstyled

- **Severity:** low (latent functional + cosmetic; currently masked because RP uploads are self-verified to `processed` since commit bf85d39, but any `attached` RP doc could never be verified from this page)
- **Repro (observed live):**
  1. As admin open `/dashboard/admin/kyc/rental-provider/8` (individual RP with a self-verified Emirates ID).
  2. The checklist row's status badge shows lowercase `processed` on the gray fallback style (`bg-gray-100`) instead of the designed blue `PROCESSED` style — because `docStatusBadge`'s map keys are `ATTACHED/PROCESSED/COMPLETE/EXPIRED` but the API serves the lowercase enum (`upnow-backend/src/shared/enums.ts:24` — `DocumentStatus.PROCESSED = 'processed'`).
  3. The Verify button is gated on `item.status === "ATTACHED"` (uppercase) — since the API never returns uppercase, the button can never render for a genuinely pending (`attached`) document.
- **Expected:** status badges use their designed styles; an `attached` document shows the Verify button.
- **Actual:** gray fallback badges; Verify gating can never be true (dead code). The KYC-queue split panel (`admin/kyc/page.tsx:560`) has the same uppercase comparison for badge colors.
- **Suspected files:** `upnow-frontend/src/app/dashboard/(dashboard)/admin/kyc/rental-provider/[id]/page.tsx:27` (DocStatus type), `:123-136` (docStatusBadge), `:548` (Verify gating); `upnow-frontend/src/app/dashboard/(dashboard)/admin/kyc/page.tsx:15,560-563`.
- **Suggested fix:** normalize (`String(status).toLowerCase()`) before comparing, as `TenantContentPanel` already does.

## BUG-05 — Editing a unit silently WIPES its lease terms whenever the unit has amenities (and the edit form never shows saved lease terms)

- **Severity:** high (silent data loss on a routine, no-op edit; verified live on the e2e stack)
- **Repro (UI, verified live):**
  1. On `/rental-provider/dashboard/portfolio`, Add unit → fill required fields, set Min. Lease = 24, Notice Period = 90, Rent Escalation = 5, select any amenities (e.g. Gym + Parking), save. DB `units.facilities` = `{"amenities":["Gym","Parking"],"leaseTerms":{"minLeaseMonths":24,"noticePeriodDays":90,"rentEscalationPct":5}}` — correct.
  2. Reopen the unit via the row's Edit (pencil) button. The Lease Terms inputs show EMPTY (placeholders only) — the saved 24/90/5 never round-trip into the form.
  3. Click "Save Changes" without touching anything.
- **Expected:** a no-op edit preserves all stored data; the edit form shows the saved lease terms.
- **Actual:** `units.facilities` becomes a bare `["Gym","Parking"]` array — `leaseTerms` is gone (observed live: unit 114/118 `E2E-103` after the edit, while never-edited sibling units kept theirs).
- **Root cause (two halves):**
  - `upnow-frontend/src/app/rental-provider/dashboard/portfolio/page.tsx:938-940` — the edit `initial` hardcodes `minLeaseMonths: ''`, `noticePeriodDays: ''`, `rentEscalationPct: ''` (the GET /properties/:id/units response exposes only the raw `facilities` string, which `amenitiesFromUnit` parses for amenities ONLY), so the saved lease terms are never shown and `unitFormToDto` (page.tsx:251-253) converts `''` → `undefined`.
  - `upnow-backend/src/properties/properties.service.ts:739-741` — `updateUnit` rebuilds `facilities` via `buildFacilities(dto.amenities, dto.minLeaseMonths, …)` whenever `dto.amenities !== undefined`; with the lease params `undefined`, `buildFacilities` (properties.service.ts:67-84) returns the plain amenities array, erasing `leaseTerms`. Any unit WITH amenities therefore loses its lease terms on every modal save (units without amenities are spared because `unitFormToDto` omits an empty amenities array).
- **Suspected files:** `upnow-frontend/src/app/rental-provider/dashboard/portfolio/page.tsx:938-940` (lease terms not mapped back), `upnow-backend/src/properties/properties.service.ts:739-741` (facilities rebuilt without merging existing leaseTerms).
- **Suggested fix:** expose parsed `minLeaseMonths/noticePeriodDays/rentEscalationPct` on the units GET (or parse `facilities` in the frontend initial mapping), and/or make `updateUnit` merge the existing `leaseTerms` when the dto doesn't supply new ones.
- **Test:** `e2e/full-cycle/04-rp-portfolio.spec.ts` — "unit edit preserves lease terms" (test.fail-marked).

## BUG-06 — Unit furnishing is never persisted anywhere (UI offers it, DTO accepts it, then it's dropped)

- **Severity:** medium (a listing attribute the RP explicitly sets is silently discarded; the edit form then claims "Unfurnished")
- **Repro (UI, verified live):**
  1. Add a unit via the portfolio Add-unit modal with Furnishing = "Fully Furnished" (or via the /portfolio/add wizard, which DOES post `furnishing` to the API).
  2. Reopen the unit in Edit.
- **Expected:** the Furnishing select shows "Fully Furnished".
- **Actual:** always "Unfurnished". Nothing about furnishing exists in the DB — the `units` table has no furnishing column at all.
- **Root cause (three layers, any one would lose it):**
  - `upnow-frontend/src/app/rental-provider/dashboard/portfolio/page.tsx:231-256` — `unitFormToDto` never includes `form.furnishing`, and the edit `initial` mapping (page.tsx:919-942) never maps it back, so the modal path doesn't even send it.
  - `upnow-backend/src/properties/dto/create-unit.dto.ts:84` — `furnishing?: string` is whitelisted, but `properties.service.ts` `createUnit`/`updateUnit` never read `dto.furnishing` (the wizard at `portfolio/add/page.tsx:587` sends it; the backend accepts and drops it).
  - `units` table — no furnishing column exists to store it.
- **Suspected files:** `upnow-backend/src/properties/properties.service.ts` (createUnit/updateUnit ignore dto.furnishing), `upnow-frontend/src/app/rental-provider/dashboard/portfolio/page.tsx:231-256`, missing `units.furnishing` column/migration.
- **Suggested fix:** add a `furnishing` column (migration), persist it in create/update, return it on the units GET, and map it through `unitFormToDto`/edit `initial`.
- **Test:** `e2e/full-cycle/04-rp-portfolio.spec.ts` — "furnishing persists across unit edit" (test.fail-marked).

## BUG-07 — Public /listings browse card cover photo URL is double-prefixed and always 404s (broken image on every card that HAS a real photo)

- **Severity:** medium (every unit with an uploaded photo shows a broken cover image on the public browse page, in BOTH local-disk and S3 storage modes; currently invisible in prod only because prod has zero `unit_media` rows so every card uses the unsplash fallback)
- **Repro (UI, verified live on the e2e stack):**
  1. RP uploads a real photo to a unit (spec 04 — `unit_media.url` is stored ABSOLUTE, e.g. `http://localhost:3002/uploads/listings/units/116/<uuid>.png`; in S3 mode it is the full bucket URL).
  2. Publish the unit (spec 05: submit → admin approve).
  3. Open `/listings` (or `/listings?q=<building>`) — the card `<img>` src renders as `http://localhost:3002/uploads/http://localhost:3002/uploads/listings/units/116/<uuid>.png`.
  4. `GET` that URL → **404** (verified via curl and in-test `page.request.get`).
- **Expected:** the card shows the unit's real uploaded cover photo.
- **Actual:** broken image — the frontend prefixes `${BACKEND_HOST}/uploads/` onto a value that is already an absolute URL.
- **Root cause:** `upnow-frontend/src/app/listings/_ListingsView.tsx:284-286` — `const cardImg = coverPhotoUrl ? \`${BACKEND_HOST}/uploads/${coverPhotoUrl}\` : fallbackImg(...)`, while the backend (`upnow-backend/src/properties/properties.service.ts:1190-1200`, `getAllPublicListings` coverPhotoMap) returns the raw `unit_media.url`, which `storage/s3.service.ts` stores as an absolute URL in every mode (`${localBaseUrl}/uploads/${key}` locally, public bucket URL on S3). The unit DETAIL page handles the same value correctly by using it as-is (`listings/units/[id]/ListingPageClient.tsx:1423-1424` — note its `m.url.startsWith('http') ? m.url : m.url` ternary is a no-op that was clearly intended to prefix relative URLs).
- **Suspected file:** `upnow-frontend/src/app/listings/_ListingsView.tsx:284` (and the same intended-prefix pattern in `ListingPageClient.tsx:1424`).
- **Suggested fix:** use `coverPhotoUrl` as-is when it starts with `http` (or better: have the API return proxy-relative `/uploads/...` paths and prefix consistently).
- **Test:** `e2e/full-cycle/05-listing-publish.spec.ts` — "browse card cover photo URL actually serves" (test.fail-marked).

## BUG-08 — Rejected listings can never be resubmitted: the RP "Resubmit" button silently 400s and the unit is stuck in `rejected` forever

- **Severity:** high (dead-end state: the UI explicitly offers Resubmit on rejected listings, but the backend forbids it and the UI swallows the error — no path, RP or admin, can ever get a rejected unit listed again)
- **Repro (UI, verified live on the e2e stack):**
  1. RP submits a unit for listing; admin rejects it in `/dashboard/admin/listings` (unit 117, `listing_status='rejected'`).
  2. RP opens `/rental-provider/dashboard/portfolio`, expands the property — the row shows the red **Rejected** pill and a **Resubmit** button.
  3. Click Resubmit.
- **Expected:** the listing returns to the review queue (`pending`), pill flips to Pending.
- **Actual:** `PATCH /properties/13/units/117/submit-listing` returns **400 "Unit is already rejected"**; the UI gives NO feedback (no toast, no error state) and the row stays Rejected. `units.listing_status` remains `rejected`.
- **Root cause:**
  - `upnow-backend/src/properties/properties.service.ts:1329-1331` — `submitUnitListing` only allows `[ListingStatus.DRAFT, ListingStatus.EXPIRED]`, so `rejected` is refused, while the frontend renders the button for `draft | expired | rejected` (`upnow-frontend/src/app/rental-provider/dashboard/portfolio/page.tsx:492-495`, labelled "Resubmit" for rejected).
  - `page.tsx:632-637` — the `submitListing` mutation has no `onError`, so the 400 is silently dropped.
  - No admin escape hatch either: the approval queue only lists `pending|in_review` units, so a rejected unit never reappears for an admin to approve.
- **Suspected files:** `upnow-backend/src/properties/properties.service.ts:1329` (allow `REJECTED` in submitUnitListing), `upnow-frontend/src/app/rental-provider/dashboard/portfolio/page.tsx:632` (surface mutation errors).
- **Suggested fix:** include `ListingStatus.REJECTED` in the resubmittable statuses (that is plainly the intent of the "Resubmit" label), and add an error toast to the mutation.
- **Test:** `e2e/full-cycle/05-listing-publish.spec.ts` — "RP can resubmit a rejected listing via the Resubmit button" (test.fail-marked).

## BUG-09 — Property edit drops the street: never prefilled, and every save recomposes full_address without it
- **Severity:** high
- **Repro:** create a property with a street via /portfolio/add → portfolio → Edit Property → the Street field is EMPTY → save without touching anything → `properties.full_address` loses the street segment (e.g. "12 E2E Boulevard, Al Raffa, Dubai" → "Al Raffa, Dubai").
- **Expected:** edit form prefills the stored street; a no-op save leaves full_address unchanged.
- **Actual:** the edit `initial` omits `street` (portfolio/page.tsx:893-910), and `formToCreateDto` (portfolio/page.tsx:209-213) recomposes `fullAddress = [street(''), communityName, emirateName]` — wiping the street on every save. The dedicated `street` DTO field is never sent either. Same duplicated mapper in `src/app/dashboard/(dashboard)/manager/properties/page.tsx`.
- **Test:** `07-rp-edits.spec.ts` — "property edit preserves the street" (test.fail).

## BUG-10 — Changing a unit's rent silently overwrites stored custom fees with 5% defaults
- **Severity:** medium
- **Repro:** unit with custom security deposit (e.g. 5432) → Edit Unit → change ONLY the rent → save → deposit/admin fee/commission are recalculated to 5% of the new rent; the custom values are gone.
- **Expected:** stored fees stay unless the user edits them (or at least a visible warning).
- **Actual:** `UnitFormModal.tsx:414-423` `upd('rentalPrice')` auto-recalcs deposit/adminFee/commission and resets ejari on every rent keystroke, including in edit mode.
- **Test:** `07-rp-edits.spec.ts` — "changing rent keeps stored custom fees" (test.fail).

## BUG-11 — Cleared unit fields are silently kept: '' maps to undefined so the PATCH omits them
- **Severity:** medium
- **Repro:** Edit Unit → clear the View field (or unit name, floor, premise no., description…) → save → reopen: the old value is back.
- **Expected:** clearing a field clears it (NULL) or the form says it can't be cleared.
- **Actual:** `unitFormToDto` (portfolio/page.tsx:231-256) maps `'' → undefined`; backend `updateUnit` only assigns `!== undefined` fields, so the clear is dropped. Un-ticking all amenities is equally ignored.
- **Test:** `07-rp-edits.spec.ts` — "clearing the view field actually clears it after save" (test.fail).

## BUG-12 — A unit cannot be converted to Studio: bedrooms 'Studio' is dropped from the PATCH (and NULL bedrooms prefills as '1')
- **Severity:** medium
- **Repro:** Edit a 1BR unit → set Bedrooms = Studio → save → reopen: it is 1BR again. Conversely a Studio unit opens prefilled as "1".
- **Expected:** Studio round-trips (stored as NULL or a dedicated value).
- **Actual:** create maps Studio → undefined → NULL, but the edit initial maps NULL → '1' (portfolio/page.tsx:926) and unitFormToDto sends `bedrooms: undefined` for Studio so the PATCH keeps the old count. '6+' bedrooms / '5+' bathrooms produce `Number('6+') = NaN` → silently dropped too.
- **Test:** `07-rp-edits.spec.ts` — "setting bedrooms to Studio round-trips" (test.fail).

## BUG-13 — A customer created without a contract is unreachable: detail page 403s and the list hides them
- **Severity:** high
- **Repro:** RP → Customers → Add customer (name/email/phone) → save succeeds → the customer is NOT in the list and /tenants/<id> returns 403.
- **Expected:** a just-created customer is visible and editable — that's where the RP would complete KYC details.
- **Actual:** `contracts.service.ts` (~956/1016) scopes tenant list/detail to tenants having a contract with this RP, so a contract-less customer is orphaned. The UI flow that creates them offers no way to use them afterwards except the contract wizard's tenantId deep-link.
- **Test:** `07-rp-edits.spec.ts` — "freshly created customer is reachable on the Customers pages" (test.fail).

## BUG-14 — Clearing a customer's email is silently ignored while every other cleared field nulls out
- **Severity:** low
- **Repro:** Customers → edit → clear Email → save: no error, looks saved — but the old email silently remains. Clearing phone/EID/nationality DOES null them.
- **Expected:** consistent semantics + feedback ("email can't be removed" or actually clear it).
- **Actual:** `CustomerForm.tsx:58-64` sends `email: trim() || undefined` (kept) vs `|| null` (cleared) for the rest. Create mode also REQUIRES email while edit mode lets it look clearable.
- **Test:** `07-rp-edits.spec.ts` — "clearing the customer email either clears or errors" (test.fail).

## BUG-15 — RP profile save cross-wires poaPersonName := authorizedSignatoryName
- **Severity:** high (silent data corruption)
- **Repro:** RP profile page → set "Authorized signatory name" (or leave it blank) → save → `rental_providers.poa_person_name` is overwritten with the signatory name (or NULLed when blank), regardless of the POA section and of what onboarding stored.
- **Expected:** poaPersonName comes from its own field; signatory name is a different column.
- **Actual:** `profile/page.tsx:258` sends `poaPersonName: data.authorizedSignatoryName || null` on every save.
- **Test:** `07-rp-edits.spec.ts` — "turning POA off clears the POA person name" (test.fail).

## BUG-16 — Contract wizard 400s for any unit with stored fees: fee values are sent as strings
- **Severity:** critical (RP cannot create a contract from the wizard outside the lead-plan path)
- **Repro:** Contracts → New → pick property/unit (no lead) → Create Contract → red wall of raw validator text: "securityDepositAmount must be a number…, adminFee…, ejariFee…". Confirmed by replaying the POST: string fees → 400, numeric fees → 201.
- **Expected:** wizard converts unit fee values to numbers (the API serializes numerics as strings like "5600.00"); errors are human-readable.
- **Actual:** `contracts/new/page.tsx:495-497` forwards `su?.securityDeposit / adminFee / ejariFeeFils` raw from the units API into POST /contracts. The lead-plan path divides fils by 100 (numbers) and works — so this only bites the direct-unit path, which is every walk-in tenancy.
- **Suggested fix:** `Number(...)` the three fields (and annualRent) when building the payload.
- **Test:** `07-rp-edits.spec.ts` — "contract wizard creates a contract" (test.fail) + API-fallback test proving the payload typing is the only difference.

## BUG-17 — RP profile Save is silently dead until a gender is chosen (a field onboarding never collects)
- **Severity:** high
- **Repro:** fresh individual RP (onboarded + compliant) → profile page → click "Save profile" without touching anything → nothing happens: no request, no toast, no visible error (focus quietly jumps to the Gender select).
- **Expected:** a no-change save succeeds (gender is optional in the DB) or a clear error points at the field.
- **Actual:** the zod schema has `gender: z.enum([...]).optional()` but the registered select's empty value is `""` — not in the enum and not undefined — so submit is blocked client-side. Onboarding never collects gender, so EVERY fresh RP profile starts in this state.
- **Suggested fix:** `.or(z.literal(''))` / preprocess '' → undefined, and surface field errors near the Save button.
- **Test:** `07-rp-edits.spec.ts` — "profile no-change save…" (test.fail) + green companion test proving save works once gender is set.

## BUG-18 — ~~The profile page's NATIONALITIES list contains trade-license authorities~~ INVALID (false positive)

> **Correction:** the authority entries live in a separate `UAE_LICENSING_AUTHORITIES` constant directly below `NATIONALITIES` (profile/page.tsx:43-61); the audit agent misread the adjacent block. The nationality dropdown only offers demonyms. No action needed.

- **Severity:** medium (data quality)
- **Repro:** RP profile → Nationality dropdown → scroll: "Dubai Silicon Oasis Authority", "Dubai Airport Free Zone (DAFZA)", "Abu Dhabi Free Zone Authority (ADFZA)", "Sharjah Free Zone Authority (SHAMS)" are selectable as nationalities.
- **Actual:** `profile/page.tsx:24` NATIONALITIES const has license-authority entries pasted into the demonym list (and the list is also truncated after "Korean"). A user can be saved with nationality = "Dubai Airport Free Zone (DAFZA)".
- **Suggested fix:** use the shared nationality list used by onboarding (demonyms, migration 0036 convention).

## BUG-19 — Document-expiry cron crashes on every run: enum document_owner_type has no 'technician'
- **Severity:** medium (backend noise + the expiry sweep never completes)
- **Repro:** watch backend logs: `[Scheduler] QueryFailedError: invalid input value for enum document_owner_type: "technician"` from `DocumentsService.flagExpiredDocuments` (documents.service.ts:734) on each scheduled run.
- **Expected:** the cron filters by owner types that exist in the enum (or the enum gains 'technician').
- **Actual:** the query passes 'technician' as a document_owner_type; Postgres rejects (22P02) and the whole sweep aborts — so document expiry flagging silently never happens.

## BUG-20 — RP can NEVER invite a manager through the UI: invite modal posts 19 permission flags, backend whitelists 12 → always 400
- **Severity:** critical
- **Repro:** RP → Settings → Team → Invite Manager → fill email/name, toggle any permissions → Send Invite → red error in the modal, no invite created.
- **Actual:** `TeamPanel.tsx:126-177` (metaDefaults + zod) always sends all 19 snake_case flags in `metadata`; `upnow-backend/src/invitations/dto/send-invite.dto.ts:12-25` ManagerMetaDto has only 12 (missing can_publish_listings, can_create_contracts, can_sign_documents, can_sign_addenda, can_act_as_poa, can_manage_maintenance, can_view_reports) and main.ts ValidationPipe has forbidNonWhitelisted:true → 400 "property … should not exist". The accept flow and UpdateManagerPermissionsDto support all 19 — only the send DTO lags.
- **Test:** `08-team-invites.spec.ts` — modal invite (test.fail) + API fallback with the 12 whitelisted flags.

## BUG-21 — Every accepted invite (manager AND technician) lands on a 404: success screen redirects to /dashboard, which has no page
- **Severity:** high
- **Repro:** accept any invite at /invite/<token> → "Welcome to UpNow!" → 1.5s later URL is /dashboard showing the not-found page.
- **Actual:** `src/app/invite/[token]/page.tsx:110` `router.push('/dashboard')`; no page exists at /dashboard (only role subroutes) and middleware passes it through. Should push the role home (dashboardPath(role)).
- **Tests:** `08-team-invites.spec.ts` (manager) and `09-service-provider.spec.ts` (technician), both test.fail.

## BUG-22 — Individual landlords show as "Landlord #<id>" in the manager portal and admin team oversight
- **Severity:** medium
- **Repro:** manager invited by an individual RP (no company name) → manager portal "Your Landlords" card / admin /dashboard/admin/team both display "Landlord #13" — the manager can't tell who they work for.
- **Actual:** `upnow-backend/src/manager/manager.controller.ts:196` and `upnow-backend/src/admin/admin-team.controller.ts:57` do `companyName ?? 'Landlord #'+id` with no fallback to the RP user's display name.
- **Test:** `08-team-invites.spec.ts` (test.fail).

## BUG-23 — Admin Service tab has NO KYC review UI for service providers: every SP is stuck pending forever
- **Severity:** high (service-provider scope — REPORT-ONLY per current task scope)
- **Repro:** onboard an SP → admin → /dashboard/admin/kyc?tab=service → select the SP: summary grid + "Full KYC review — coming soon"; no document list, no Verify, no Mark Compliant.
- **Actual:** `admin/kyc/page.tsx:623-672` SpContentPanel is summary-only; backend endpoints exist unused (PATCH /admin/kyc/service-providers/:id/compliance, POST /admin/kyc/documents/:id/verify); SP uploads are NOT self-verified (documents.service.ts:403), so docs stay `attached` and compliance stays `pending_review` permanently.
- **Test:** `09-service-provider.spec.ts` (test.fail).

## BUG-24 — "Revert to draft" on the contract v2 Issue step is dead: no backend route, the UI flips locally and lies
- **Severity:** medium
- **Repro:** open an issued contract's v2 page → Issue waypoint → "Revert to draft" → page shows Draft with an "Issue contract" button, but PATCH /api/contracts/:id/revert returns 404; reload shows Issued again.
- **Actual:** `contracts/[id]/v2/page.tsx:2593-2599` onRevertToDraft swallows the failure and flips local state; `upnow-backend/src/contracts/contracts.controller.ts` has no revert route. Compounding: POST /contracts creates rows born ISSUED (contracts.service.ts:1200), so this dead button is the only rollback affordance.
- **Test:** `10-contract-cycle.spec.ts` (test.fail).
