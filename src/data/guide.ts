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

export const GUIDE_CATEGORIES: GuideCategory[] = [
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'overview',
    label: 'Overview',
    icon: '🏠',
    sections: [
      {
        id: 'what-is-upnow',
        title: 'What Is UpNow?',
        description: 'High-level introduction to the platform and its dual marketplace model.',
        tags: ['intro', 'overview', 'marketplace'],
        blocks: [
          {
            type: 'text',
            md: 'UpNow is a **dual marketplace** for the UAE market connecting customers with home/office services and rental spaces.',
          },
          {
            type: 'grid',
            items: [
              {
                icon: '🔧',
                title: 'Home & Office Services',
                desc: 'Customers book maintenance (AC, plumbing, cleaning, pest control, electrical, painting…) from vetted Service Providers who dispatch Technicians.',
              },
              {
                icon: '🏢',
                title: 'Rentable Spaces',
                desc: 'Customers browse and rent properties (residential, commercial, industrial) listed by Space Providers, with Asset Managers handling day-to-day ops.',
              },
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Market focus: **UAE / Dubai**. All monetary values are in **AED (UAE Dirham)**.',
          },
        ],
      },
      {
        id: 'user-roles',
        title: 'User Roles',
        description: 'The six roles on the platform and their responsibilities.',
        tags: ['roles', 'auth', 'permissions'],
        blocks: [
          {
            type: 'text',
            md: 'UpNow has **6 roles**. Every user is assigned exactly one role at signup (or via invitation).',
          },
          {
            type: 'table',
            headers: ['Role', 'Description', 'Onboarding Path', 'Post-Login Landing'],
            rows: [
              ['Customer / Tenant', 'Books services and/or rents spaces', '/auth/signup', '/ (Homepage)'],
              ['Service Provider', 'Company offering maintenance/cleaning services', '/signup/service-provider', '/dashboard/provider/services'],
              ['Technician', 'Field worker dispatched by a Service Provider', 'Invited by Service Provider', '/dashboard/technician'],
              ['Space Provider', 'Landlord / property owner listing rental spaces', '/signup/space-provider', '/dashboard/provider/spaces'],
              ['Manager (Asset Manager)', 'Operational manager assigned by a Space Provider', 'Invite-only → /accept-invite', '/dashboard/manager'],
              ['Admin', 'Platform team with full oversight', 'Internal only', '/dashboard/admin'],
            ],
          },
        ],
      },
      {
        id: 'authentication',
        title: 'Authentication Architecture',
        description: 'How users sign up, log in, and how sessions are managed.',
        tags: ['auth', 'jwt', 'login', 'signup', 'session'],
        blocks: [
          {
            type: 'text',
            md: 'The platform uses **JWT-based authentication** (NestJS + `@nestjs/jwt`). There is no third-party auth provider — users are stored in the platform\'s own PostgreSQL database.',
          },
          {
            type: 'heading',
            text: 'Two Login Entry Points',
            level: 3,
          },
          {
            type: 'table',
            headers: ['URL', 'Audience', 'Redirect After Login'],
            rows: [
              ['/auth/signin', 'Customers / Tenants', '/ (Homepage)'],
              ['/portal/login', 'Providers, Managers, Technicians, Admins', 'Role-specific dashboard'],
            ],
          },
          {
            type: 'heading',
            text: 'Token Flow',
            level: 3,
          },
          {
            type: 'steps',
            steps: [
              { label: 'User submits credentials', description: 'POST /api/auth/login with email + password.', actor: 'Frontend' },
              { label: 'Backend validates', description: 'NestJS verifies password with bcrypt, checks user exists and is active.', actor: 'Backend' },
              { label: 'JWT issued', description: 'Two tokens returned: access_token (short-lived) + refresh_token (long-lived).', actor: 'Backend' },
              { label: 'Frontend stores tokens', description: 'Stored in AuthContext (memory + httpOnly cookie or localStorage for access token).', actor: 'Frontend' },
              { label: 'Authenticated requests', description: 'Every API call includes Authorization: Bearer <access_token> header.', actor: 'Frontend' },
              { label: 'Token refresh', description: 'When access_token expires, POST /api/auth/refresh with refresh_token to get a new pair.', actor: 'Frontend' },
            ],
          },
          {
            type: 'heading',
            text: 'Signup Flow',
            level: 3,
          },
          {
            type: 'steps',
            steps: [
              { label: 'User fills signup form', description: 'Name, email, password, role selection.', actor: 'Customer' },
              { label: 'POST /api/auth/register', description: 'Backend hashes password with bcrypt (salt rounds: 12) and creates the user row.', actor: 'Backend' },
              { label: 'Profile auto-created', description: 'A profiles record is created simultaneously with the user\'s role, full name, and email.', actor: 'Backend' },
              { label: 'JWT issued', description: 'Same token pair as login is returned immediately — no email verification required.', actor: 'Backend' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'The `role` field is set **at registration** and is immutable from the frontend. Only Admins can change a user\'s role via the admin dashboard.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'customer',
    label: 'Customer / Tenant',
    icon: '👤',
    sections: [
      {
        id: 'customer-discovery',
        title: 'Browsing & Discovery',
        description: 'How customers find and explore services and spaces on the platform.',
        tags: ['browse', 'search', 'catalog', 'discovery'],
        blocks: [
          {
            type: 'text',
            md: 'Customers land on the **Homepage** (`/`) which uses an Airbnb-style layout. They can browse Services or Spaces without logging in.',
          },
          {
            type: 'grid',
            items: [
              { icon: '🔍', title: 'Services Catalog', desc: '/services — Browse all services by category and subcategory. Filter by type, rating, price range.' },
              { icon: '🏠', title: 'Service Detail', desc: '/services/:category/:service — See service details, pricing, providers available. Auth-gated booking button.' },
              { icon: '🏗️', title: 'Spaces Catalog', desc: '/spaces — Browse rental listings from the database. Filter by type, location, bedrooms, price.' },
              { icon: '🔑', title: 'Space Detail', desc: '/spaces/:id — Property details, photo gallery, features/facilities. Auth-gated inquiry button.' },
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Public browsing requires **no authentication**. The auth gate only triggers when a customer attempts to book or submit an inquiry.',
          },
        ],
      },
      {
        id: 'service-booking-flow',
        title: 'Service Booking Flow',
        description: 'End-to-end flow from service discovery to completed job.',
        tags: ['booking', 'service', 'payment', 'job', 'lifecycle'],
        blocks: [
          {
            type: 'steps',
            title: 'Customer Side',
            steps: [
              { label: 'Browse services', description: 'Customer navigates to /services and selects a category (e.g. AC Maintenance).', actor: 'Customer' },
              { label: 'View service detail', description: 'Lands on /services/:category/:service. Reviews pricing, estimated duration, provider details.', actor: 'Customer' },
              { label: 'Auth gate', description: 'If not logged in, a modal prompts sign-in or sign-up before proceeding.', actor: 'System' },
              { label: 'Choose booking type', description: 'Instant Book (fixed price) or Request Quote (for custom scope). Select preferred date/time.', actor: 'Customer' },
              { label: 'Confirm booking', description: 'POST /api/bookings — Booking created with status: Pending.', actor: 'System' },
              { label: 'Track in My Services', description: 'Customer can monitor the booking status through 6 lifecycle stages in their dashboard.', actor: 'Customer' },
            ],
          },
          {
            type: 'heading',
            text: 'Job Lifecycle',
            level: 3,
          },
          {
            type: 'lifecycle',
            states: [
              { label: 'Pending', color: 'gray', description: 'Booking submitted, awaiting provider confirmation.' },
              { label: 'Confirmed', color: 'blue', description: 'Service Provider accepts the job.' },
              { label: 'Assigned', color: 'blue', description: 'Technician is assigned to the job.' },
              { label: 'En Route', color: 'amber', description: 'Technician has departed and is travelling to the site.' },
              { label: 'In Progress', color: 'amber', description: 'Technician is on-site performing the service.' },
              { label: 'Completed', color: 'green', description: 'Job done. Proof of work uploaded by Technician.' },
              { label: 'Paid', color: 'green', description: 'Payment confirmed. Customer can leave a review.' },
            ],
          },
          {
            type: 'heading',
            text: 'Provider Side (parallel)',
            level: 3,
          },
          {
            type: 'steps',
            steps: [
              { label: 'New job alert', description: 'Service Provider receives notification of a new booking.', actor: 'Provider' },
              { label: 'Review & confirm', description: 'Provider reviews booking details and confirms → status moves to Confirmed.', actor: 'Provider' },
              { label: 'Assign technician', description: 'Provider selects an available Technician from their roster → status moves to Assigned.', actor: 'Provider' },
              { label: 'Monitor progress', description: 'Provider can view real-time status updates as the Technician updates the job.', actor: 'Provider' },
              { label: 'Review proof of work', description: 'After completion, Provider reviews the photos/notes uploaded by Technician.', actor: 'Provider' },
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'Notifications are sent at **every status transition** to all relevant roles (Customer, Provider, Technician).',
          },
        ],
      },
      {
        id: 'space-rental-flow',
        title: 'Space Rental Flow',
        description: 'End-to-end flow from space discovery to signed lease.',
        tags: ['space', 'rental', 'inquiry', 'lease', 'contract', 'viewing'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Browse spaces', description: 'Customer navigates to /spaces — sees all available units. Filters by type, bedrooms, price range.', actor: 'Customer' },
              { label: 'View space detail', description: 'Opens /spaces/:id — photo gallery, features, floor plan, annual rent in AED.', actor: 'Customer' },
              { label: 'Submit inquiry', description: 'Auth-gated. Customer submits inquiry form. POST /api/inquiries — Space Provider is notified.', actor: 'Customer' },
              { label: 'Schedule viewing', description: 'Space Provider or Manager contacts Customer to arrange a property viewing.', actor: 'Provider / Manager' },
              { label: 'Conduct viewing', description: 'Customer visits the property. Manager facilitates the tour.', actor: 'Manager' },
              { label: 'Submit offer', description: 'If interested, Customer submits a rental offer (may negotiate terms).', actor: 'Customer' },
              { label: 'Offer review', description: 'Space Provider reviews offer terms, accepts or counter-offers.', actor: 'Provider' },
              { label: 'Lease drafted', description: 'Tenancy contract generated with agreed terms (rent, duration, deposit amount).', actor: 'Provider / System' },
              { label: 'Document signing', description: 'Both parties digitally sign the contract. KYC documents (Passport, Emirates ID) uploaded by Customer.', actor: 'Both' },
              { label: 'Deposit collected', description: 'Security deposit recorded. Lease becomes Active.', actor: 'Provider' },
              { label: 'Post-booking lifecycle begins', description: 'Customer can now see active lease in "My Spaces" dashboard section.', actor: 'System' },
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Property lifecycle states on the listing: **Listed → Lead Captured → Viewing Conducted → Offer Confirmed → Post-Booking Workflow**',
          },
        ],
      },
      {
        id: 'customer-dashboard',
        title: 'Customer Dashboard Sections',
        description: 'What a logged-in customer can access via the avatar dropdown.',
        tags: ['dashboard', 'my spaces', 'my services', 'messages', 'account', 'kyc'],
        blocks: [
          {
            type: 'text',
            md: 'Customers use an **Airbnb-style model** — they stay on the homepage after login. Dashboard sections are accessed via the **avatar dropdown** in the Navbar.',
          },
          {
            type: 'table',
            headers: ['Section', 'Key', 'Description'],
            rows: [
              ['My Spaces', 'spaces', 'View active leases. 8-tab detail view per lease: Overview, Receivables, Documents, Deposits, Compliance, Timeline, Messages, Renewal.'],
              ['My Services', 'bookings', 'View service bookings with status tracking. Filter/sort, view details, upload payment proof.'],
              ['Messages', 'messages', 'Unified inbox combining service threads and lease communications.'],
              ['Account', 'account', 'Personal details, communication preferences, password change. Integrated KYC document uploads.'],
            ],
          },
          {
            type: 'heading',
            text: 'KYC Documents',
            level: 3,
          },
          {
            type: 'grid',
            items: [
              { icon: '🛂', title: 'Passport Copy', desc: 'Required for all tenants renting a space.' },
              { icon: '🪪', title: 'Emirates ID', desc: 'UAE national identity document.' },
              { icon: '💼', title: 'Bank Statement / Employment Agreement', desc: 'Proof of income / employment.' },
              { icon: '👨‍👩‍👧', title: 'Dependent Documents', desc: 'For tenants registering additional occupants.' },
            ],
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'service-provider',
    label: 'Service Provider',
    icon: '🔧',
    sections: [
      {
        id: 'sp-overview',
        title: 'Service Provider Overview',
        description: 'How a Service Provider operates on the platform.',
        tags: ['service provider', 'jobs', 'technicians', 'dashboard'],
        blocks: [
          {
            type: 'text',
            md: 'Service Providers are companies that offer home/office maintenance services. They sign up at `/signup/service-provider`, and after admin approval they can manage jobs, technicians, and their service catalog.',
          },
          {
            type: 'table',
            headers: ['Dashboard Section', 'Description'],
            rows: [
              ['Overview', 'KPI cards (jobs today, revenue, active technicians), job status donut chart, monthly revenue bar chart, technician utilization table.'],
              ['Jobs', 'All bookings with advanced filtering (status, technician, category, date). Job detail drawer with SLA tracking, proof of work, technician assignment.'],
              ['Technicians', 'List all technicians with skills, status, ratings, earnings. Invite new technicians. Technician detail with job history.'],
              ['Catalog', 'Toggle platform services on/off. Create custom services. Two tabs: Platform Services, My Custom Services.'],
              ['Zones', 'Define geographic service zones on an interactive Dubai map with estimated travel times.'],
              ['Payouts', 'Monthly revenue summaries, platform fees, technician payout breakdowns. Export PDF/CSV.'],
              ['Reports', 'Generate reports for jobs, revenue, payouts, technician performance.'],
              ['Documents', 'Trade licenses, statements, compliance documents.'],
              ['Communications', 'Separate channels for Customer chats and Technician chats.'],
              ['Settings', 'Business details, payout info, notification preferences, team management.'],
            ],
          },
        ],
      },
      {
        id: 'sp-technician-invite',
        title: 'Technician Invitation Flow',
        description: 'How a Service Provider invites and onboards a Technician.',
        tags: ['technician', 'invite', 'onboarding'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Open Technicians section', description: 'Provider navigates to /dashboard/provider/services → Technicians tab.', actor: 'Provider' },
              { label: 'Click "Invite Technician"', description: 'Fills in technician\'s name, email, skill set (AC, Plumbing, Electrical, etc.).', actor: 'Provider' },
              { label: 'Invitation sent', description: 'POST /api/technicians/invite — Backend creates a pending technician record and sends invitation email.', actor: 'System' },
              { label: 'Technician accepts', description: 'Technician clicks the link in the email, sets a password, and is redirected to /dashboard/technician.', actor: 'Technician' },
              { label: 'Available for assignment', description: 'Technician now appears in the Provider\'s assignment dropdown when creating or updating jobs.', actor: 'System' },
            ],
          },
        ],
      },
      {
        id: 'sp-job-management',
        title: 'Job Management',
        description: 'How a Service Provider manages the full job lifecycle.',
        tags: ['job', 'assignment', 'sla', 'proof of work', 'status'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Receive booking', description: 'New job appears in Jobs section with status Pending. Push notification triggered.', actor: 'System' },
              { label: 'Confirm or reject', description: 'Provider reviews job details (service type, customer, date, address). Clicks Confirm → status → Confirmed.', actor: 'Provider' },
              { label: 'Assign technician', description: 'Provider selects a Technician from their active roster. Status → Assigned. Technician is notified.', actor: 'Provider' },
              { label: 'Monitor in real-time', description: 'Provider can see when Technician updates status (En Route, In Progress, Completed).', actor: 'Provider' },
              { label: 'Review proof of work', description: 'After completion, Provider reviews photos and notes uploaded by Technician.', actor: 'Provider' },
              { label: 'Mark payment received', description: 'If direct payment: Provider marks as Paid. Platform-mediated payments are auto-confirmed.', actor: 'Provider' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'SLA timers begin at the **Assigned** stage. Escalation is triggered if the Technician doesn\'t update to En Route within the SLA window.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'technician',
    label: 'Technician',
    icon: '👷',
    sections: [
      {
        id: 'technician-workflow',
        title: 'Technician Job Workflow',
        description: 'How a Technician manages their assigned jobs.',
        tags: ['technician', 'job', 'proof of work', 'status update'],
        blocks: [
          {
            type: 'text',
            md: 'Technicians are field workers employed by Service Providers. They are dispatched to customer locations to perform services.',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Receive job assignment', description: 'Technician is notified when a Provider assigns them to a job. Job appears in their dashboard.', actor: 'System' },
              { label: 'Review job details', description: 'View customer name, address, service type, scheduled time, special instructions.', actor: 'Technician' },
              { label: 'Mark "En Route"', description: 'When departing, Technician updates status to En Route. Customer receives notification.', actor: 'Technician' },
              { label: 'Arrive on site', description: 'Technician marks "In Progress" upon arrival. SLA timer is running.', actor: 'Technician' },
              { label: 'Perform service', description: 'Carries out the job as specified.', actor: 'Technician' },
              { label: 'Upload proof of work', description: 'Takes photos of completed work, adds notes/remarks, uploads via the dashboard.', actor: 'Technician' },
              { label: 'Mark "Completed"', description: 'Job status updates to Completed. Provider and Customer are notified.', actor: 'Technician' },
              { label: 'Communicate with Provider', description: 'Technician can message the Provider through the Communications channel for issues or updates.', actor: 'Technician' },
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'Technicians can only see jobs assigned to them. They do not see the full job board.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'space-provider',
    label: 'Space Provider',
    icon: '🏢',
    sections: [
      {
        id: 'landlord-overview',
        title: 'Space Provider Overview',
        description: 'How a Space Provider (Landlord) manages properties and tenants.',
        tags: ['landlord', 'space provider', 'properties', 'units', 'tenants'],
        blocks: [
          {
            type: 'text',
            md: 'Space Providers are property owners/companies that list rental units on UpNow. They manage the full property lifecycle from listing to lease to renewal.',
          },
          {
            type: 'table',
            headers: ['Dashboard Section', 'Description'],
            rows: [
              ['Overview', 'Live stats: Total Units, Occupancy %, Active Orders, Renewals Due (≤60 days), Deposits Held, Receivables.'],
              ['Portfolio', 'Properties grouped by building. Drill-down to individual units.'],
              ['Units', 'Central inventory. Statuses: Available, Occupied, Reserved, Under Renewal, Maintenance Hold.'],
              ['Agreements', 'Tenancy contracts. Status: Active, Expired, Terminated. Detail drawer with full financial/temporal data.'],
              ['Tenants', 'All tenants with active rent totals, 90-day renewal tracking, nationality segments.'],
              ['Deposits', 'Security deposits. Statuses: Held, Partially Deducted, Fully Deducted, Pending Refund, Refunded.'],
              ['Managers', 'Assign Asset Managers to properties. Invite new managers via email (PKCE invite flow).'],
              ['Renewals', 'Full renewal pipeline (7-stage lifecycle).'],
              ['Collections', 'Receivables with actions: Mark Paid, Partial Payment, Mark Bounced, Apply Late Fee, Send Reminder.'],
              ['Vendors (AMC)', 'Annual Maintenance Contracts with third-party vendors. Contract lifecycle management.'],
              ['Documents', 'All lease documents with role-based visibility.'],
            ],
          },
        ],
      },
      {
        id: 'manager-invitation',
        title: 'Manager Invitation Flow',
        description: 'How a Space Provider invites an Asset Manager to the platform.',
        tags: ['manager', 'invite', 'asset manager', 'onboarding'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Open Managers section', description: 'Space Provider navigates to Managers tab in their dashboard.', actor: 'Provider' },
              { label: 'Click "Invite Manager"', description: 'Fills in manager name, email, and optionally assign properties immediately.', actor: 'Provider' },
              { label: 'Backend processes invite', description: 'POST /api/managers/invite — Creates a pending manager record, sends invitation email via the configured mailer.', actor: 'System' },
              { label: 'Manager receives email', description: 'Email contains a secure invite link (PKCE flow). Link expires after 24 hours.', actor: 'System' },
              { label: 'Manager accepts invite', description: 'Manager clicks the link, lands on /accept-invite, sets their password.', actor: 'Manager' },
              { label: 'Redirected to dashboard', description: 'After password set, manager is authenticated and redirected to /dashboard/manager.', actor: 'System' },
              { label: 'Properties assigned', description: 'Manager can now see and manage the properties assigned to them by the Space Provider.', actor: 'System' },
            ],
          },
        ],
      },
      {
        id: 'property-assignment',
        title: 'Property Assignment (Many-to-Many)',
        description: 'How properties are assigned to Asset Managers.',
        tags: ['property', 'assignment', 'manager', 'many-to-many'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Open manager detail', description: 'Space Provider opens a manager\'s record from the Managers section.', actor: 'Provider' },
              { label: 'Click "Assign Asset"', description: 'Dropdown shows all available properties (excluding already-assigned ones).', actor: 'Provider' },
              { label: 'Select property', description: 'Provider selects the property. PATCH /api/managers/:id/properties — appends property to manager\'s assigned list.', actor: 'System' },
              { label: 'Manager sees property', description: 'The assigned property and all its units/leases appear in the Manager\'s dashboard immediately.', actor: 'System' },
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'The relationship is **many-to-many**: multiple Managers can be assigned to the same Property, and one Manager can oversee multiple Properties.',
          },
        ],
      },
      {
        id: 'renewal-lifecycle',
        title: 'Renewal Lifecycle',
        description: 'The 7-stage lease renewal pipeline for Space Providers.',
        tags: ['renewal', 'lease', 'contract', 'lifecycle', 'pipeline'],
        blocks: [
          {
            type: 'text',
            md: 'Lease renewals are tracked through a structured 7-stage pipeline. Renewals are automatically surfaced when a lease is within **60 days** of expiry.',
          },
          {
            type: 'lifecycle',
            states: [
              { label: 'Notice Pending', color: 'gray', description: 'Lease nearing expiry. No action taken yet.' },
              { label: 'Notice Sent', color: 'blue', description: 'Renewal notice sent to tenant.' },
              { label: 'In Negotiation', color: 'amber', description: 'Tenant and Provider are discussing new terms.' },
              { label: 'Terms Agreed', color: 'amber', description: 'Both parties have agreed on new rent and duration.' },
              { label: 'Signed', color: 'green', description: 'New contract signed by both parties.' },
              { label: 'Compliance Updated', color: 'green', description: 'Documents and compliance records updated.' },
              { label: 'Complete', color: 'green', description: 'Renewal fully processed. New lease is active.' },
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Alternative terminal states: **Lapsed** (expired without renewal) or **Not Renewing** (tenant declined to renew).',
          },
          {
            type: 'heading',
            text: 'Customer View of Renewal',
            level: 3,
          },
          {
            type: 'text',
            md: 'When a renewal offer is active, the Customer sees a **notification banner** inside "My Spaces" with options to Accept, Reject, or Negotiate the offer.',
          },
        ],
      },
      {
        id: 'vendor-amc',
        title: 'Vendor / AMC Lifecycle',
        description: 'How Space Providers manage Annual Maintenance Contract vendors.',
        tags: ['vendor', 'amc', 'contract', 'maintenance'],
        blocks: [
          {
            type: 'lifecycle',
            states: [
              { label: 'Invited', color: 'gray', description: 'Vendor invitation sent.' },
              { label: 'Active', color: 'green', description: 'Vendor contract active and in force.' },
              { label: 'Rejected', color: 'red', description: 'Vendor application rejected.' },
              { label: 'Suspended', color: 'amber', description: 'Vendor temporarily suspended.' },
            ],
          },
          {
            type: 'table',
            headers: ['Document Type', 'Purpose'],
            rows: [
              ['Contract', 'The signed AMC agreement.'],
              ['SLA', 'Service Level Agreement defining response times.'],
              ['Scope of Work', 'What is covered and excluded by the AMC.'],
              ['Compliance', 'Certificates, insurance, trade license of the vendor.'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Contracts expiring within **30 days** are automatically flagged in the Vendors section.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'manager',
    label: 'Asset Manager',
    icon: '📋',
    sections: [
      {
        id: 'manager-overview',
        title: 'Manager Dashboard Overview',
        description: 'What an Asset Manager can see and do on the platform.',
        tags: ['manager', 'asset manager', 'dashboard', 'properties'],
        blocks: [
          {
            type: 'text',
            md: 'Asset Managers are operational staff assigned by Space Providers. They see a **scoped view** of the platform, limited to properties they have been assigned.',
          },
          {
            type: 'table',
            headers: ['Section', 'Description'],
            rows: [
              ['Overview', 'Summary KPIs for managed properties and active leases.'],
              ['Agreements', 'Tenancy contracts filtered to only show leases for managed properties.'],
              ['Deposits', 'Security deposits for managed leases.'],
              ['Collections', 'Receivables for managed leases — mark paid, send reminders.'],
              ['Renewals', 'Renewal pipeline filtered to their managed properties.'],
              ['Documents', 'Documents for managed leases only.'],
              ['Settings', 'Manager profile and notification preferences.'],
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'A Manager\'s data is always **scoped to their assigned properties**. They cannot see units or leases outside their portfolio.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'admin',
    label: 'Admin',
    icon: '⚙️',
    sections: [
      {
        id: 'admin-overview',
        title: 'Admin Dashboard Overview',
        description: 'Full-platform oversight capabilities available to Admins.',
        tags: ['admin', 'dashboard', 'oversight', 'platform'],
        blocks: [
          {
            type: 'text',
            md: 'Admins are internal UpNow team members with full read/write access across the platform. They access the platform via `/portal/login`.',
          },
          {
            type: 'table',
            headers: ['Section', 'Description'],
            rows: [
              ['Overview', 'Platform-wide KPIs with charts (total users, bookings, revenue, occupancy rate).'],
              ['Providers', 'All Space Providers and Service Providers. View, approve, suspend.'],
              ['Users', 'All platform users. Columns: Name, Email, Role (color-coded pill), Bookings, Jobs, Orders, Created, Last Active.'],
              ['Approvals', 'Pending provider/service approvals with accept/reject actions.'],
              ['Jobs', 'Platform-wide job monitoring. Cross-reference with escalation/dispute system.'],
              ['Payments', 'Payment oversight across all transactions.'],
              ['Reports', 'Platform analytics with PDF/CSV export.'],
              ['Disputes', 'Dispute management linked to specific jobs.'],
              ['Categories', 'Manage service categories and subcategories.'],
              ['Fees', 'Configure platform fee percentages by service type.'],
              ['Templates', 'Manage document templates (lease templates, service agreements).'],
              ['Documents', 'Platform-wide document oversight across all roles.'],
              ['Support', 'Support ticket chat interface.'],
              ['Settings', 'Global platform settings.'],
            ],
          },
        ],
      },
      {
        id: 'provider-approval',
        title: 'Provider Approval Process',
        description: 'How Admins review and approve new Service/Space Providers.',
        tags: ['approval', 'provider', 'admin', 'onboarding'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Provider applies', description: 'Service or Space Provider submits application at /apply/service-provider or /apply/space-provider.', actor: 'Provider' },
              { label: 'Application queued', description: 'Application appears in Admin dashboard → Approvals section with status Pending.', actor: 'System' },
              { label: 'Admin reviews', description: 'Admin reviews submitted details: business name, trade license, contact info, service type/area.', actor: 'Admin' },
              { label: 'Approve or reject', description: 'Admin clicks Approve (account activated, dashboard unlocked) or Reject (with reason message).', actor: 'Admin' },
              { label: 'Provider notified', description: 'Provider receives email with approval confirmation or rejection reason.', actor: 'System' },
            ],
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'architecture',
    label: 'Architecture',
    icon: '🏗️',
    sections: [
      {
        id: 'data-sources',
        title: 'Data Architecture',
        description: 'How data is stored and accessed across the platform.',
        tags: ['database', 'postgresql', 'architecture', 'storage', 'backend'],
        blocks: [
          {
            type: 'text',
            md: 'The platform uses a single **PostgreSQL** database (via TypeORM on the NestJS backend). All business data lives in the same database — no external services.',
          },
          {
            type: 'grid',
            items: [
              { icon: '🐘', title: 'PostgreSQL', desc: 'Primary data store. All users, bookings, contracts, deposits, units, properties, documents.', badge: 'Core', badgeColor: 'green' },
              { icon: '🗂️', title: 'NestJS API', desc: 'TypeORM entities map directly to database tables. 54-table schema covering all modules.', badge: 'Backend', badgeColor: 'blue' },
              { icon: '📁', title: 'File Storage', desc: 'Documents and proof-of-work photos stored via configured storage adapter (local or S3-compatible).', badge: 'Files', badgeColor: 'amber' },
              { icon: '🔐', title: 'JWT Auth', desc: 'Stateless auth with access + refresh token pair. No external auth provider.', badge: 'Auth', badgeColor: 'purple' },
            ],
          },
          {
            type: 'heading',
            text: 'Key Tables',
            level: 3,
          },
          {
            type: 'table',
            headers: ['Module', 'Key Tables'],
            rows: [
              ['Auth & Users', 'users, profiles, refresh_tokens'],
              ['Properties / Spaces', 'properties, units, unit_images, amenities'],
              ['Bookings (Services)', 'bookings, booking_statuses, booking_payments'],
              ['Technicians', 'technicians, technician_skills, job_assignments'],
              ['Leases / Agreements', 'tenancy_contracts, lease_documents, compliance_records'],
              ['Financials', 'security_deposits, receivables, collections, payout_records'],
              ['Renewals', 'renewal_pipeline, renewal_offers, renewal_history'],
              ['Vendors', 'vendors, vendor_contracts, amc_documents'],
              ['Documents', 'documents, document_templates, document_access'],
              ['Notifications', 'notifications, notification_preferences'],
              ['Disputes', 'disputes, dispute_messages, dispute_resolutions'],
              ['Settings', 'platform_fees, service_categories, platform_settings'],
            ],
          },
        ],
      },
      {
        id: 'notification-system',
        title: 'Notification System',
        description: 'How real-time notifications work across all roles.',
        tags: ['notifications', 'real-time', 'events', 'alerts'],
        blocks: [
          {
            type: 'text',
            md: 'The notification system is **role-based and event-driven**. Every significant state change triggers notifications to the relevant roles.',
          },
          {
            type: 'table',
            headers: ['Trigger Event', 'Notified Roles'],
            rows: [
              ['New service booking', 'Service Provider'],
              ['Job confirmed', 'Customer, Technician'],
              ['Job assigned to technician', 'Customer, Technician'],
              ['Job status change (En Route / In Progress / Completed)', 'Customer, Service Provider'],
              ['New space inquiry', 'Space Provider, Manager'],
              ['Viewing scheduled', 'Customer, Manager'],
              ['Lease contract signed', 'Customer, Space Provider'],
              ['Renewal due (≤60 days)', 'Space Provider, Manager, Customer'],
              ['Renewal offer sent to tenant', 'Customer'],
              ['Payment due / overdue', 'Customer, Manager'],
              ['Document uploaded', 'Relevant parties based on document type'],
              ['Dispute opened', 'Admin, Service Provider, Customer'],
              ['Manager invited', 'Invited Manager (email)'],
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'Notifications support **deep linking** — clicking a notification navigates directly to the relevant dashboard section and opens the target record.',
          },
        ],
      },
      {
        id: 'api-structure',
        title: 'Backend API Structure',
        description: 'How the NestJS backend is organised into modules.',
        tags: ['nestjs', 'api', 'modules', 'backend', 'rest'],
        blocks: [
          {
            type: 'text',
            md: 'The backend is a **NestJS 11** application organised into feature modules. Each module is self-contained with its own controller, service, entity, and DTOs.',
          },
          {
            type: 'code',
            lang: 'text',
            content: `src/
├── auth/               ← Login, signup, JWT, token refresh
├── users/              ← User management, roles
├── profiles/           ← Extended profile data
├── properties/         ← Property listings
├── units/              ← Unit inventory and availability
├── bookings/           ← Service bookings lifecycle
├── technicians/        ← Technician management + assignment
├── contracts/          ← Tenancy agreements
├── deposits/           ← Security deposits
├── renewals/           ← Renewal pipeline
├── collections/        ← Receivables management
├── vendors/            ← AMC vendor contracts
├── documents/          ← Document management
├── notifications/      ← Notification dispatch
├── disputes/           ← Dispute resolution
├── managers/           ← Asset manager invites + assignment
├── reports/            ← Data export (PDF/CSV)
└── admin/              ← Admin-only operations`,
          },
          {
            type: 'note',
            variant: 'info',
            md: 'Full API reference with all endpoints, request/response schemas, and authentication requirements is available at **[/docs](/docs)**.',
          },
        ],
      },
      {
        id: 'environment-config',
        title: 'Environment Configuration',
        description: 'Required environment variables for both frontend and backend.',
        tags: ['env', 'config', 'environment', 'secrets', '.env'],
        blocks: [
          {
            type: 'heading',
            text: 'Backend (.env)',
            level: 3,
          },
          {
            type: 'table',
            headers: ['Variable', 'Purpose'],
            rows: [
              ['DATABASE_URL', 'PostgreSQL connection string (postgres://user:pass@host:5432/dbname)'],
              ['JWT_SECRET', 'Secret key for signing access tokens'],
              ['JWT_REFRESH_SECRET', 'Secret key for signing refresh tokens'],
              ['JWT_EXPIRES_IN', 'Access token TTL (e.g. 15m)'],
              ['JWT_REFRESH_EXPIRES_IN', 'Refresh token TTL (e.g. 7d)'],
              ['PORT', 'Backend server port (default: 3001)'],
              ['FRONTEND_URL', 'Frontend origin for CORS whitelist'],
            ],
          },
          {
            type: 'heading',
            text: 'Frontend (.env.local)',
            level: 3,
          },
          {
            type: 'table',
            headers: ['Variable', 'Purpose'],
            rows: [
              ['NEXT_PUBLIC_API_URL', 'Backend base URL (e.g. http://localhost:3001/api)'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'Never commit `.env` files. All secrets must be injected at deploy time via your hosting provider\'s environment variable configuration.',
          },
        ],
      },
    ],
  },
];
