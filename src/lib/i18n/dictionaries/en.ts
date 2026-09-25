import type { RoleGroupKey } from "@/lib/roleGroups";
import type { CompanyCategoryKey } from "@/lib/companyCategories";
import type { RelationshipFilterKey } from "@/lib/queries";
import type { MarketKey } from "@/lib/hiring/markets";
import type { EmailStatusKey, LeadStatusKey } from "@/lib/leads/types";

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

// Display labels for a lead's email status. Keys are defined once in
// src/lib/leads/types.ts (EMAIL_STATUSES).
const leadEmailStatuses: Record<EmailStatusKey, string> = {
  verified: "Verified",
  probable: "Probable",
  none: "No email",
};

// Display labels for a lead's pipeline status. Keys are defined once in
// src/lib/leads/types.ts (LEAD_STATUSES).
const leadStatuses: Record<LeadStatusKey, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  discarded: "Discarded",
};

export const en = {
  localeName: { en: "EN", es: "ES" },

  common: {
    signOut: "Sign out",
    account: "account",
    changePassword: "Change password",
    priorityOutreach: "Priority Contacts",
    whatsNew: "Contact Opportunities",
    hiringSignals: "Open Roles",
    boardDiscovery: "Job Board Discovery",
    leadsNav: "Leads",
    goBack: "Go back",
    prev: "← prev",
    next: "next →",
    filterEyebrow: "// filter",
    filter: "Filter",
    roleGroupLabel: "Role group",
    allGroups: "All groups",
    marketLabel: "Market",
    allMarkets: "All markets",
    // Sub-filter within the "us" market only — matches
    // src/lib/hiring/markets.ts#isMiamiArea, which is Miami metro
    // (Miami/Miami Beach/Fort Lauderdale/Coral Gables/Doral/Hialeah), NOT
    // all of Florida (e.g. Orlando/Tampa don't match). Keep this label in
    // sync with that function's actual matching set.
    miamiOnlyLabel: "Florida only",
    // Compact badge on a company whose open IT hiring is offshore-heavy —
    // strictly more open postings in an offshore delivery hub than in LATAM
    // (see src/lib/hiring/markets.ts#isOffshoreHeavy). Shows both counts so
    // the judgment is inspectable rather than an unexplained mark —
    // factual, not disqualifying: it's a deprioritizing signal, not a
    // disqualifying one.
    offshoreBadge: (offshoreItCount: number, latamItCount: number) =>
      `offshore ${offshoreItCount} · LATAM ${latamItCount}`,
    // Opt-in filter, off by default (see resolveHiringCompanies'
    // `hideOffshore` param in src/lib/hiring/queries.ts). Hides only
    // offshore-heavy companies, not every company with any offshore
    // posting.
    hideOffshoreLabel: "Hide offshore-heavy",
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
  leadEmailStatuses,
  leadStatuses,

  home: {
    title: "contact base",
    signedInAs: (name: string, email: string) => `Signed in as ${name} (${email})`,
    importConnectionsSummary: "Import LinkedIn database",
    importMessagesSummary: "Import LinkedIn messages",
    searchLabel: "Search",
    searchPlaceholder: "Search by name, company, position, email…",
    companyCategoryLabel: "Company category",
    allCategories: "All categories",
    relationshipLabel: "Relationship",
    anyRelationship: "Any",
    companyFromHiringChip: (key: string) => `Company (from hiring): ${key}`,
    searchChip: (value: string) => `Search: ${value}`,
    roleChip: (value: string) => `Role: ${value}`,
    categoryChip: (value: string) => `Category: ${value}`,
    relationshipChip: (value: string) => `Relationship: ${value}`,
    removeCompanyKeyFilter: "Remove company key filter",
    removeSearchFilter: "Remove search filter",
    removeRoleGroupFilter: "Remove role group filter",
    removeCompanyCategoryFilter: "Remove company category filter",
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
    eyebrow: "// open_roles",
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
    eyebrow: "// job_board_discovery",
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
    openOnLinkedIn: "Open on LinkedIn",
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
    eyebrow: "// priority_contacts",
    title: "who to message this week",
    subtitle:
      "Your contacts at companies currently hiring IT, ranked by relationship strength and seniority.",
    nameFilterLabel: "Name",
    nameFilterPlaceholder: "First or last name",
    excludeNeverMessaged: "Exclude never messaged",
    // Opt-in filter, off by default (see resolveHiringCompanies'
    // `startupsOnly` param in src/lib/hiring/queries.ts). Excludes
    // unclassified companies, same as ones confirmed not a startup.
    startupsOnlyLabel: "Startups only",
    // Compact badge on a contact's company classified as a startup (see
    // src/lib/hiring/startupClassification.ts) — the row's `title`
    // attribute carries the model's own short justification as a tooltip.
    startupBadge: "startup",
    candidatesEyebrow: "// candidates",
    noHiringCompaniesPrefix: "No hiring companies synced yet. Seed target companies and run a sync (see ",
    noHiringCompaniesLinkText: "open roles",
    noHiringCompaniesSuffix: ") before priority contacts has anything to rank.",
    noMatchingContacts: (
      hiringCompanyCount: number,
      roleGroupFilterActive: boolean,
      messageHistoryFilterActive: boolean,
      companyCategoryFilterActive: boolean,
      startupsOnlyFilterActive: boolean,
    ) =>
      `${hiringCompanyCount} compan${hiringCompanyCount === 1 ? "y is" : "ies are"} hiring IT, but none of your contacts work there${
        roleGroupFilterActive ? " in this role group" : ""
      }${companyCategoryFilterActive ? " in this industry" : ""}${
        messageHistoryFilterActive ? " with a message history" : ""
      }${startupsOnlyFilterActive ? " at a company classified as a startup" : ""}. Try clearing the filter above.`,
    tableName: "Name",
    tablePosition: "Position",
    tableCompany: "Company",
    tableRoleGroup: "Role group",
    tableOpenRoles: "Open IT roles",
    tableLastContact: "Last contact",
    tableWhy: "Why",
    tableMessage: "Message",
    // Shown instead of the "view"/"generate message" row actions for a
    // teammate-exclusive Contact (fresh-review UX fix; see OutreachRow.
    // hasOwnContact) — those two actions are still bdId-scoped and would
    // 404 for a person with no legacy contact row of the calling BD's own,
    // until Phase 9's unified /contacts/[id] record page.
    unifiedRecordPending: "Available once the unified record page ships",
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
    generateMessage: "Generate message",
    generatingMessage: "Generating…",
    regenerateMessage: "Regenerate",
    copyMessage: "Copy",
    copiedMessage: "Copied!",
    generateMessageErrors: {
      notFound: "Contact not found.",
      gatewayNotConfigured:
        "The AI Gateway isn't configured yet — set AI_GATEWAY_API_KEY (or sign in with Vercel OIDC) and try again.",
      generationFailed: "Couldn't generate a message right now. Try again in a moment.",
    },
    // Shown above the generated message when prior LinkedIn history was fed
    // into the prompt (see historyCount in
    // src/app/outreach/actions.ts#generateOutreachMessage) — 0 means no
    // prior conversation, so the hint isn't shown at all (see
    // GenerateMessageButton.tsx). Kept as two plain-string templates rather
    // than a formatter function: the labels object crosses the server ->
    // client boundary as a prop, and React can't serialize functions (see
    // messageLabels.ts) — the client swaps "{n}" itself.
    generateMessageHistoryHintOne: "Takes into account 1 previous message",
    generateMessageHistoryHintMany: "Takes into account {n} previous messages",
    // Inline language picker shown before generating (or regenerating) a
    // message — see GenerateMessageButton.tsx. The chosen value is submitted
    // as the "messageLanguage" form field and decides the generated
    // message's language, independent of the UI locale.
    chooseMessageLanguage: "Choose the message language",
    messageLanguageEs: "Español",
    messageLanguageEn: "English",
    cancelChooseLanguage: "Cancel",
  },

  leads: {
    eyebrow: "// leads",
    title: "leads",
    subtitle: "Shared team leads imported from event attendee lists, one owner per lead.",
    nameFilterLabel: "Name",
    nameFilterPlaceholder: "First or last name",
    companyFilterLabel: "Company",
    companyFilterPlaceholder: "Company name",
    industryGroupLabel: "Industry",
    allIndustryGroups: "All industries",
    seniorityLabel: "Seniority",
    allSeniorities: "All seniorities",
    ownerLabel: "Owner",
    allOwners: "All owners",
    ownerMine: "Mine",
    ownerUnassigned: "Unassigned",
    emailStatusLabel: "Email",
    allEmailStatuses: "Any email status",
    statusLabel: "Status",
    allStatuses: "All statuses",
    candidatesEyebrow: "// candidates",
    tableName: "Name",
    tableJobTitle: "Job title",
    tableSeniority: "Seniority",
    tableCompany: "Company",
    tableIndustry: "Industry",
    tableEmail: "Email",
    tableOwner: "Owner",
    tableStatus: "Status",
    noLeads: "No leads match this filter.",
    unassignedOwner: "Unassigned",
    noEmail: "—",

    // /leads/[id]
    detailEyebrow: "// lead",
    backToLeads: "Back to leads",
    fieldFirstName: "First name",
    fieldLastName: "Last name",
    fieldJobTitle: "Job title",
    fieldSeniority: "Seniority",
    fieldCompany: "Company",
    fieldCompanyGroup: "Company group",
    fieldIndustry: "Industry",
    fieldIndustryGroup: "Industry group",
    fieldCity: "City",
    fieldRegion: "Region",
    fieldCountry: "Country",
    fieldAttendeeType: "Attendee type",
    fieldEmail: "Email",
    fieldEmailStatus: "Email status",
    fieldEmailConfidence: "Email confidence",
    fieldEmailSource: "Email source",
    fieldOwner: "Owner",
    fieldStatus: "Status",
    fieldNotes: "Notes",
    fieldNotesPlaceholder: "Free-text notes about this lead…",
    fieldUpdatedBy: (name: string) => `Last updated by ${name}`,
    fieldUpdatedAt: (date: string) => `on ${date}`,
    neverUpdated: "Not edited yet.",
    fieldImportedAt: (date: string) => `Last imported ${date}`,
    fieldSource: (key: string) => `Source: ${key}`,
    saveChanges: "Save changes",
    savingChanges: "Saving…",
    savedChanges: "Saved.",
    saveError: "Could not save changes. Try again.",
    empty: "—",

    // Import controls (see src/app/leads/UploadLeadsForm.tsx)
    importEyebrow: "// import",
    importTitle: "Import leads",
    importHint:
      "Upload one or more of the event export files below. Files are merged by attendee id — the mails-hunter file wins over mails-probables, which wins over the decisores file, which wins over the plain attendees file.",
    sourceKeyLabel: "Source key",
    sourceKeyPlaceholder: "e.g. fi-arg-2026",
    sourceNameLabel: "Source display name",
    sourceNamePlaceholder: "e.g. FI ARG 2026",
    attendeesFileLabel: "Attendees CSV",
    decisoresFileLabel: "Decisores (bancos/fintech) CSV",
    hunterFileLabel: "Mails — hunter CSV",
    probablesFileLabel: "Mails — probables CSV",
    correosFinalFileLabel: "correos_final.csv (optional)",
    columnaCorreosFileLabel: "columna_correos.tsv (optional)",
    import: "Import",
    importing: "Importing…",
    // Placeholder templates, not formatter functions: these cross into a
    // "use client" component (see src/lib/leads/labels.ts) and React cannot
    // serialize functions. Substitution happens in UploadLeadsForm.tsx.
    importedSummary: "Imported/updated {n} leads.",
    matchedOwnersSummary: "Matched owners: {owners}.",
    unmatchedOwnersSummary:
      "Could not match these owner names to a BD, left unassigned: {owners}.",
    importErrors: {
      missingSourceKey: "Enter a source key first.",
      missingFiles: "Choose at least one file to import.",
      genericFailed: "Import failed.",
    },
  },

  whatsNew: {
    eyebrow: "// contact_opportunities",
    title: "contact opportunities",
    subtitle:
      "IT postings that appeared or closed recently at companies you track, newest activity first.",
    windowLabel: "Window",
    windowDays: (n: number) => `${n} days`,
    lastSyncAt: (date: string) => `Last successful sync: ${date}`,
    neverSynced: "No successful sync has completed yet.",
    noMonitoredCompaniesPrefix:
      "No target companies are being tracked yet. Seed target companies (see ",
    noMonitoredCompaniesLinkText: "open roles",
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
    fieldSuggestedEmail: "Suggested email",
    // Shown ONLY when the contact has no stored email and a pattern was
    // detected from the BD's own contacts at the same company (see
    // src/lib/emailSuggestion.ts) — must make clear this is an unverified
    // guess, not a confirmed address.
    suggestedEmailNote: (patternId: string, colleagueCount: number) =>
      `Not verified — guessed from ${colleagueCount} colleague${colleagueCount === 1 ? "" : "s"} at this company (pattern "${patternId}").`,
    // Shown ONLY for an "assumed" suggestion (source: "assumed" — see
    // src/lib/emailSuggestion.ts), i.e. when no company-specific convention
    // could be confirmed from colleagues on file. Distinct from — and
    // visibly more tentative than — suggestedEmailNote above: it must say
    // plainly that the convention was NOT confirmed, and that "first.last"
    // is an industry-default ASSUMPTION applied to a domain seen on N
    // colleague addresses, not a pattern this company was observed to use.
    suggestedEmailAssumedNote: (colleagueCount: number) =>
      `Convention not confirmed — assuming the common "first.last" pattern at the domain used by ${colleagueCount} colleague${colleagueCount === 1 ? "" : "s"} at this company. This is a guess, not an observed pattern.`,
    // Shown ONLY for a "guessed-domain" suggestion (source: "guessed-domain"
    // — see src/lib/emailSuggestion.ts and src/lib/companyDomain.ts), the
    // weakest of the three levels: no colleague at this company has ANY
    // corporate email on file, so even the domain itself is a guess derived
    // from the company's name and confirmed only by public DNS. Must say
    // plainly that the company could not be confirmed and that BOTH the
    // domain and the local-part pattern are guesses — never present this
    // like a detected convention or even like the "assumed" level above.
    guessedDomainNote: (domain: string) =>
      `Company not confirmed — no colleague email on file for this company at all. Domain "${domain}" was guessed from the company name, and the address uses the common "first.last" pattern. Both are guesses — please verify manually before using this address; company names can collide with unrelated businesses.`,
    // Confidence chip shown next to a suggested email — see
    // src/lib/emailSuggestion.ts#SuggestionConfidence. Always paired with
    // suggestedEmailNote/domainReason so the wording stays honest: this is
    // an inferred address whose DOMAIN was checked for mail delivery, never
    // a verified mailbox.
    confidenceLabel: (confidence: "high" | "medium" | "low"): string =>
      confidence === "high" ? "High confidence" : confidence === "medium" ? "Medium confidence" : "Low confidence",
    // One-line reason shown under the suggestion when the domain is
    // confirmed to accept mail (MX records found via DNS — see
    // src/lib/emailDomain.ts). Never claims the specific mailbox exists.
    domainReason: (colleagueCount: number) =>
      `Domain accepts mail · inferred from ${colleagueCount} colleague${colleagueCount === 1 ? "" : "s"}.`,
    // Shown instead of domainReason when the MX lookup failed or timed out
    // (not the same as a confirmed "no mail" — that case hides the
    // suggestion entirely, see suggestEmailForContact).
    domainUnconfirmedReason: "Domain's ability to receive mail could not be confirmed.",
    // Shown instead of domainReason/domainUnconfirmedReason for a
    // "guessed-domain" suggestion. hasMx is always true here (that's the
    // acceptance bar in companyDomain.ts), but unlike the detected/assumed
    // paths, no colleague ever confirmed this domain belongs to the
    // company — so this must NOT claim colleague evidence, only that the
    // guessed domain itself is technically capable of receiving mail.
    guessedDomainReason:
      "Guessed domain accepts mail, but nothing here confirms it actually belongs to this company — a different, unrelated company could share the same name.",
    // Shown only when provider is "microsoft" — Microsoft 365 accepts mail
    // for unknown recipients by default, so even a paid SMTP-verification
    // service cannot confirm this specific mailbox exists.
    microsoftProviderNote:
      "This domain uses Microsoft 365, which accepts mail for unknown addresses by default — no verification method, including paid ones, can confirm this specific mailbox exists.",
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
    skippedOwnCompany: (n: number) =>
      `Skipped ${n} Avalith coworker${n === 1 ? "" : "s"}.`,
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

  // /admin/migration (crm-hubspot-ux Phase 3). This is a NEW admin-only
  // screen in the R11 Spanish-only design language — the page always
  // renders `es` regardless of locale (see src/app/admin/migration/page.tsx).
  // This English copy exists only to satisfy `Dictionary = typeof en`
  // until PR 8 removes the dual-dictionary structure (design D10).
  migration: {
    eyebrow: "Admin · Migration",
    title: "Contact migration dry run",
    subtitle: "Review the report before approving the production run.",
    noRuns: "No dry run has been executed yet.",
    generatedAt: (date: string) => `Generated ${date}`,
    inputHash: (hash: string) => `input hash ${hash}`,
    modeDryRun: "Dry run",
    modeExecute: "Execute",
    statusPending: "Pending",
    statusApproved: "Approved",
    statusExecuted: "Executed",
    notExecutedWarning: "Not executed. No production data was changed.",
    approveButton: "Approve dry run",
    approvedBy: (name: string, date: string) => `Approved by ${name} on ${date}`,
    executedAt: (date: string) => `Executed on ${date}`,
    backupPath: (path: string) => `Backup: ${path}`,
    sectionCollapseTitle: "Phase 1 · Collapse LinkedIn contacts",
    sectionFoldTitle: "Phase 2 · Fold in leads",
    sectionCatchUpTitle: "Phase 4B · Incremental catch-up",
    reportTitle: "Phase 1 · Collapse LinkedIn contacts",
    foldReportTitle: "Phase 2 · Fold in leads",
    catchUpReportTitle: "Phase 4B · Incremental catch-up",
    tableRowsRead: "Contact rows read",
    tableOwnCompanySkipped: "Own-company skipped",
    tableAutoMerged: "Auto-merged by LinkedIn profile",
    tableFlaggedForReview: "Flagged for review (name + company)",
    tableNewPersons: "New contacts",
    tableMultiBd: "People connected with 2+ BDs",
    tableUnparseableDates: "“Connected On” not parseable (sorts last)",
    tableTotalConnections: "Total connections",
    tableLeadRowsRead: "Lead rows read",
    tableLeadOwnCompanySkipped: "Own-company skipped",
    tableLeadAutoMerged: "Auto-merged by verified email",
    tableLeadFlaggedForReview: "Flagged for review (name + company)",
    tableLeadNew: "New contacts",
    tableStatusBackfilled: "Status backfilled with retroactive activity",
    tablePersonsCreated: "Contacts created",
    tablePersonsUpdated: "Contacts updated",
    tableCatchUpRowsRead: "Unmapped rows read",
    tableCatchUpOwnCompanySkipped: "Own-company skipped",
    tableCatchUpAutoMerged: "Auto-merged",
    tableCatchUpFlaggedForReview: "Flagged for review (name + company)",
    tableCatchUpNew: "New contacts",
    tableCatchUpLeadsSkippedNoOwner: "Owner-less leads (retried next run)",
    historyTitle: "Run history",
    historyRun: "Run",
    historyMode: "Mode",
    historyStatus: "Status",
    historyApprovedBy: "Approved by",
    historyWhen: "When",
    approveErrors: {
      not_found: "The run to approve was not found.",
      wrong_kind: "This run does not belong to this phase.",
      already_executed: "This run was already executed.",
      already_approved: "This run was already approved.",
      not_latest_dry_run: "A newer dry run exists; this one can no longer be approved.",
    },
  },
};
