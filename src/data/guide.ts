// ── content block types ─────────────────────────────────────────────────────

export type Block =
  | { type: 'text'; md: string }
  | { type: 'heading'; text: string; level?: 2 | 3 }
  | { type: 'note'; md: string; variant?: 'info' | 'warning' | 'tip' | 'success' }
  | { type: 'steps'; title?: string; steps: Step[] }
  | { type: 'lifecycle'; states: LifecycleState[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'grid'; items: GridItem[] }
  | { type: 'code'; content: string; lang?: string }
  | { type: 'diagram'; src: string; title: string; description?: string; aspectRatio?: string }
  | { type: 'divider' };

export interface Step {
  number?: number;
  label: string;
  description: string;
  actor?: string;
  note?: string;
}

export interface LifecycleState {
  label: string;
  color?: 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'gray';
  description?: string;
}

export interface GridItem {
  icon: string;
  title: string;
  desc: string;
  badge?: string;
  badgeColor?: string;
}

// ── section structure ────────────────────────────────────────────────────────

export interface GuideSection {
  id: string;
  title: string;
  description: string;
  blocks: Block[];
  tags?: string[];
}

export interface GuideCategory {
  id: string;
  label: string;
  icon: string;
  sections: GuideSection[];
}

// ── content ──────────────────────────────────────────────────────────────────
// CEO-FRIENDLY GUIDE — plain language, workflow-focused.
// Rental content is kept in step with the Platform Flow document
// ("Platform Flow — by Action", 54 steps across phases A–H). When the flow doc
// changes, update the matching section here.

export const GUIDE_CATEGORIES: GuideCategory[] = [

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'overview',
    label: 'Overview',
    icon: '🏠',
    sections: [
      {
        id: 'what-is-upnow',
        title: 'What Is UpNow?',
        description: 'A plain-language introduction to the platform and what it does.',
        tags: ['intro', 'overview', 'marketplace'],
        blocks: [
          {
            type: 'text',
            md: 'UpNow is a **UAE-based digital marketplace** with two sides running on one platform.',
          },
          {
            type: 'grid',
            items: [
              {
                icon: '🏢',
                title: 'Rent a Space',
                desc: 'Property owners list apartments, offices, and commercial units. Customers browse, book a viewing, submit documents, agree a payment plan, and sign — all online. Live end to end.',
                badge: 'Live',
                badgeColor: 'green',
              },
              {
                icon: '🔧',
                title: 'Book a Home Service',
                desc: 'Customers book home services (AC, plumbing, cleaning, painting, electrical) from verified companies. A technician comes to their door. Payment is held safely until the job is done.',
                badge: 'In development',
                badgeColor: 'amber',
              },
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'UpNow is built for the **UAE market**. All prices are in **AED (UAE Dirham)**. The platform supports Arabic and English.',
          },
        ],
      },
      {
        id: 'who-uses-it',
        title: 'Who Uses UpNow?',
        description: 'The six types of people on the platform and what each one does.',
        tags: ['roles', 'users', 'permissions'],
        blocks: [
          {
            type: 'text',
            md: 'There are **six roles** on UpNow. Every account belongs to exactly one role. The role determines what you see when you log in.',
          },
          {
            type: 'table',
            headers: ['Who', 'What They Do', 'How They Join'],
            rows: [
              ['🧑 Customer', 'Rents properties and/or books home services', 'Self-register at sign-up'],
              ['🏢 Rental Provider', 'Owns the portfolio. Handles the commercial side — pricing, payment plans, cheques, signing, registration', 'Self-register, then approved by Admin'],
              ['📋 Asset Manager', 'Runs day-to-day operations for a Rental Provider — viewings, document checks, inspections, renewals, move-outs', 'Invited by email from a Rental Provider'],
              ['🔧 Service Provider', 'Company offering home services (AC, cleaning, etc.)', 'Self-register, then approved by Admin'],
              ['👷 Technician', 'Field worker who carries out the service jobs', 'Invited by email from a Service Provider'],
              ['⚙️ Admin', 'UpNow staff — approves providers and listings, oversees the platform', 'Internal access only'],
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'The **Rental Provider and the Asset Manager share one workspace.** Almost every operational action can technically be done by either — it depends on which permissions the provider grants the manager (Properties, Listings, Leads, Viewings, Contracts, Payments). In practice the provider keeps the money decisions and the manager runs operations.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'A role is chosen at registration and cannot be changed by the user. Only an Admin can reassign a role.',
          },
        ],
      },
      {
        id: 'lifecycle-at-a-glance',
        title: 'The Rental Lifecycle at a Glance',
        description: 'The eight phases a property moves through, from provider sign-up to lease end.',
        tags: ['lifecycle', 'phases', 'flow', 'journey'],
        blocks: [
          {
            type: 'text',
            md: 'Everything on the rental side of UpNow is one long chain of **54 steps in 8 phases**. Each phase hands off to the next.',
          },
          {
            type: 'lifecycle',
            states: [
              { label: 'A · Accounts & Onboarding', color: 'gray', description: 'Provider registers, uploads KYC, is approved, and sets up rules' },
              { label: 'B · Portfolio & Listing', color: 'gray', description: 'Property and units created, submitted, approved, published' },
              { label: 'C · Lead & Viewing', color: 'blue', description: 'Customer books a viewing, attends, expresses interest, submits documents' },
              { label: 'D · Offer, Plan & Cheques', color: 'blue', description: 'Payment plan issued and accepted, cheques recorded and confirmed' },
              { label: 'E · Contract Execution', color: 'purple', description: 'Signatures, registration, utility, move-in inspection' },
              { label: 'F · Live Lease & Money', color: 'green', description: 'Cheques clear, charges, receivables, oversight' },
              { label: 'G · Renewal', color: 'amber', description: 'Offer issued, accepted or declined, new term signed and registered' },
              { label: 'H · Exit', color: 'red', description: 'Termination, move-out inspection, settlement, unit re-listed' },
            ],
          },
          {
            type: 'heading',
            text: 'Three approval gates',
            level: 3,
          },
          {
            type: 'table',
            headers: ['Gate', 'Where', 'Who decides', 'What it unblocks'],
            rows: [
              ['Gate 1 — Compliance', 'Phase A', 'UpNow Admin', 'The provider can operate at all'],
              ['Gate 2 — Listing', 'Phase B', 'UpNow Admin', 'The unit becomes publicly visible'],
              ['Gate 3 — Cheques collected', 'Phase D', 'Rental Provider / Manager', 'The contract is created automatically'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: '**A unit only goes public if BOTH are true** — the listing is approved *and* the provider is compliant. If a provider later falls out of compliance, their published units stop being visible.',
          },
        ],
      },
      {
        id: 'getting-started',
        title: 'Getting Started — Signing Up & Logging In',
        description: 'How any new user creates an account and accesses the platform.',
        tags: ['signup', 'login', 'register', 'account', 'otp'],
        blocks: [
          {
            type: 'note',
            variant: 'info',
            md: 'Sign-up and login happen in a **pop-up on the homepage** — there are no separate registration pages. Login is by **one-time code (OTP)**: enter your email, receive a code, enter the code.',
          },
          {
            type: 'steps',
            title: 'For Customers',
            steps: [
              { label: 'Go to upnow.ae', description: 'You can browse listings and open any unit without an account.', actor: 'Customer' },
              { label: 'Sign up', description: 'Open the sign-up pop-up and choose "Customer". Enter your name, email, and phone.', actor: 'Customer' },
              { label: 'Verify with the code', description: 'A one-time code is emailed to you. Enter it to activate the account.', actor: 'Customer' },
              { label: 'You are in', description: 'You land back where you were and can book a viewing immediately.', actor: 'Customer' },
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'A customer can also stay **anonymous until they book a viewing** — the account is created as part of that first booking.',
          },
          { type: 'divider' },
          {
            type: 'steps',
            title: 'For Rental Providers & Service Providers',
            steps: [
              { label: 'Register as a provider', description: 'Select Rental Provider or Service Provider in the sign-up pop-up and verify with the emailed code.', actor: 'Provider' },
              { label: 'Complete the profile', description: 'Business details plus KYC documents — trade licence, Emirates ID, ownership proof. This moves you to "pending review".', actor: 'Provider' },
              { label: 'Wait for Gate 1', description: 'An UpNow Admin reviews the submission and marks it compliant, action required, or paused.', actor: 'UpNow Admin' },
              { label: 'Set up your rules', description: 'Once compliant: fee rules, penalties, contract templates, and your team. These feed every payment plan and settlement later.', actor: 'Provider' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Rules are not optional housekeeping. A **payment plan cannot be built without fee rules**, and **settlement deductions auto-fill from the penalty rules**. Set them up before your first lead.',
          },
          { type: 'divider' },
          {
            type: 'steps',
            title: 'For Asset Managers & Technicians (Invite-Only)',
            steps: [
              { label: 'Receive an invitation email', description: 'Your Rental Provider or Service Provider sends the invite from their Team section.', actor: 'Invitee' },
              { label: 'Open the link', description: 'The link takes you to UpNow to accept and finish setting up your account.', actor: 'Invitee' },
              { label: 'Log in', description: 'You land directly on your role-specific dashboard, scoped to what you were granted.', actor: 'Invitee' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'If you are **already logged in as someone else** when you open an invite link, UpNow will tell you and ask you to sign out first, so the invitation is not accepted into the wrong account.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'customer',
    label: 'Customer',
    icon: '👤',
    sections: [
      {
        id: 'customer-renting',
        title: 'How to Rent a Property',
        description: 'The full journey: from browsing a listing to an active tenancy.',
        tags: ['rental', 'contract', 'viewing', 'lease', 'kyc', 'cheques', 'move-in'],
        blocks: [
          {
            type: 'note',
            variant: 'success',
            md: '✅ **This journey is live end to end.** Every step below runs inside the platform.',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Browse and open a unit', description: 'Filter by category, space type, emirate, bedrooms, and price. You can open any unit detail page without logging in.', actor: 'Customer' },
              { label: 'Book a viewing', description: 'Pick a date and time on the unit page. This creates your enquiry with the provider and puts the viewing in their diary.', actor: 'Customer' },
              { label: 'Confirm or reschedule', description: 'Either side can propose a new time. You get an email when the viewing is rescheduled.', actor: 'Customer' },
              { label: 'Attend the viewing', description: 'The provider or their Asset Manager marks the viewing as visited afterwards.', actor: 'Customer' },
              { label: 'Say you are interested', description: 'Once you confirm interest, the provider asks you for your documents.', actor: 'Customer' },
              { label: 'Upload your documents', description: 'Passport, Emirates ID, visa, and anything else requested. You upload them against the exact slots the provider asked for.', actor: 'Customer' },
              { label: 'Documents are checked', description: 'The Asset Manager reviews each one and either accepts it or asks you for a replacement.', actor: 'Asset Manager' },
              { label: 'Receive the payment plan', description: 'You get an emailed plan showing rent, deposit, commission, admin fee, registration, and VAT, split across the agreed number of cheques.', actor: 'Customer' },
              { label: 'Accept and hand over cheques', description: 'Confirm the plan and provide the post-dated cheques. The provider records each one.', actor: 'Customer' },
              { label: 'Your contract is created', description: 'As soon as the provider confirms all cheques are collected, the tenancy contract is generated automatically — you do not need to request it.', actor: 'System' },
              { label: 'Sign the contract', description: 'You receive a private link by email. It opens your signing page directly — no login needed.', actor: 'Customer' },
              { label: 'Provider counter-signs and registers', description: 'The provider signs, then files the tenancy registration and uploads the certificate.', actor: 'Rental Provider' },
              { label: 'Submit your utility proof', description: 'Upload your DEWA (or local utility) proof. The registration certificate is needed for this, which is why it comes first.', actor: 'Customer' },
              { label: 'Sign the move-in inspection', description: 'The Asset Manager inspects the unit and sends you the report. You review the condition notes and photos and sign.', actor: 'Customer' },
              { label: 'Your tenancy is active', description: 'When the manager counter-signs the move-in report, the lease activates automatically and appears under My Spaces.', actor: 'System' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'The order matters: **Sign → Registration → Utility → Move-in → Active.** Utility proof needs the registration certificate, and the lease only becomes active on the **move-in counter-signature** — not when you sign the contract.',
          },
        ],
      },
      {
        id: 'customer-renewal',
        title: 'Renewing or Leaving at the End of Your Term',
        description: 'What happens as your lease approaches its end date — renew, or move out.',
        tags: ['renewal', 'move-out', 'termination', 'settlement', 'deposit'],
        blocks: [
          {
            type: 'text',
            md: 'Before your lease expires the provider prepares a renewal offer. You then take one of two paths.',
          },
          {
            type: 'steps',
            title: 'If you renew',
            steps: [
              { label: 'You receive the renewal notice', description: 'The Asset Manager drafts the renewal and sends it. The notice arrives by email with the proposed new term and rent.', actor: 'Asset Manager' },
              { label: 'Review it in My Spaces', description: 'Log in and open My Spaces. A renewal banner on your current tenancy shows the proposed new term against your current one.', actor: 'Customer' },
              { label: 'Accept', description: 'Accepting moves the renewal forward to documents and payment.', actor: 'Customer' },
              { label: 'Refresh any expired documents', description: 'If your passport, Emirates ID, or visa has expired since you moved in, you upload the new copy now.', actor: 'Customer' },
              { label: 'Confirm the new payment plan', description: 'You receive the plan for the new term and confirm it by uploading your initial payment reference.', actor: 'Customer' },
              { label: 'Cheques are recorded', description: 'The Asset Manager checks your reference and records the new post-dated cheques.', actor: 'Asset Manager' },
              { label: 'Sign the new contract', description: 'You sign, then the Rental Provider signs.', actor: 'Customer' },
              { label: 'Renewal goes active', description: 'The Asset Manager files the registration for the new term. Your renewed tenancy activates at that point.', actor: 'System' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Renewals are the one part of the journey that is **not** reachable from a secure email link — you accept or decline from **My Spaces** while logged in. The emailed notice tells you the offer exists; the decision happens in the dashboard.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'A renewal usually costs less to start than a new lease — there is **no fresh security deposit**, and commission is dropped where the provider owns the unit.',
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'A **renewal activates on registration**. A **new lease activates on the move-in counter-signature**. Different triggers — do not expect a move-in inspection on a renewal.',
          },
          { type: 'divider' },
          {
            type: 'steps',
            title: 'If you leave',
            steps: [
              { label: 'Decline the renewal, or request termination', description: 'You can decline the renewal offer, or ask to end the lease early. Either way you are asked to give a reason from a fixed list.', actor: 'Customer' },
              { label: 'Move-out date is set', description: 'The provider confirms the effective date and the Asset Manager prepares the move-out.', actor: 'Asset Manager' },
              { label: 'Sign the move-out inspection', description: 'The manager inspects the unit and sends you the report. You review the condition against your move-in report and sign.', actor: 'Customer' },
              { label: 'Upload your bill clearance', description: 'Provide proof that your utility account is settled and closed.', actor: 'Customer' },
              { label: 'Review the final settlement', description: 'You receive the settlement — deposit, less any priced deductions for damage or unpaid amounts — and sign it.', actor: 'Customer' },
              { label: 'Deposit returned, lease ends', description: 'The balance is refunded and the lease moves to your ended leases.', actor: 'System' },
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'Deductions are not invented at the end. They are **priced from the penalty and restoration rules** the provider set up before you ever moved in, and compared against your signed move-in report.',
          },
        ],
      },
      {
        id: 'customer-secure-links',
        title: 'Secure Links — Acting Without Logging In',
        description: 'How the emailed links work, what each one opens, and how long it lasts.',
        tags: ['portal', 'magic link', 'secure link', 'sign', 'upload', 'no login'],
        blocks: [
          {
            type: 'text',
            md: 'Several steps reach you as a **private link by email** rather than asking you to log in. The link identifies you, so it opens straight onto the one thing you need to do.',
          },
          {
            type: 'table',
            headers: ['Link opens', 'What you do there'],
            rows: [
              ['Your documents page', 'Upload the documents your provider asked for'],
              ['Contract review', 'Read the full contract and sign it'],
              ['Move-in report', 'Review the condition of the unit and sign'],
              ['Move-out report', 'Review the exit condition and sign'],
              ['Final settlement', 'Review the deposit and deductions and sign'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Each link is **scoped to one action** and **expires**. A signing link will not show you your move-out report, and an expired link will not open — ask your provider to send a fresh one.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'The document upload page is **request-scoped**: you only see the slots your provider explicitly asked for, never the whole catalogue. If they have not requested anything yet, the page tells you there is nothing to upload.',
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'Once you have signed the contract, the link stops showing the contract for review and becomes a **hand-over page** instead — your documents, ready to open or download, with no login needed.',
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Renewals are the exception. There is no secure link for accepting a renewal — you do that from **My Spaces** while logged in.',
          },
        ],
      },
      {
        id: 'customer-services',
        title: 'How to Book a Home Service',
        description: 'Step-by-step: from finding a service to having it completed at your door.',
        tags: ['booking', 'service', 'technician', 'job'],
        blocks: [
          {
            type: 'note',
            variant: 'warning',
            md: '🚧 **Service booking is still in development.** The services browse page is live. Booking checkout and job tracking are not yet available — the flow below is the intended experience.',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Browse services', description: 'Go to the Services page. Choose a category — AC, Cleaning, Plumbing, Electrical, Painting, Pest Control, etc.', actor: 'Customer' },
              { label: 'Choose a provider', description: 'See verified providers with ratings, pricing, and availability. Two types: Fixed Price (price shown upfront) or Inspection-Based (technician visits first and quotes).', actor: 'Customer' },
              { label: 'Pick a date & time', description: 'Select a convenient slot. Confirm your address.', actor: 'Customer' },
              { label: 'Pay securely', description: 'Payment is held in escrow — it is only released to the provider after the job is completed to your satisfaction.', actor: 'Customer' },
              { label: 'Technician arrives', description: 'You get a notification when the technician is on the way and when they arrive.', actor: 'Customer' },
              { label: 'Job completed', description: 'The technician uploads photos of the completed work. You confirm it is done. Payment releases automatically.', actor: 'Customer' },
              { label: 'Leave a review', description: 'Rate the technician and the service provider. This helps other customers choose the right provider.', actor: 'Customer' },
            ],
          },
          {
            type: 'heading',
            text: 'Fixed Price vs. Inspection-Based',
            level: 3,
          },
          {
            type: 'table',
            headers: ['Type', 'How it works', 'Examples'],
            rows: [
              ['Fixed Price', 'Price shown upfront. Pay before the technician arrives. Best when the job scope is clear.', 'Home cleaning, Pest control, Painting (per room)'],
              ['Inspection-Based', 'Technician visits first, assesses the problem, sends you a quote. You approve before any payment.', 'AC repair, Plumbing fault, Electrical work, Major renovation'],
            ],
          },
        ],
      },
      {
        id: 'customer-dashboard',
        title: 'Your Customer Dashboard',
        description: 'Everything you can see and do after logging in as a customer.',
        tags: ['dashboard', 'my spaces', 'contracts', 'viewings', 'documents'],
        blocks: [
          {
            type: 'text',
            md: 'The customer side is deliberately small. Your side menu has just three entries — everything else opens from your tenancy.',
          },
          {
            type: 'table',
            headers: ['In your menu', 'What You Can Do'],
            rows: [
              ['My Spaces', 'Your tenancy — rent schedule, cheque dates, deposit, documents to download, and the **renewal offer** when one is open. This is your home page.'],
              ['My Services', 'Browse home services (browsing only for now).'],
              ['My Profile', 'Your personal details and contact information.'],
            ],
          },
          {
            type: 'table',
            headers: ['Also available', 'How you reach it'],
            rows: [
              ['Your contracts', 'From My Spaces — sign a pending contract, open the move-in or move-out report, print or download.'],
              ['Your documents', 'From My Spaces — see which uploads are accepted and which need replacing.'],
              ['Your viewings', 'From My Spaces — scheduled viewings and any reschedules.'],
              ['Notifications', 'Your account menu — everything the platform has sent you.'],
              ['Wishlist', 'Your account menu — units you saved while browsing.'],
              ['Help Center', 'Your account menu — support and frequently asked questions.'],
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'There is no separate customer overview page — **My Spaces is your home**. The renewal decision lives there too, as a banner on your tenancy, rather than as a section of its own.',
          },
          {
            type: 'table',
            headers: ['Not yet available', 'Notes'],
            rows: [
              ['My Bookings', 'Tracking home service jobs — status, technician, proof of work.'],
              ['Maintenance requests', 'Logging a maintenance issue against your tenancy.'],
            ],
          },
          {
            type: 'heading',
            text: 'Documents you can download for a lease',
            level: 3,
          },
          {
            type: 'table',
            headers: ['Document', 'When it appears'],
            rows: [
              ['Payment receipts', 'As payments are received'],
              ['Tenancy contract', 'Once you have signed it'],
              ['Contract registration certificate', 'Once your provider has filed the registration and uploaded it'],
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'Each row behaves the same way — the **title opens the document in a new tab** to read, and the separate **Download** button saves it. Files are named so they identify themselves in your downloads folder, e.g. `Tenancy-Contract-Unit-317-CID-394.pdf`.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'space-provider',
    label: 'Rental Provider',
    icon: '🏢',
    sections: [
      {
        id: 'rp-onboarding',
        title: 'Getting Approved & Setting Your Rules',
        description: 'Phase A — registration, compliance approval, and the rules that drive everything downstream.',
        tags: ['onboarding', 'kyc', 'compliance', 'rules', 'gate'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Register and verify', description: 'Sign up as a Rental Provider and confirm the one-time code sent to your email.', actor: 'Rental Provider' },
              { label: 'Complete your profile and KYC', description: 'Business details, trade licence, Emirates ID, and ownership proof. Your account moves to "pending review".', actor: 'Rental Provider' },
              { label: 'Gate 1 — Admin reviews compliance', description: 'An UpNow Admin marks you compliant, action required, or paused. You cannot publish a unit until you are compliant.', actor: 'UpNow Admin' },
              { label: 'Set up your rules', description: 'Fee rules, penalty rules, contract templates, and your team.', actor: 'Rental Provider' },
            ],
          },
          {
            type: 'heading',
            text: 'What each rule feeds',
            level: 3,
          },
          {
            type: 'table',
            headers: ['Rule', 'Where it is used later'],
            rows: [
              ['Fee rules (commission, admin fee, registration)', 'Every payment plan you build for a lead'],
              ['VAT treatment', 'Charge lines on the plan and the invoice'],
              ['Penalty rules', 'Bounce fees on a failed cheque, and deductions on the final settlement'],
              ['Contract templates & addendums', 'The contract issued once cheques are confirmed'],
              ['Team & permissions', 'What your Asset Manager is allowed to do'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'This is why rules come **before** listings rather than sitting in a settings menu you visit later — a plan cannot be priced without them.',
          },
        ],
      },
      {
        id: 'rp-listing',
        title: 'Listing a Property',
        description: 'Phase B — creating property and units, and getting them published.',
        tags: ['property', 'listing', 'units', 'publish', 'gate'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Create the property and its units', description: 'Building details, then each rentable unit — number, type, size, bedrooms, bathrooms, amenities, photos. The listing starts as a draft.', actor: 'Rental Provider' },
              { label: 'Price the unit', description: 'Annual rent in AED, the number of cheques accepted, and the security deposit.', actor: 'Rental Provider' },
              { label: 'Submit the listing', description: 'The draft moves to pending and goes to UpNow for review.', actor: 'Rental Provider' },
              { label: 'Gate 2 — Admin reviews', description: 'An UpNow Admin publishes or rejects the listing.', actor: 'UpNow Admin' },
              { label: 'The unit goes public', description: 'It appears on the marketplace and can receive viewings.', actor: 'System' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'A unit is only visible when the listing is **published AND you are compliant**. Both conditions, every time.',
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'An Asset Manager can create properties and submit listings on your behalf if you grant them the **Properties** and **Listings** permissions.',
          },
        ],
      },
      {
        id: 'rp-leads',
        title: 'Leads, Viewings & Documents',
        description: 'Phase C — from the first enquiry to a document-verified customer.',
        tags: ['leads', 'viewing', 'pipeline', 'kyc', 'documents'],
        blocks: [
          {
            type: 'text',
            md: 'A lead is created automatically the moment a customer books a viewing. Everything from there happens on the lead record.',
          },
          {
            type: 'lifecycle',
            states: [
              { label: 'New', color: 'gray', description: 'Viewing booked' },
              { label: 'Contacted', color: 'blue', description: 'You have reached out' },
              { label: 'Interested', color: 'blue', description: 'Viewing done, customer wants the unit' },
              { label: 'Documents', color: 'amber', description: 'KYC requested and under review' },
              { label: 'Plan shared', color: 'amber', description: 'Payment plan issued' },
              { label: 'Cheques submitted', color: 'purple', description: 'Cheques handed over and recorded' },
              { label: 'Converted', color: 'green', description: 'Contract created' },
            ],
          },
          {
            type: 'steps',
            steps: [
              { label: 'Contact the lead', description: 'Reach out and move the lead to contacted.', actor: 'Rental Provider / Manager' },
              { label: 'Confirm or reschedule the viewing', description: 'Either side can move the time. The customer is emailed on a reschedule.', actor: 'Rental Provider / Manager' },
              { label: 'Mark the viewing visited', description: 'After the visit, record that it happened and whether the customer is interested.', actor: 'Asset Manager' },
              { label: 'Request KYC documents', description: 'Choose the exact documents you need. The customer sees those slots to fill.', actor: 'Rental Provider / Manager' },
              { label: 'Review what comes in', description: 'Accept each document, or reject it and request a replacement. You can request additional documents at any point.', actor: 'Asset Manager' },
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'Name the requested document the same way the customer sees it. The picker name and the upload slot label should match, or the customer will not know which file goes where.',
          },
        ],
      },
      {
        id: 'rp-plan-cheques',
        title: 'Payment Plan & Cheques',
        description: 'Phase D — pricing the deal, collecting cheques, and triggering the contract.',
        tags: ['payment plan', 'cheques', 'pdc', 'commission', 'vat', 'deposit'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Build and issue the plan', description: 'Rent, security deposit, commission, admin fee, and registration, with VAT applied per your rules and split across the agreed cheques. The customer receives it by email.', actor: 'Rental Provider / Manager' },
              { label: 'Customer accepts and hands over cheques', description: 'They confirm the plan and provide the post-dated cheques.', actor: 'Customer' },
              { label: 'Record each cheque', description: 'Enter every cheque against the lead — number, bank, date, amount.', actor: 'Rental Provider / Manager' },
              { label: 'Gate 3 — confirm cheques collected', description: 'This is the commitment point. Confirming tells the platform the deal is funded.', actor: 'Rental Provider / Manager' },
              { label: 'Contract is created automatically', description: 'The tenancy contract is generated from the plan and the lead is marked converted. There is no separate "create contract" step.', actor: 'System' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Do not confirm cheques until you actually hold them. Confirming is what **creates the contract** and converts the lead.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'The plan carries the full breakdown through to the contract — so the rent schedule, the deposit register, and the receivables all reconcile back to what the customer agreed.',
          },
        ],
      },
      {
        id: 'rp-contracts',
        title: 'From Signed to Active',
        description: 'Phase E — signatures, registration, utility, move-in, and activation.',
        tags: ['contract', 'sign', 'ejari', 'registration', 'dewa', 'utility', 'move-in', 'activate'],
        blocks: [
          {
            type: 'note',
            variant: 'warning',
            md: 'The sequence is fixed: **Sign → Registration → Utility → Move-in → Active.** Registration comes before utility because the utility submission needs the registration certificate.',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Customer signs', description: 'They receive a private link by email that opens the signing page directly — no login required.', actor: 'Customer' },
              { label: 'You counter-sign', description: 'Review and sign. Both signatures are now on the contract.', actor: 'Rental Provider' },
              { label: 'File the registration', description: 'Register the tenancy and upload the certificate.', actor: 'Rental Provider / Manager' },
              { label: 'Customer submits utility proof', description: 'They upload their DEWA (or local utility) proof against the registered contract.', actor: 'Customer' },
              { label: 'Verify the utility proof', description: 'Accept it, or reject it and ask for a clearer copy.', actor: 'Rental Provider / Manager' },
              { label: 'Conduct the move-in inspection', description: 'Walk the unit, record condition room by room with photos, and send the report to the customer.', actor: 'Asset Manager' },
              { label: 'Customer signs the report', description: 'They review the condition notes and sign.', actor: 'Customer' },
              { label: 'Counter-sign — the lease activates', description: 'Your counter-signature on the move-in report activates the tenancy automatically. The unit becomes occupied.', actor: 'Asset Manager' },
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'There is no "Activate Tenancy" button. Activation is the **consequence of the move-in counter-signature** — which is what keeps the signed condition report and the live lease in step.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'The **landlord can sign by secure link too**, without a UpNow account. That link opens a review layout — the contract plus every document in full preview, with a sticky sign menu — rather than the customer\'s download page.',
          },
        ],
      },
      {
        id: 'rp-live-lease',
        title: 'Running a Live Lease',
        description: 'Phase F — cheques clearing, charges, receivables, and oversight.',
        tags: ['cheques', 'bounce', 'receivables', 'deposits', 'charges', 'reports'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Cheques clear on their due dates', description: 'Mark each cheque cleared as it is banked. This is what drives your receivables position.', actor: 'Rental Provider / Manager' },
              { label: 'Handle a bounced cheque', description: 'Mark it bounced. The bounce fee comes from your penalty rules, and you record the replacement cheque.', actor: 'Rental Provider / Manager' },
              { label: 'Defer or cancel', description: 'An overdue cheque can be deferred to a new date or cancelled where it will never be banked.', actor: 'Rental Provider / Manager' },
              { label: 'Track the money', description: 'Receivables, the deposits register, and the payments ledger stay current from those cheque decisions.', actor: 'Rental Provider / Manager' },
              { label: 'Mid-lease changes', description: 'Add admin charges, or edit the contract. Editing regenerates the pending cheques.', actor: 'Rental Provider / Manager' },
              { label: 'Keep documents valid', description: 'Expiring customer documents are surfaced so you can collect replacements before they lapse.', actor: 'Rental Provider / Manager' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'A cheque that will never be banked should be **cancelled, not cleared**. Marking it cleared tells the platform you received money you did not.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Editing a signed contract regenerates **pending** cheques only. Cheques already cleared are left alone.',
          },
        ],
      },
      {
        id: 'rp-renewal',
        title: 'Renewals',
        description: 'Phase G — offering a new term and taking it to active.',
        tags: ['renewal', 'offer', 'notice', 'forecast'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Review the renewal forecast', description: 'See which leases are coming up and price the new term.', actor: 'Rental Provider / Manager' },
              { label: 'Draft and send the renewal', description: 'The Asset Manager drafts renewals from Operations and sends them. The customer receives the notice by email.', actor: 'Asset Manager' },
              { label: 'Customer accepts or declines', description: 'Accepting continues the chain. Declining turns it into a move-out with a recorded reason.', actor: 'Customer' },
              { label: 'Refresh expired documents', description: 'Any KYC document that has expired since move-in is re-collected.', actor: 'Rental Provider / Manager' },
              { label: 'Issue the new plan and record cheques', description: 'The customer confirms by uploading their initial payment reference; the manager checks it and records the new cheques.', actor: 'Asset Manager' },
              { label: 'Both parties sign', description: 'Customer signs, then the Rental Provider signs. On a renewal the provider only signs — the manager owns the rest.', actor: 'Rental Provider' },
              { label: 'Register — the renewal activates', description: 'The manager files the registration for the new term, and the renewed tenancy goes active at that point.', actor: 'Asset Manager' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'A **renewal activates on registration**, not on a move-in counter-signature. There is no move-in inspection on a renewal — the customer never left.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'A renewal carries **no new security deposit**, and commission is dropped where you own the unit — so the renewal plan is materially cheaper to start than a new lease.',
          },
        ],
      },
      {
        id: 'rp-exit',
        title: 'Termination, Move-out & Settlement',
        description: 'Phase H — ending a lease cleanly and returning the unit to market.',
        tags: ['termination', 'move-out', 'settlement', 'deposit', 'restoration'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Termination is requested', description: 'The customer, the provider, or the manager can start it. The other side accepts or declines.', actor: 'Any party' },
              { label: 'Set the move-out date and reason', description: 'The effective date is confirmed and a move-out reason is recorded from the fixed list.', actor: 'Rental Provider / Manager' },
              { label: 'Conduct the move-out inspection', description: 'The manager inspects the unit against the signed move-in report and submits the findings.', actor: 'Asset Manager' },
              { label: 'Customer signs the report', description: 'They review the condition comparison and sign.', actor: 'Customer' },
              { label: 'Customer clears the utilities', description: 'They upload proof that the utility account is settled and closed, and the manager approves it.', actor: 'Asset Manager' },
              { label: 'Price the restoration', description: 'Damage and unpaid amounts are priced into deductions, drawing on your penalty rules.', actor: 'Rental Provider / Manager' },
              { label: 'Issue the final settlement', description: 'The manager prepares and sends the settlement. The customer reviews and signs it.', actor: 'Asset Manager' },
              { label: 'Refund and close', description: 'The deposit balance is returned, the lease ends, and the unit goes back to available so it can be re-listed.', actor: 'System' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'A move-out reason is **required**, not optional — it is what makes the exit reporting meaningful. It cannot be added retroactively once the lease has ended.',
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'The move-out report is seeded from the move-in report, so the comparison is like for like and deductions are defensible.',
          },
        ],
      },
      {
        id: 'rp-dashboard',
        title: 'Rental Provider Dashboard',
        description: 'Everything available to a Rental Provider in their dashboard.',
        tags: ['dashboard', 'portfolio', 'financials', 'team', 'reports'],
        blocks: [
          {
            type: 'table',
            headers: ['Menu item', 'What You Can Do'],
            rows: [
              ['Dashboard', 'KPIs and your Action Center — everything waiting on you, grouped by where it sits in the pipeline.'],
              ['Leads', 'The pipeline from viewing booked to converted. **Viewings live here** — scheduling, reschedules, and marking visited.'],
              ['Properties', 'Your buildings, and submitting units for listing review.'],
              ['Units', 'Full unit inventory with availability and pricing.'],
              ['Customers', 'Your customers and their leases.'],
              ['Payments', 'Cheque schedule, clearing, bounces, and collection. **Deposits sit here too.**'],
              ['Operations', 'The operational worklist — inspections, **renewals**, move-outs, and settlements.'],
              ['Leases', 'Every lease — sign, register, print, edit, terminate.'],
              ['Ended Leases', 'Leases that have completed or terminated.'],
              ['Templates', 'Contract templates and addendums.'],
              ['Reports', 'Financial, occupancy, leasing funnel, and operations reporting with drill-downs and CSV export.'],
              ['Restoration List', 'Restoration and deduction pricing used at settlement.'],
              ['Settings', 'Fee rules, penalties, and your team — inviting Asset Managers and setting their permissions.'],
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'A few things are **not** separate menu items, which is the most common reason people cannot find them: **Viewings** are inside Leads, **Deposits** inside Payments, **Renewals** inside Operations, and **Team** inside Settings.',
          },
          {
            type: 'note',
            variant: 'warning',
            md: '**AMC & Vendors, Communications, and Analytics are parked** — the pages exist but are deliberately hidden from the menu until they are ready. Do not plan around them.',
          },
        ],
      },
      {
        id: 'rp-team',
        title: 'Inviting an Asset Manager',
        description: 'How to add a manager and decide what they can do.',
        tags: ['manager', 'invite', 'team', 'permissions'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Go to Team', description: 'Open the Team section in your dashboard.', actor: 'Rental Provider' },
              { label: 'Invite by email', description: 'Enter the manager\'s name and email. They receive an invitation email.', actor: 'Rental Provider' },
              { label: 'Manager accepts', description: 'They open the link and finish setting up their account.', actor: 'Asset Manager' },
              { label: 'Assign properties and permissions', description: 'Scope them to specific properties, and grant the permissions they need — Properties, Listings, Leads, Viewings, Contracts, Payments.', actor: 'Rental Provider' },
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'One manager can cover **multiple properties**, and one property can have **multiple managers** — for example one on operations and another on collections.',
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Revoking a manager takes effect immediately across the platform, including their access to lease documents.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'manager',
    label: 'Asset Manager',
    icon: '📋',
    sections: [
      {
        id: 'manager-overview',
        title: 'What an Asset Manager Can Do',
        description: "The Asset Manager's scoped view — limited to properties assigned by the Rental Provider.",
        tags: ['manager', 'asset manager', 'permissions', 'scope'],
        blocks: [
          {
            type: 'text',
            md: 'An Asset Manager works for a Rental Provider. They see only the properties assigned to them, and only the actions their permissions allow. **Operationally, the manager runs the lease** — the provider keeps the commercial decisions.',
          },
          {
            type: 'table',
            headers: ['Permission', 'What it unlocks in the menu'],
            rows: [
              ['List properties', 'Properties and Units'],
              ['Manage viewings', 'Leads, and the viewings inside them'],
              ['Manage agreements', 'Customers, Operations, Leases, and Ended Leases'],
              ['Manage deposits', 'Payments, and the deposits inside them'],
              ['Manage inspections', 'Restoration List'],
              ['Manage templates', 'Templates'],
              ['View reports', 'Reports'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'A manager only sees a menu item if they hold the matching permission. If a manager reports that a section is "missing", check their permissions before anything else — the section is hidden, not broken.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Scope is explicit. A manager acting for more than one provider must always be working within a chosen provider — the platform never silently picks one for them.',
          },
        ],
      },
      {
        id: 'manager-operations',
        title: 'The Steps a Manager Owns',
        description: 'The operational spine of every lease, renewal, and exit.',
        tags: ['operations', 'inspection', 'renewal', 'move-out', 'settlement'],
        blocks: [
          {
            type: 'text',
            md: 'Across the three journeys, these are the points where the Asset Manager is the actor. Each one is a hand-off that moves the lease forward.',
          },
          {
            type: 'table',
            headers: ['Journey', 'What the manager owns'],
            rows: [
              ['New lease', 'Mark the viewing visited · verify the customer documents · create the move-in report · **counter-sign it, which activates the tenancy**'],
              ['Renewal', 'Draft the renewals · send them to customers · check payment references and record the cheques · **file the registration, which activates the renewal**'],
              ['Exit', 'Create the move-out · counter-sign it · approve the bill clearance · prepare and send the final settlement'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Two of these **activate a lease**: the move-in counter-signature on a new lease, and the registration on a renewal. Everything downstream — rent schedule, occupancy, reporting — depends on them being done accurately.',
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'The Rental Provider keeps: pricing, the payment plan, contract signing, new-lease registration, and accepting or rejecting the utility proof. Both roles are technically permission-gated to do either side, so agree who does what up front.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'An inspector can be sent a **secure link that opens the inspection form directly on site** — it reaches the fill workspace even before any move-in report exists, which is exactly the point of generating one during the walk-through.',
          },
          {
            type: 'heading',
            text: 'Where a manager works',
            level: 3,
          },
          {
            type: 'table',
            headers: ['Menu item', 'What They Can Do'],
            rows: [
              ['Overview', 'Their own action list and the occupancy of their assigned units.'],
              ['Leads', 'Work the pipeline, run viewings, and review the customer documents on a lead.'],
              ['Properties · Units', 'Units, availability, and occupancy for their assigned properties only.'],
              ['Customers', 'The customers on their leases.'],
              ['Payments', 'Record cheques and mark them cleared or bounced. Deposits sit here.'],
              ['Operations', 'Inspections, renewals, move-outs, and settlements — the bulk of the job.'],
              ['Leases · Ended Leases', 'View and counter-sign leases in their scope.'],
              ['Templates', 'Contract templates and addendums.'],
              ['Restoration List', 'Restoration and deduction pricing used at settlement.'],
              ['Reports', 'Operations and performance reporting for their scope.'],
              ['My Profile', 'Their own details.'],
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'A manager has no separate Documents section — customer documents are reviewed **on the lead** they belong to.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'service-provider',
    label: 'Service Provider',
    icon: '🔧',
    sections: [
      {
        id: 'sp-overview',
        title: 'What a Service Provider Can Do',
        description: 'How a service company manages jobs, technicians, and their business on UpNow.',
        tags: ['service provider', 'jobs', 'technicians', 'dashboard'],
        blocks: [
          {
            type: 'text',
            md: 'A Service Provider is a company (e.g. an AC repair firm, a cleaning company) that signs up on UpNow. After identity verification by an Admin, they can receive bookings, manage their technicians, and get paid through the platform.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'The services side of the platform is **behind the rental side**. Onboarding, team, and catalogue are live; booking and job execution are still being built.',
          },
          {
            type: 'table',
            headers: ['Menu item', 'What They Can Do'],
            rows: [
              ['Overview', 'Jobs today, revenue, and technician utilisation at a glance.'],
              ['Operations', '**This is the job board** — accept, assign, and track jobs. Opening a card gives the job detail.'],
              ['My Services', 'Choose which services to offer and set pricing packages.'],
              ['Reviews', 'Reviews left by customers on completed bookings.'],
              ['Earnings', 'Earnings and platform fee deductions.'],
              ['Settings', 'Company profile and service areas, your **Team** of technicians, and your compliance **Documents**.'],
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'There is no separate Jobs, Team, Documents, or Onboarding menu item by design. **Operations is the job board**, Team and Documents live inside Settings, and Onboarding is where the platform sends an account that is not yet approved.',
          },
        ],
      },
      {
        id: 'sp-technician-invite',
        title: 'Inviting a Technician',
        description: 'How to add field workers to your team.',
        tags: ['technician', 'invite', 'team'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Go to Team', description: 'Open the Team section in your Service Provider dashboard.', actor: 'Service Provider' },
              { label: 'Invite by email', description: 'Enter the technician\'s name, email, and their skills (AC, Plumbing, Electrical, etc.).', actor: 'Service Provider' },
              { label: 'Technician accepts', description: 'They receive an email invitation and open the link to finish setting up their account.', actor: 'Technician' },
              { label: 'Ready to be assigned', description: 'The technician appears in your roster and can now be assigned to jobs.', actor: 'Service Provider' },
            ],
          },
        ],
      },
      {
        id: 'sp-job-management',
        title: 'Managing a Job',
        description: 'How a Service Provider handles a booking from acceptance to payment.',
        tags: ['job', 'booking', 'assignment', 'payment'],
        blocks: [
          {
            type: 'note',
            variant: 'warning',
            md: '🚧 **Full job management is still in development.** The workflow below describes the intended flow.',
          },
          {
            type: 'steps',
            steps: [
              { label: 'New booking arrives', description: 'You are notified of a new customer booking. It appears in your Jobs section with status "Pending".', actor: 'Service Provider' },
              { label: 'Accept or decline', description: 'Review the job details — service type, address, date, and any notes. Accept to confirm.', actor: 'Service Provider' },
              { label: 'Assign a technician', description: 'Pick an available technician from your team roster. They are notified immediately.', actor: 'Service Provider' },
              { label: 'Monitor the job', description: 'Track in real time as the technician updates their status — On the Way, Arrived, Job Done.', actor: 'Service Provider' },
              { label: 'Review proof of work', description: 'The technician uploads photos when the job is complete. You review them.', actor: 'Service Provider' },
              { label: 'Payment released', description: 'Once the customer confirms completion, the payment held in escrow is released to you.', actor: 'System' },
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'technician',
    label: 'Technician',
    icon: '👷',
    sections: [
      {
        id: 'technician-workflow',
        title: 'How a Technician Does a Job',
        description: 'The step-by-step experience from receiving an assignment to completing the job.',
        tags: ['technician', 'job', 'status', 'proof of work'],
        blocks: [
          {
            type: 'note',
            variant: 'warning',
            md: '🚧 **Technician job management is still in development.** The workflow below describes the intended experience.',
          },
          {
            type: 'text',
            md: 'Technicians are field workers. They only see jobs assigned to them — nothing else. Their dashboard is simple and mobile-first.',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Receive a job', description: 'You get a notification when your employer assigns you to a job. You see the customer name, address, service type, and scheduled time.', actor: 'Technician' },
              { label: 'Head to the location', description: 'Tap "On My Way". The customer is notified automatically.', actor: 'Technician' },
              { label: 'Arrive at the site', description: 'Tap "I\'ve Arrived". The job timer starts.', actor: 'Technician' },
              { label: 'Do the work', description: 'Carry out the service as specified.', actor: 'Technician' },
              { label: 'Upload proof of work', description: 'Take photos of the completed work. Add any notes. Upload them through the app.', actor: 'Technician' },
              { label: 'Mark as done', description: 'Tap "Job Complete". The customer and your employer are notified.', actor: 'Technician' },
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'admin',
    label: 'Admin',
    icon: '⚙️',
    sections: [
      {
        id: 'admin-overview',
        title: 'What an Admin Can Do',
        description: 'Full-platform oversight — the UpNow operations team.',
        tags: ['admin', 'oversight', 'platform'],
        blocks: [
          {
            type: 'text',
            md: 'Admins are internal UpNow team members with visibility across the whole platform — all users, all providers, all listings, all contracts. The admin dashboard is separate from every other dashboard.',
          },
          {
            type: 'text',
            md: 'The admin sits on the flow at exactly **two decision points** — Gate 1 (is this provider allowed to operate?) and Gate 2 (is this listing allowed to go public?) — plus continuous oversight.',
          },
          {
            type: 'table',
            headers: ['Menu item', 'What Admins Can Do'],
            rows: [
              ['Overview', 'Platform Pulse — growth, money, market, providers, customers, exposure, and usage on one page. The overview **is** the Pulse.'],
              ['User Management', 'All user accounts, including delegated admin accounts.'],
              ['Profile Verification', '**Gate 1** — review provider documents and set compliance status.'],
              ['Listings — Rental Provider', '**Gate 2** — publish or reject submitted rental listings.'],
              ['Platform Billing', 'Rental Provider billing — subscription plus lease origination, renewal, and settlement fees.'],
              ['Listings — Service Provider', 'Review service provider listings.'],
              ['Service Catalog', 'The service categories and catalogue.'],
              ['Reviews · Payouts · Disputes', 'Service-provider business surfaces — reviews on a booking, payouts settling SP earnings, and disputes raised against SP jobs.'],
              ['Platform Status', 'Health probes across the platform.'],
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'The admin menu separates the **two businesses**: Rental Provider surfaces (listings, billing) and Service Provider surfaces (listings, catalogue, reviews, payouts, disputes) sit under their own headings rather than in one shared list.',
          },
          {
            type: 'note',
            variant: 'warning',
            md: '**Activity, Dispatch, Risk, Analytics, and Inbox are parked** — built but hidden from the menu.',
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Admin decisions are **not** announced by the platform today — providers see the outcome when they next open their dashboard rather than receiving a message. Tell the provider directly if a decision is time-sensitive.',
          },
        ],
      },
      {
        id: 'provider-approval',
        title: 'Gate 1 — Approving a New Provider',
        description: 'How UpNow verifies a Rental or Service Provider before they can operate.',
        tags: ['approval', 'kyc', 'provider', 'onboarding', 'compliance', 'gate'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Provider registers and submits KYC', description: 'Trade licence, Emirates ID, ownership proof, and business details. Their compliance status becomes "pending review".', actor: 'Provider' },
              { label: 'The submission appears for review', description: 'It lands in the admin compliance queue.', actor: 'System' },
              { label: 'Admin reviews the documents', description: 'Check each document for validity and consistency with the business details.', actor: 'UpNow Admin' },
              { label: 'Set the outcome', description: 'Compliant, action required (send it back for specific fixes), or paused.', actor: 'UpNow Admin' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Compliance is **continuous, not one-off**. If a provider stops being compliant, their published units stop appearing publicly — even units that were approved long ago.',
          },
        ],
      },
      {
        id: 'listing-approval',
        title: 'Gate 2 — Approving a Listing',
        description: 'How a submitted unit becomes publicly visible on the marketplace.',
        tags: ['listing', 'approval', 'publish', 'gate', 'moderation'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Provider submits the listing', description: 'The draft moves to pending and enters the review queue.', actor: 'Rental Provider' },
              { label: 'Admin reviews it', description: 'Check the photos, pricing, description, and that the unit is genuinely lettable.', actor: 'UpNow Admin' },
              { label: 'Publish or reject', description: 'Publishing makes the unit eligible to appear on the marketplace.', actor: 'UpNow Admin' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Publishing is **necessary but not sufficient**. The unit only appears publicly if the provider is also compliant. If a unit is approved but invisible, check the provider first.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'status',
    label: 'What\'s Built',
    icon: '📊',
    sections: [
      {
        id: 'implementation-status',
        title: 'Platform Build Status — August 2026',
        description: 'What is live, and what is still being built.',
        tags: ['status', 'roadmap', 'live', 'in development'],
        blocks: [
          {
            type: 'note',
            variant: 'success',
            md: 'The **rental lifecycle is live end to end** — all 54 steps from provider registration to final settlement run inside the platform, in production.',
          },
          {
            type: 'heading',
            text: '✅ Live & Working',
            level: 2,
          },
          {
            type: 'table',
            headers: ['Area', 'Details'],
            rows: [
              ['Accounts & access', 'All six roles. One-time-code login. Invitations for managers and technicians, with scoped permissions.'],
              ['Provider onboarding', 'KYC submission and Gate 1 compliance review, with continuous enforcement.'],
              ['Rules setup', 'Fee rules, penalties, VAT treatment, and contract templates that feed plans and settlements.'],
              ['Portfolio & listings', 'Properties, units, pricing, listing submission, and Gate 2 review.'],
              ['Public marketplace', 'Browse and filter listings, open unit detail, and book a viewing without an account.'],
              ['Leads & viewings', 'Full pipeline from viewing booked to converted, with reschedules and visit records.'],
              ['Document collection', 'Request specific KYC documents, customer upload, accept/reject, and expiry tracking.'],
              ['Payment plans & cheques', 'Priced plans with VAT, cheque capture, and confirmation that creates the contract.'],
              ['Contract execution', 'Signing by private link, counter-signature, registration, utility proof, and move-in inspection.'],
              ['Live lease & money', 'Cheque clearing, bounces and replacement, deferrals, receivables, deposits register, payments ledger.'],
              ['Renewals', 'Forecast, draft, notice, acceptance or decline, new plan, signatures, and registration to active.'],
              ['Exit', 'Termination from any party, move-out inspection, bill clearance, restoration pricing, and final settlement.'],
              ['Reporting', 'Financial, occupancy, leasing funnel, and operations reports with drill-downs and CSV export.'],
              ['Admin oversight', 'Platform Pulse, Platform Status probes, activity log, and cross-provider reporting.'],
            ],
          },
          {
            type: 'heading',
            text: '🚧 In Development',
            level: 2,
          },
          {
            type: 'table',
            headers: ['Area', 'Notes'],
            rows: [
              ['Service booking & checkout', 'Customers can browse services but cannot book yet.'],
              ['Job management for SP & Technician', 'Accept, assign, track, and complete jobs.'],
              ['Escrow (payment hold/release)', 'Payment held until job completion.'],
              ['Reviews & ratings', 'Post-job reviews by the customer.'],
              ['Maintenance requests', 'Customers logging maintenance issues against their tenancy.'],
              ['SMS & push delivery', 'Message content is written across the platform; delivery over SMS and push is not yet switched on. Email and in-app messages are live.'],
              ['Notification preferences', 'Per-user control over which messages you receive.'],
              ['Disputes', 'Admin resolution of customer/provider disputes.'],
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Detailed module-by-module delivery tracking lives in the **Rental Module Status** workbook, which is maintained separately from this guide.',
          },
        ],
      },
      {
        id: 'communications',
        title: 'What the Platform Sends',
        description: 'Which messages go out, to whom, and on which channel.',
        tags: ['email', 'notifications', 'sms', 'messages'],
        blocks: [
          {
            type: 'text',
            md: 'Across the rental lifecycle the platform carries **29 emails, 24 in-app notifications, and 21 SMS messages**, attached to specific steps in the flow.',
          },
          {
            type: 'table',
            headers: ['Channel', 'Status', 'Notes'],
            rows: [
              ['Email', '✅ Live', 'The primary channel. Carries the renewal notice, payment plan, signing links, and settlement.'],
              ['In-app notifications', '✅ Live', 'Shown in the dashboard bell for signed-in users.'],
              ['SMS', '🚧 In development', 'Message content is written and mapped to events; delivery is not yet switched on.'],
              ['Push', '🚧 In development', 'Same position as SMS.'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Because messaging is **email-weighted and customer-weighted**, providers and managers should work from their **Action Center** rather than waiting to be told. Admin decisions in particular are not announced.',
          },
        ],
      },
    ],
  },
];
