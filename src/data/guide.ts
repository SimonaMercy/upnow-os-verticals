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
// CEO-FRIENDLY GUIDE — plain language, workflow-focused, accurate to current build (May 2026)

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
                desc: 'Property owners list apartments, offices, and commercial units. Tenants browse, view, and sign rental contracts — all online. No paperwork, no back-and-forth emails.',
              },
              {
                icon: '🔧',
                title: 'Book a Home Service',
                desc: 'Customers book home services (AC, plumbing, cleaning, painting, electrical) from verified companies. A technician comes to their door. Payment is held safely until the job is done.',
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
              ['🧑 Customer / Tenant', 'Books home services and/or rents properties', 'Self-register at sign-up'],
              ['🏢 Rental Provider', 'Lists properties and manages tenants', 'Self-register, then identity verified'],
              ['📋 Asset Manager', 'Manages day-to-day operations for a Rental Provider', 'Invited by email from a Rental Provider'],
              ['🔧 Service Provider', 'Company offering home services (AC, cleaning, etc.)', 'Self-register, then identity verified'],
              ['👷 Technician', 'Field worker who carries out the service jobs', 'Invited by email from a Service Provider'],
              ['⚙️ Admin', 'UpNow staff — oversees the whole platform', 'Internal access only'],
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'A role is chosen at registration and cannot be changed by the user. Only an Admin can reassign a role.',
          },
        ],
      },
      {
        id: 'getting-started',
        title: 'Getting Started — Signing Up & Logging In',
        description: 'How any new user creates an account and accesses the platform.',
        tags: ['signup', 'login', 'register', 'account'],
        blocks: [
          {
            type: 'steps',
            title: 'For Customers',
            steps: [
              { label: 'Go to upnow.ae', description: 'You can browse listings and services without creating an account.', actor: 'Customer' },
              { label: 'Click "Sign Up"', description: 'Choose "Customer" as your role. Enter your name, email, phone, and a password.', actor: 'Customer' },
              { label: 'Verify your email', description: 'An email link is sent to your inbox. Click it to activate your account.', actor: 'Customer' },
              { label: 'Log in', description: 'Use your email and password. You land on the homepage and can browse or book immediately.', actor: 'Customer' },
            ],
          },
          { type: 'divider' },
          {
            type: 'steps',
            title: 'For Rental Providers & Service Providers',
            steps: [
              { label: 'Register as a Provider', description: 'Select your role (Rental Provider or Service Provider) at sign-up. Enter business details.', actor: 'Provider' },
              { label: 'Complete your profile', description: 'Upload your trade licence and identity documents (KYC). Your account is activated once verified.', actor: 'Provider' },
              { label: 'Log in to your dashboard', description: 'Your dashboard shows all properties/jobs, your team, contracts, and financials.', actor: 'Provider' },
            ],
          },
          { type: 'divider' },
          {
            type: 'steps',
            title: 'For Asset Managers & Technicians (Invite-Only)',
            steps: [
              { label: 'Receive an invitation email', description: 'Your Rental Provider or Service Provider sends you an invite from their dashboard.', actor: 'Invitee' },
              { label: 'Click the link in the email', description: 'The link takes you to UpNow where you set your password.', actor: 'Invitee' },
              { label: 'Log in', description: 'You land directly on your role-specific dashboard.', actor: 'Invitee' },
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'customer',
    label: 'Customer / Tenant',
    icon: '👤',
    sections: [
      {
        id: 'customer-renting',
        title: 'How to Rent a Property',
        description: 'Step-by-step: from browsing to signing a contract and moving in.',
        tags: ['rental', 'contract', 'tenant', 'viewing', 'offer'],
        blocks: [
          {
            type: 'note',
            variant: 'warning',
            md: '🚧 **The full tenant rental journey (interest → viewing → offer) is in development.** Currently, the listings browse page is live and properties are visible. The steps below describe the intended workflow for Sprint 2–4.',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Browse properties', description: 'Go to the Listings page (/listings). Filter by property category (Residential, Commercial, Industrial), space type (Apartment, Villa, Studio…), emirate (Dubai, Abu Dhabi, Sharjah…), number of bedrooms, and price range.', actor: 'Customer' },
              { label: 'View a property', description: 'Click any listing to see photos, floor plan, amenities, annual rent, and available units.', actor: 'Customer' },
              { label: 'Contact the provider', description: '🚧 Coming soon — a contact/interest button on the listing page will notify the Rental Provider. For now, contact must happen outside the platform.', actor: 'Customer' },
              { label: 'Attend the viewing', description: '🚧 Coming soon — viewings will be scheduled and confirmed inside the platform.', actor: 'Customer' },
              { label: 'Sign the contract', description: 'Once the Rental Provider creates a contract for you, log in to "My Contracts". Review all terms. Sign digitally.', actor: 'Customer' },
              { label: 'You are now a tenant', description: 'Your active tenancy appears in your dashboard under "My Spaces". You can view payment schedules, documents, and maintenance history from here.', actor: 'Customer' },
            ],
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
            md: '🚧 **Service booking is in development.** The services browse page is live. The booking checkout and job tracking are coming in Sprint 3.',
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
        tags: ['dashboard', 'my spaces', 'contracts', 'viewings'],
        blocks: [
          {
            type: 'table',
            headers: ['Section', 'What You Can Do', 'Status'],
            rows: [
              ['Overview', 'See a summary of your active tenancies and upcoming viewings.', '✅ Live'],
              ['My Contracts', 'View all rental contracts, sign pending ones, download copies.', '✅ Live'],
              ['My Spaces', 'See active tenancies — rent schedule, documents, deposit status.', '✅ Live'],
              ['Viewings', 'See your scheduled property viewings.', '✅ Live'],
              ['My Bookings', 'Track home service jobs (status, technician, proof of work).', '🚧 Coming soon'],
              ['Maintenance', 'Log a maintenance request for your rented property.', '🚧 Coming soon'],
            ],
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
        id: 'rp-listing',
        title: 'How to List a Property',
        description: 'Step-by-step: adding a property and its rentable units to UpNow.',
        tags: ['property', 'listing', 'units', 'publish'],
        blocks: [
          {
            type: 'note',
            variant: 'success',
            md: '✅ **Property and unit creation is live and functional.**',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Go to Portfolio', description: 'In your dashboard, open the Portfolio section. Click "Add Property".', actor: 'Rental Provider' },
              { label: 'Enter building details', description: 'Building name, emirate, area, address, and number of floors. Upload at least one photo.', actor: 'Rental Provider' },
              { label: 'Add units', description: 'For each rentable unit: enter the unit number, type (apartment, villa, studio…), size, bedrooms, bathrooms, amenities, and photos.', actor: 'Rental Provider' },
              { label: 'Set the price', description: 'Annual rent in AED. Choose how many cheques (1, 2, 4, 6, or 12). Set the security deposit amount.', actor: 'Rental Provider' },
              { label: 'Publish', description: 'The unit appears live on the public listings page. Tenants can find it and express interest.', actor: 'Rental Provider' },
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'A full step-by-step 13-screen listing wizard (with map, highlights, documents) is on the roadmap for Sprint 2.',
          },
        ],
      },
      {
        id: 'rp-leads',
        title: 'Managing Leads & Viewings',
        description: 'How tenant interest is tracked from first contact to a signed contract.',
        tags: ['leads', 'viewing', 'kanban', 'pipeline'],
        blocks: [
          {
            type: 'note',
            variant: 'success',
            md: '✅ **Leads pipeline is live.**',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Lead comes in', description: 'When a tenant expresses interest in a unit, a lead is created automatically in your Leads section.', actor: 'System' },
              { label: 'Track on Kanban board', description: 'Leads move through stages: New → Contacted → Viewing Scheduled → Viewing Done → Offer Sent → Won / Lost.', actor: 'Rental Provider' },
              { label: 'Schedule a viewing', description: 'Assign a date and time. The tenant is notified. Your Asset Manager can facilitate the visit.', actor: 'Rental Provider' },
              { label: 'Send an offer', description: 'Once the tenant is interested, send a formal rental offer with agreed terms directly from the lead record.', actor: 'Rental Provider' },
            ],
          },
        ],
      },
      {
        id: 'rp-contracts',
        title: 'Creating & Activating Contracts',
        description: 'How to issue a tenancy contract and get it signed by both parties.',
        tags: ['contract', 'sign', 'activate', 'tenancy'],
        blocks: [
          {
            type: 'note',
            variant: 'success',
            md: '✅ **Contracts are fully live — create, sign, countersign, and activate.**',
          },
          {
            type: 'steps',
            steps: [
              { label: 'Create the contract', description: 'From the Contracts section, click "New Contract". Select the unit, the tenant, start/end dates, and annual rent.', actor: 'Rental Provider' },
              { label: 'Tenant signs', description: 'The tenant receives a notification and signs the contract digitally from their dashboard.', actor: 'Tenant' },
              { label: 'You countersign', description: 'You sign the contract from your dashboard. Both signatures are recorded.', actor: 'Rental Provider' },
              { label: 'Activate the tenancy', description: 'Click "Activate Tenancy". The unit is marked Occupied. The tenant can now see their active tenancy in "My Spaces".', actor: 'Rental Provider' },
            ],
          },
        ],
      },
      {
        id: 'rp-dashboard',
        title: 'Rental Provider Dashboard',
        description: 'Everything available to a Rental Provider in their dashboard.',
        tags: ['dashboard', 'portfolio', 'financials', 'team'],
        blocks: [
          {
            type: 'table',
            headers: ['Section', 'What You Can Do', 'Status'],
            rows: [
              ['Overview', 'KPIs — total units, occupancy %, revenue, upcoming renewals.', '✅ Live'],
              ['Portfolio', 'View all your properties and their units.', '✅ Live'],
              ['Units', 'Full unit inventory with availability status.', '✅ Live'],
              ['Leads', 'Kanban pipeline of tenant leads and viewings.', '✅ Live'],
              ['Contracts', 'All tenancy contracts — create, sign, activate, print.', '✅ Live'],
              ['Tenants', 'List of all your active tenants.', '✅ Live'],
              ['Team', 'Invite and manage your Asset Managers.', '✅ Live'],
              ['Documents', 'Upload and manage KYC and property documents.', '✅ Live'],
              ['Orders', 'Service orders linked to your properties.', '✅ Live'],
              ['Deposits', 'Security deposit tracking.', '✅ Live'],
              ['Receivables', 'Rent collection — mark paid, send reminders.', '✅ Live'],
              ['AMC', 'Annual maintenance contract vendors.', '✅ Live'],
              ['Reports', 'Financial and occupancy reports.', '✅ Live'],
              ['Renewals', 'Full renewal pipeline for expiring leases.', '🚧 Coming soon'],
              ['Property Listing Wizard', 'Full 13-step guided listing flow.', '🚧 Coming soon'],
            ],
          },
        ],
      },
      {
        id: 'rp-team',
        title: 'Inviting an Asset Manager',
        description: 'How to add a manager to help run your properties.',
        tags: ['manager', 'invite', 'team'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Go to Team', description: 'Open the Team section in your dashboard.', actor: 'Rental Provider' },
              { label: 'Invite by email', description: 'Enter the manager\'s name and email address. They receive an invitation email.', actor: 'Rental Provider' },
              { label: 'Manager accepts', description: 'The manager clicks the link in the email, sets a password, and logs in.', actor: 'Asset Manager' },
              { label: 'Assign properties', description: 'From your dashboard, assign specific properties to the manager. They can only see and act on properties assigned to them.', actor: 'Rental Provider' },
            ],
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
        tags: ['manager', 'asset manager', 'properties'],
        blocks: [
          {
            type: 'text',
            md: 'An Asset Manager is an employee of a Rental Provider. They can only see and manage the properties their employer has assigned to them. They cannot see other properties or financial data outside their scope.',
          },
          {
            type: 'table',
            headers: ['Section', 'What They Can Do', 'Status'],
            rows: [
              ['Assigned Properties', 'View units, availability, and occupancy for their properties only.', '✅ Live'],
              ['Tenancy Agreements', 'View active leases for their properties.', '✅ Live'],
              ['Viewings', 'Facilitate and record property viewings.', '✅ Live'],
              ['Deposits & Collections', 'Track security deposits and rent payments.', '✅ Live'],
              ['Documents', 'View and manage documents for their assigned leases.', '✅ Live'],
              ['Renewals', 'Manage renewal pipeline for their properties.', '🚧 Coming soon'],
            ],
          },
          {
            type: 'note',
            variant: 'info',
            md: 'One manager can be assigned to **multiple properties**. One property can also have **multiple managers** — for example, one handling operations and another handling collections.',
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
            type: 'table',
            headers: ['Section', 'What They Can Do', 'Status'],
            rows: [
              ['Overview', 'Jobs today, revenue, technician utilisation at a glance.', '✅ Live'],
              ['Profile', 'Company details, service areas, contact information.', '✅ Live'],
              ['Onboarding', 'Complete business verification steps.', '✅ Live'],
              ['Team', 'Invite and manage technicians.', '✅ Live'],
              ['Documents', 'Trade licence, insurance, compliance documents.', '✅ Live'],
              ['Jobs / Bookings', 'Accept, assign, and track service jobs.', '🚧 Coming soon (Sprint 3)'],
              ['Service Catalog', 'Choose which services to offer and set pricing.', '🚧 Coming soon'],
              ['Payouts', 'Track earnings and platform fee deductions.', '🚧 Coming soon'],
            ],
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
              { label: 'Technician accepts', description: 'They receive an email invitation, click the link, set a password, and log in.', actor: 'Technician' },
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
            md: '🚧 **Full job management is in development (Sprint 3).** The workflow below describes the intended flow.',
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
            md: '🚧 **Technician job management is in development (Sprint 3).** The workflow below describes the intended experience.',
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
            md: 'Admins are internal UpNow team members. They have full read/write access across the whole platform — all users, all providers, all jobs, all contracts. The admin dashboard is separate from all other dashboards.',
          },
          {
            type: 'table',
            headers: ['Section', 'What Admins Can Do', 'Status'],
            rows: [
              ['Dashboard', 'Platform-wide KPIs — total users, bookings, contracts, revenue.', '✅ Live (stub)'],
              ['Accounts', 'View all user accounts. Create delegated admin accounts.', '✅ Live'],
              ['Provider Approval', 'Review and approve/reject new Rental Provider and Service Provider sign-ups.', '🚧 Coming soon (UI missing)'],
              ['KYC Review', 'Review identity documents uploaded by providers and tenants.', '🚧 Coming soon (UI missing — workaround via database)'],
              ['Properties', 'View and moderate all property listings.', '🚧 Coming soon'],
              ['Bookings & Jobs', 'Monitor all service jobs across all providers.', '🚧 Coming soon'],
              ['Disputes', 'Resolve disputes between customers and service providers.', '🚧 Coming soon'],
              ['Audit Trail', 'View a log of every significant action taken on the platform.', '✅ Live (API)'],
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: 'The Admin area is currently minimal. The full admin UI (KYC approval, provider approval, disputes) is being built in Sprint 2–3. For now, some operations (like approving KYC) require direct database access.',
          },
        ],
      },
      {
        id: 'provider-approval',
        title: 'Approving a New Provider',
        description: 'How UpNow admins verify and activate Rental Providers and Service Providers.',
        tags: ['approval', 'kyc', 'provider', 'onboarding'],
        blocks: [
          {
            type: 'steps',
            steps: [
              { label: 'Provider registers', description: 'A new Rental Provider or Service Provider signs up and uploads their identity documents (trade licence, passport, etc.).', actor: 'Provider' },
              { label: 'Admin is notified', description: 'The application appears in the Admin dashboard under Approvals.', actor: 'System' },
              { label: 'Admin reviews documents', description: 'Admin checks the uploaded documents for validity.', actor: 'Admin' },
              { label: 'Approve or reject', description: 'If approved, the provider\'s account is activated and they gain access to their dashboard. If rejected, they receive an email explaining why.', actor: 'Admin' },
            ],
          },
          {
            type: 'note',
            variant: 'warning',
            md: '🚧 The Admin KYC review UI page is not yet built. Currently, approval is done directly in the database. Tracked as **SCRUM-345**.',
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
        title: 'Platform Build Status — May 2026',
        description: 'Accurate snapshot of what is live, what is in development, and what is coming next.',
        tags: ['status', 'roadmap', 'live', 'coming soon'],
        blocks: [
          {
            type: 'note',
            variant: 'info',
            md: 'This page reflects the **actual current state** of the platform as of May 13, 2026. The full platform is being delivered across 7 sprints (May – July 2026).',
          },
          {
            type: 'heading',
            text: '✅ Live & Working',
            level: 2,
          },
          {
            type: 'table',
            headers: ['Feature', 'Details'],
            rows: [
              ['User registration & login', 'All 6 roles. Email verification. Password reset. Secure sessions.'],
              ['Property listings', 'Rental Providers can create properties and units. Units appear on the public listings page.'],
              ['Public browse', 'Anyone can browse and search properties by type, location, and price.'],
              ['Unit detail page', 'Photos, amenities, pricing, floor details.'],
              ['Leads pipeline', 'Kanban board for managing tenant interest from first contact to offer.'],
              ['Tenancy contracts', 'Create, send, sign (by tenant), countersign (by RP), and activate. Full lifecycle.'],
              ['Contract print view', 'Printable/PDF version of any signed contract.'],
              ['Rental Provider dashboard', 'Portfolio, units, leads, contracts, tenants, team, documents, deposits, receivables, AMC, reports.'],
              ['Service Provider dashboard', 'Profile, onboarding, team (invite technicians), documents.'],
              ['Customer dashboard', 'Contracts (e-sign), active tenancies, scheduled viewings.'],
              ['Asset Manager dashboard', 'Scoped view of assigned properties, leases, and collections.'],
              ['Asset Manager invitation', 'RP invites AM by email. AM sets password and gets scoped access.'],
              ['Technician invitation', 'SP invites technicians by email. Technician sets password.'],
              ['KYC document upload (API)', 'Providers can upload identity documents. Stored in S3.'],
              ['API documentation', '106 endpoints documented at /docs.'],
              ['E2E tests', '15 happy-path tests and 9 negative tests — all passing.'],
            ],
          },
          {
            type: 'heading',
            text: '🚧 In Development (Sprint 2–3)',
            level: 2,
          },
          {
            type: 'table',
            headers: ['Feature', 'Notes'],
            rows: [
              ['Service booking & checkout', 'Customer can browse services but cannot book yet. Full flow in Sprint 3.'],
              ['Job management for SP & Technician', 'Accept, assign, track, and complete jobs. Sprint 3.'],
              ['Escrow (payment hold/release)', 'Payment held until job completion. Sprint 3.'],
              ['Reviews & ratings', 'Post-job reviews by customer. Sprint 3.'],
              ['Maintenance requests', 'Tenant can log maintenance issue from their dashboard. Sprint 3.'],
              ['Admin KYC approval UI', 'Admin page to review and approve provider identity documents. Sprint 2.'],
              ['Property listing wizard (13 steps)', 'Full guided listing flow for Rental Providers. Sprint 2.'],
              ['@RequireKyc guard', 'Enforce that providers are verified before they can publish listings. Sprint 2.'],
              ['Spaces module', 'Workspace/venue booking (separate from residential rentals). Sprint 2.'],
              ['RP onboarding flow', 'Step-by-step guided onboarding for new Rental Providers. Sprint 2.'],
            ],
          },
          {
            type: 'heading',
            text: '⚠️ Known Gaps',
            level: 2,
          },
          {
            type: 'table',
            headers: ['Gap', 'Impact', 'Jira'],
            rows: [
              ['Admin KYC approval page missing', 'Admins must use the database directly to approve providers', 'SCRUM-345'],
              ['KYC upload requires real AWS S3 credentials', 'Document upload fails in local development without S3 setup', 'SCRUM-346'],
              ['Phone OTP uses live Twilio SMS', 'No test/dev bypass — each test sends a real SMS', 'SCRUM-347'],
              ['Contract e-sign is canvas-only (draw with finger)', 'No option to type your name as a signature — blocks automated testing', 'SCRUM-344'],
              ['RP "Activate Tenancy" button missing from contract page', 'RP must use API directly to activate a tenancy', 'SCRUM-343'],
            ],
          },
        ],
      },
      {
        id: 'sprint-roadmap',
        title: 'Sprint Roadmap',
        description: 'What is being built in each sprint through to July 2026.',
        tags: ['roadmap', 'sprints', 'delivery'],
        blocks: [
          {
            type: 'table',
            headers: ['Sprint', 'Period', 'Focus', 'Status'],
            rows: [
              ['Sprint 1', 'May 5–16', 'Auth, user roles, profiles, KYC upload, invitations', '✅ Complete'],
              ['Sprint 2', 'May 19–30', 'Property listing wizard, admin KYC approval, spaces module, RP onboarding', '🔄 In progress'],
              ['Sprint 3', 'Jun 2–13', 'Service booking, jobs, escrow, technician app, reviews, maintenance', '📅 Planned'],
              ['Sprint 4', 'Jun 16–27', 'Contract renewals, leads offer page, RP activate button, maintenance routing', '📅 Planned'],
              ['Sprint 5', 'Jun 30–Jul 4', 'Payments, payout management, platform fees', '📅 Planned'],
              ['Sprint 6', 'Jul 7–11', 'Notifications (SMS + push), disputes, admin reporting', '📅 Planned'],
              ['Sprint 7', 'Jul 14–18', 'Hardening, performance, UAT, production deployment', '📅 Planned'],
            ],
          },
          {
            type: 'note',
            variant: 'tip',
            md: 'All development work is tracked in **Jira** at `upnow-team.atlassian.net` (SCRUM project). New tickets are reviewed and approved by the product owner before work begins.',
          },
        ],
      },
    ],
  },
];
