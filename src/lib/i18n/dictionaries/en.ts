import type { RoleGroupKey } from "@/lib/roleGroups";
import type { CompanyCategoryKey } from "@/lib/companyCategories";
import type { RelationshipFilterKey } from "@/lib/queries";
import type { MarketKey } from "@/lib/hiring/markets";

// Display labels for the role-group taxonomy. Keys are defined once in
// src/lib/roleGroups.ts (ROLE_GROUPS) and stored/queried by key — only the
// label shown to the user is localized here.
const roleGroups: Record<RoleGroupKey, string> = {
  c_level_tech: "C-Level Tech",
  c_level_business: "C-Level / Founders",
  eng_leadership: "Engineering Leadership",
  engineering_manager: "Engineering Managers",
  tech_lead_architect: "Tech Leads & Architects",
  product: "Product",
  project_delivery: "Project & Delivery",
  developers: "Developers",
  hr_recruiting: "HR & Recruiting",
  sales_bd: "Sales & BD",
  operations: "Operations",
  other: "Other",
  no_position: "No position",
};

// Display labels for the company-category taxonomy. Keys are defined once
// in src/lib/companyCategories.ts (COMPANY_CATEGORIES).
const companyCategories: Record<CompanyCategoryKey, string> = {
  fintech_payments: "Fintech & Payments",
  banking_insurance: "Banking & Insurance",
  software_services: "Software Services (competitors)",
  consulting_big4: "Consulting & Big 4",
  product_saas: "Product & SaaS",
  ecommerce_retail: "E-commerce & Retail",
  telecom_media: "Telecom & Media",
  travel_logistics: "Travel & Logistics",
  energy_industry: "Energy & Industry",
  health: "Health",
  government_education: "Government & Education",
  independent: "Independent",
  other: "Other",
  unclassified: "Unclassified",
  no_company: "No company",
};

// Display labels for the relationship-filter taxonomy. Keys are defined
// once in src/lib/queries.ts (RELATIONSHIP_FILTERS).
const relationshipFilters: Record<RelationshipFilterKey, string> = {
  reciprocal: "Reciprocal",
  dormant: "Dormant (12mo+)",
  never: "Never messaged",
};

// Display labels for the market taxonomy. Keys are defined once in
// src/lib/hiring/markets.ts (MARKETS).
const markets: Record<MarketKey, string> = {
  latam: "LATAM",
  us: "United States",
  other: "Other",
};

export const en = {
  localeName: { en: "EN", es: "ES" },

  common: {
    signOut: "Sign out",
    priorityOutreach: "priority outreach →",
    whatsNew: "what's new →",
    hiringSignals: "hiring signals →",
    boardDiscovery: "board discovery →",
    backToContacts: "← contacts",
    back: "← back",
    prev: "← prev",
    next: "next →",
    filterEyebrow: "// filter",
    filter: "Filter",
    roleGroupLabel: "Role group",
    allGroups: "All groups",
    marketLabel: "Market",
    allMarkets: "All markets",
    clearAll: "Clear all",
    pageOf: (current: number, total: number) => `${current} / ${total}`,
    totalPage: (total: number, current: number, totalPages: number) =>
      `${total} total · page ${current} of ${totalPages}`,
    dormantBadge: "dormant",
    hiringBadge: "hiring",
    alsoIn: (companies: string) => `also in ${companies}`,
    yes: "yes",
    no: "no",
    never: "never",
    ellipsis: "…",
    brandEyebrow: "// bd_contact_intelligence",
  },

  roleGroups,
  companyCategories,
  relationshipFilters,
  markets,

  home: {
    title: "contact base",
    signedInAs: (name: string, email: string) => `Signed in as ${name} (${email})`,
    importConnectionsSummary: "Import LinkedIn database",
    importMessagesSummary: "Import LinkedIn messages",
    companyLabel: "Company",
    companyPlaceholder: "e.g. Acme",
    companyCategoryLabel: "Company category",
    allCategories: "All categories",
    positionLabel: "Position",
    positionPlaceholder: "e.g. Engineering",
    relationshipLabel: "Relationship",
    anyRelationship: "Any",
    companyFromHiringChip: (key: string) => `Company (from hiring): ${key}`,
    companyChip: (value: string) => `Company: ${value}`,
    roleChip: (value: string) => `Role: ${value}`,
    categoryChip: (value: string) => `Category: ${value}`,
    positionChip: (value: string) => `Position: ${value}`,
    relationshipChip: (value: string) => `Relationship: ${value}`,
    removeCompanyKeyFilter: "Remove company key filter",
    removeCompanyFilter: "Remove company filter",
    removeRoleGroupFilter: "Remove role group filter",
    removeCompanyCategoryFilter: "Remove company category filter",
    removePositionFilter: "Remove position filter",
    removeRelationshipFilter: "Remove relationship filter",
    roleGroupSummary: (label: string, count: number, distinctTitles: number) =>
      `${label} — ${count} contacts · ${distinctTitles} distinct titles`,
    showExampleTitles: "show example titles",
    moreTitles: (n: number) => `+${n} more title${n === 1 ? "" : "s"}`,
    companyCategorySummary: (label: string, count: number, distinctCompanies: number) =>
      `${label} — ${count} contacts · ${distinctCompanies} distinct companies`,
    showExampleCompanies: "show example companies",
    moreCompanies: (n: number) => `+${n} more compan${n === 1 ? "y" : "ies"}`,
    contactsEyebrow: "// contacts",
    tableName: "Name",
    tableCompany: "Company",
    tablePosition: "Position",
    tableRelationship: "Relationship",
    tableTeamOverlap: "Team overlap",
    msgsCount: (n: number) => `${n} msgs`,
    noContacts: "No contacts yet. Import your Connections.csv above.",
  },

  hiring: {
    eyebrow: "// hiring_signals",
    title: "open IT roles",
    subtitle:
      "Target companies currently hiring for IT roles, tracked from their public job boards.",
    companiesEyebrow: "// companies",
    empty:
      "No open IT postings tracked yet. Seed target companies (see scripts/seed-target-companies.ts) and run a sync.",
    postingCount: (n: number) => `${n} open IT posting${n === 1 ? "" : "s"}`,
    newBadge: (n: number) => `${n} new`,
    showPostings: "show postings",
    locationNA: "location n/a",
    postedOn: (date: string) => `· posted ${date}`,
    contactCount: (n: number) => `${n} contact${n === 1 ? "" : "s"}`,
    leadershipCount: (n: number) => `· ${n} leadership`,
  },

  discovery: {
    eyebrow: "// board_discovery",
    title: "board discovery queue",
    subtitle:
      "Companies from the team's contact base with a likely public ATS board, found automatically — review and approve to start tracking their postings.",
    lastRunEyebrow: "// last run",
    noRunsYet: "No discovery run yet. Trigger one manually or wait for the weekly cron.",
    lastRunSummary: (when: string, probed: number, hits: number) =>
      `${when} — ${probed} compan${probed === 1 ? "y" : "ies"} probed, ${hits} hit${hits === 1 ? "" : "s"}`,
    lastRunFailed: "failed",
    lastRunUnfinished: "did not finish",
    statusCounts: (pending: number, approved: number, rejected: number) =>
      `${pending} pending · ${approved} approved · ${rejected} rejected`,
    queueEyebrow: "// pending review",
    queueEmpty: "No pending candidates. Nothing left to review right now.",
    tableCompany: "Company",
    tableBoard: "ATS / slug",
    tableJobs: "Job count",
    tableSampleTitles: "Sample titles",
    tableMarkets: "Markets",
    marketsUnknown: "—",
    tableContacts: "Team contacts",
    tableActions: "Decision",
    // Deliberately phrased as "team" — this is an aggregate across every
    // BD's contacts, not the signed-in BD's own count. See the table
    // comment on board_candidate in src/db/schema.ts.
    teamContactCount: (n: number) => `${n} team contact${n === 1 ? "" : "s"}`,
    approve: "Approve",
    reject: "Reject",
  },

  outreach: {
    eyebrow: "// priority_outreach",
    title: "who to message this week",
    subtitle:
      "Your contacts at companies currently hiring IT, ranked by relationship strength and seniority.",
    excludeNeverMessaged: "Exclude never-messaged contacts",
    candidatesEyebrow: "// candidates",
    noHiringCompaniesPrefix: "No hiring companies synced yet. Seed target companies and run a sync (see ",
    noHiringCompaniesLinkText: "hiring signals",
    noHiringCompaniesSuffix: ") before priority outreach has anything to rank.",
    noMatchingContacts: (
      hiringCompanyCount: number,
      roleGroupFilterActive: boolean,
      messageHistoryFilterActive: boolean,
    ) =>
      `${hiringCompanyCount} compan${hiringCompanyCount === 1 ? "y is" : "ies are"} hiring IT, but none of your contacts work there${
        roleGroupFilterActive ? " in this role group" : ""
      }${messageHistoryFilterActive ? " with a message history" : ""}. Try clearing the filter above.`,
    tableName: "Name",
    tablePosition: "Position",
    tableCompany: "Company",
    tableRoleGroup: "Role group",
    tableOpenRoles: "Open IT roles",
    tableLastContact: "Last contact",
    tableWhy: "Why",
    reasonDormantSince: (relTime: string, months: number) =>
      `Dormant since ${relTime} (${months}mo+ quiet)`,
    reasonDormant: "Dormant",
    reasonReciprocalActive: (relTime: string) => `Reciprocal · active ${relTime}`,
    reasonReciprocal: "Reciprocal",
    reasonContactedNoReply: (relTime: string) => `Contacted ${relTime}, no reply yet`,
    reasonContactedNoReplyGeneric: "Contacted, no reply yet",
    reasonNeverMessaged: "Never messaged",
    companyFallback: "company",
    reasonOpenRoles: (company: string, n: number) =>
      `${company} has ${n} open IT role${n === 1 ? "" : "s"}`,
  },

  whatsNew: {
    eyebrow: "// whats_new",
    title: "what's new",
    subtitle:
      "IT postings that appeared or closed recently at companies you track, newest activity first.",
    windowLabel: "Window",
    windowDays: (n: number) => `${n} days`,
    lastSyncAt: (date: string) => `Last successful sync: ${date}`,
    neverSynced: "No successful sync has completed yet.",
    noMonitoredCompaniesPrefix:
      "No target companies are being tracked yet. Seed target companies (see ",
    noMonitoredCompaniesLinkText: "hiring signals",
    noMonitoredCompaniesSuffix: ") before there is anything new to show here.",
    noSyncYet:
      "The sync job hasn't run yet, so there is no posting activity to show. Check back after the next sync.",
    noNewPostings: (n: number) =>
      `No new IT postings in the last ${n} days. Try a wider window.`,
    companiesEyebrow: "// new_postings",
    newPostingsCount: (n: number) => `${n} new posting${n === 1 ? "" : "s"}`,
    restContactCount: (n: number) => `· ${n} other${n === 1 ? "" : "s"}`,
    suggestedContactsLabel: "Suggested contacts",
    showPostings: "show postings",
    firstSeenOn: (date: string) => `· first seen ${date}`,
    closuresEyebrow: "// closures",
    closuresTitle: "Recently closed",
    closuresSubtitle:
      "Postings that closed in this window at companies where you have contacts.",
    closedOn: (date: string) => `closed ${date}`,
  },

  contact: {
    eyebrow: "// contact",
    unnamed: "unnamed",
    fieldFirstName: "First name",
    fieldLastName: "Last name",
    fieldCompany: "Company",
    fieldPosition: "Position",
    fieldIndustry: "Industry",
    fieldEmail: "Email",
    fieldConnectedOn: "Connected on",
    fieldLinkedinProfile: "LinkedIn profile",
    fieldTeamOverlap: "Team overlap",
    fieldAddedOn: "Added on",
    empty: "empty",
    relationshipSignals: "Relationship signals",
    fieldMessages: "Messages",
    messagesTotal: (n: number) => `${n} total`,
    fieldSentReceived: "Sent / received",
    sentReceived: (sent: number, received: number) => `${sent} sent · ${received} received`,
    fieldFirstContact: "First contact",
    fieldLastContact: "Last contact",
    fieldStartedBy: "Started by",
    startedByMe: "Me",
    startedByThem: "Them",
    fieldReciprocal: "Reciprocal",
    fieldStatus: "Status",
    noMessages: "No messages recorded with this contact yet.",
    conversationHistory: "Conversation history",
    moreConversationsNotice: (shown: number) =>
      `Showing the ${shown} most recent conversations — older conversations with this contact are not shown.`,
    moreMessagesNotice:
      "Showing the most recent 100 messages across the conversations below — older messages are not shown.",
    untitledConversation: "Untitled conversation",
    messageCountLabel: (n: number) => `${n} messages`,
    lastMessageTime: (relTime: string) => `· last ${relTime}`,
    unknownSender: "Unknown sender",
  },

  login: {
    title: "sign in",
    signUpIntro: "New here?",
    signUpHintPrefix: "Create an account with your ",
    signUpHintSuffix: " email.",
    workEmail: "Work email",
    password: "Password",
    signIn: "Sign in",
    createAccount: "Create account",
    enterEmailPassword: "Enter your email and password first.",
    domainRestricted: (domain: string) => `Accounts are limited to ${domain} emails.`,
    passwordTooShort: "Use at least 8 characters for your password.",
    accountCreated: "Account created. Check your inbox to confirm, then sign in.",
  },

  account: {
    eyebrow: "// welcome",
    title: "Set your password",
    subtitle: "Choose a password to finish setting up your account.",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    saveAndContinue: "Save and continue",
    passwordTooShort: "Use at least 8 characters.",
    passwordsDontMatch: "Passwords don't match.",
  },

  upload: {
    connectionsLabel: "LinkedIn Connections.csv",
    import: "Import",
    importing: "Importing…",
    importedContacts: (n: number) => `Imported ${n} contacts.`,
    messagesLabel: "LinkedIn messages.csv",
    importedMessages: (messages: number, conversations: number) =>
      `Imported ${messages} messages across ${conversations} conversations`,
    detectedSender: (profileKey: string) => ` (detected sender: ${profileKey}`,
    withConfidence: (pct: number) => `, confidence ${pct}%)`,
    closeParen: ")",
    cleanupWarning:
      "Import succeeded, but the staged upload could not be deleted from storage. Please remove it manually.",
    connectionsErrors: {
      missingFile: "Choose a Connections.csv file first.",
      noConnectionsFound:
        "No connections found. Make sure this is the LinkedIn Connections.csv export.",
      genericFailed: "Upload failed.",
    },
    messagesErrors: {
      missingFile: "Choose a messages.csv file first.",
      notAuthenticated: "Not authenticated. Please sign in again.",
      storageUploadFailedPrefix: "Upload failed: ",
      missingFileRef: "Missing uploaded file reference.",
      invalidFileRef: "Invalid file reference.",
      downloadFailed: "Could not read the uploaded file. Please try again.",
      noMessagesFound:
        "No messages found. Make sure this is the LinkedIn messages.csv export.",
      genericFailed: "Upload failed.",
    },
  },
};
