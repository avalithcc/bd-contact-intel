"use client";

import { Suspense, useEffect, useState, type ComponentType, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  CONTACTS_LIST_MEMORY_KEY,
  CONTACTS_LIST_PATH,
  contactsListHref,
  listQueryToRemember,
} from "@/lib/contacts/listMemory";
import { isNavItemActive, shouldSetPending } from "@/lib/nav/pendingNav";
import type { NavLabels } from "@/lib/i18n/navLabels";
import {
  ContactsIcon,
  CompaniesIcon,
  TasksIcon,
  FollowUpIcon,
  OutreachIcon,
  HiringIcon,
  WhatsNewIcon,
  DiscoveryIcon,
  PlaybookIcon,
  StatusGuideIcon,
  AccountIcon,
  EyeIcon,
  PersonIcon,
  ReportsIcon,
  AbsorbIcon,
  SendIcon,
  BoltIcon,
  ClockIcon,
  MailIcon,
  MeetingIcon,
} from "@/components/icons";

/** Longest a clicked item stays highlighted without the route committing. */
const PENDING_TIMEOUT_MS = 10_000;

export interface SidebarItem {
  labelKey: Exclude<
    keyof NavLabels,
    "workspaceSection" | "signalsSection" | "account" | "contactsFallback" | "toggleSidebar"
  >;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

export interface SidebarSection {
  titleKey: Extract<keyof NavLabels, "workspaceSection" | "signalsSection">;
  items: SidebarItem[];
}

// App shell nav (design.md D9, Phase 8; mockup-port 02 re-markup). Routes are
// unchanged from the pre-Phase-8 sidebar — only the visual language
// (mockups/styles.css `.sidenav`/`.nav-item`, now via design-system.css's
// global classes instead of Sidebar.module.css) and, per the Phase 8
// fresh-review fix, the labels (now sourced from the `es` dictionary
// instead of hardcoded English) change here. Icons added in mockup-parity
// 3.3 (see src/components/icons.tsx for provenance/deviation notes, incl.
// why "outreach" gets an icon at all even though it's gone from the
// mockup).
//
// Item counts (mockup's `.nav-count`/`.pill-count`) are intentionally left
// out here for contacts/discovery — no cheap count-only query exists yet for
// those (getContactListPage etc. return full rows, not a lightweight count).
// "Tareas" is the one exception (task-reminders backlog): getTaskBadgeCount
// is a single bounded `count(*)`, so AppLayout fetches it (one extra round
// trip, riding the same `getCurrentBd()` call every page already pays for)
// and passes it in as `taskCount` below, rendered with the mockup's own
// `.pill-count` class (tasks.html's `Tareas<span class="pill-count">4</span>`).
export const NAVIGATION: SidebarSection[] = [
  {
    titleKey: "workspaceSection",
    items: [
      { labelKey: "leads", href: "/contacts", icon: ContactsIcon },
      { labelKey: "companies", href: "/companies", icon: CompaniesIcon },
      { labelKey: "tasks", href: "/tasks", icon: TasksIcon },
      { labelKey: "followUps", href: "/follow-ups", icon: FollowUpIcon },
      { labelKey: "meetings", href: "/reuniones", icon: MeetingIcon },
      { labelKey: "sequences", href: "/sequences", icon: SendIcon },
      { labelKey: "scheduled", href: "/scheduled", icon: ClockIcon },
      { labelKey: "outreach", href: "/contacts?view=outreach", icon: OutreachIcon },
    ],
  },
  {
    titleKey: "signalsSection",
    items: [
      { labelKey: "hiring", href: "/hiring", icon: HiringIcon },
      { labelKey: "whatsNew", href: "/whats-new", icon: WhatsNewIcon },
      { labelKey: "discovery", href: "/discovery", icon: DiscoveryIcon },
    ],
  },
];

/**
 * Records the contacts list's query (filters, tab, sort, page) while she is on
 * it, so the "Contactos" link can bring her back to it from a record. Reads
 * `useSearchParams`, hence its own Suspense boundary: the rest of the shell
 * stays static.
 */
function ContactsListMemory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const query = listQueryToRemember(pathname, search);
    if (query === null) return;
    try {
      sessionStorage.setItem(CONTACTS_LIST_MEMORY_KEY, query);
    } catch {
      // Storage blocked: the link simply stays the bare /contacts.
    }
  }, [pathname, search]);
  return null;
}

/**
 * App shell sidebar (design.md D9, Phase 8). Lives under `src/app/contacts/`
 * rather than `src/components/` per D9 — it's extracted only once Company
 * (or another surface) adopts it too.
 *
 * mockup-port 02: markup now matches contacts.html's `<nav class="sidenav">`
 * 1:1 via design-system.css's global classes — no more Sidebar.module.css or
 * a JS-driven mobile drawer toggle. Below the 860px breakpoint,
 * design-system.css's own `.sidenav`/`.nav-section` responsive rules (same
 * ones the mockup ships) turn the sidebar into a static wrapping icon row
 * instead of the previous fixed-position slide-out drawer — a deliberate
 * simplification to stay faithful to the approved mockup, which has no JS
 * toggle of its own.
 */
export function Sidebar({
  labels,
  taskCount,
  followUpCount,
  sequenceCount,
  scheduledCount,
  meetingCount,
  absorptionCount,
  duplicateCount,
  gmailAttentionCount,
  isAdmin,
}: {
  labels: NavLabels;
  taskCount?: number;
  followUpCount?: number;
  sequenceCount?: number;
  scheduledCount?: number;
  /** Own meetings waiting for an outcome ("Por confirmar"). */
  meetingCount?: number;
  absorptionCount?: number;
  duplicateCount?: number;
  gmailAttentionCount?: number;
  // Admin-only "Administración" section (admin-conversation-access mockup,
  // screen 1: admin-conversation.html:57-61) — "Registro de auditoría" and
  // "Reportes" (owner-reporting decision 1/5) are wired here; see
  // NAVIGATION's own comment for why Duplicados/Migración stay out of this
  // real Sidebar for now. Hidden entirely (not just visually gated) for a BD.
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  // Off the list, "Contactos" returns to the filtered list she was working;
  // on the list itself it stays the bare link so it still resets the filters.
  const [contactsHref, setContactsHref] = useState(CONTACTS_LIST_PATH);
  useEffect(() => {
    if (pathname === CONTACTS_LIST_PATH) {
      setContactsHref(CONTACTS_LIST_PATH);
      return;
    }
    try {
      setContactsHref(contactsListHref(sessionStorage.getItem(CONTACTS_LIST_MEMORY_KEY)));
    } catch {
      setContactsHref(CONTACTS_LIST_PATH);
    }
  }, [pathname]);

  // Optimistic highlight: the item clicked (by its NAVIGATION href) until the
  // pathname confirms the navigation. A pathname change of any kind clears it
  // (that covers redirects landing elsewhere); the timeout covers a navigation
  // that never commits (aborted, errored), so the sidebar cannot lie forever.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);
  useEffect(() => {
    if (pendingHref === null) return;
    const timer = setTimeout(() => setPendingHref(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingHref]);
  const markPending = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (shouldSetPending(event, pathname, href)) setPendingHref(href);
  };

  const isActive = (href: string) => isNavItemActive(pathname, pendingHref, href);
  // "Tareas"/"Seguimientos" are the NAVIGATION items with a cheap badge count
  // (see the comment above NAVIGATION), riding the pill-count class the
  // mockup already ships. "Absorciones" is a hardcoded admin entry outside
  // that loop, so it renders its own pill-count inline below.
  const pillCountByLabelKey: Partial<Record<SidebarItem["labelKey"], number | undefined>> = {
    tasks: taskCount,
    followUps: followUpCount,
    sequences: sequenceCount,
    scheduled: scheduledCount,
    meetings: meetingCount,
  };

  return (
    <nav className="sidenav" aria-label="Principal">
      <Suspense fallback={null}>
        <ContactsListMemory />
      </Suspense>
      <Link href="/" className="logo">
        avalith<span className="dot">.</span>
      </Link>

      {NAVIGATION.map((section) => (
        <div key={section.titleKey} className="nav-section">
          <div className="nav-title">{labels[section.titleKey]}</div>
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href === CONTACTS_LIST_PATH ? contactsHref : item.href}
              className={`nav-item${isActive(item.href) ? " active" : ""}`}
              aria-current={isActive(item.href) ? "page" : undefined}
              onClick={markPending(item.href)}
            >
              <item.icon className="icon" />
              {labels[item.labelKey]}
              {!!pillCountByLabelKey[item.labelKey] && (
                <span className="pill-count">{pillCountByLabelKey[item.labelKey]}</span>
              )}
            </Link>
          ))}
        </div>
      ))}

      {/* "Guías" section (openspec/changes/contact-status-guide, owner
          decision 2026-09-30): reference/manual pages for every BD, no live
          counts, NOT admin-gated (unlike "Administración" right below it).
          "Guía de roles" moved here from sidenav-footer now that a second
          reference item ("Estados de contacto") exists — same markup shape
          as the "Administración" nav-section, just without the isAdmin
          gate. */}
      <div className="nav-section">
        <div className="nav-title">{labels.guidesSection}</div>
        <Link
          href="/playbook"
          className={`nav-item${isActive("/playbook") ? " active" : ""}`}
          aria-current={isActive("/playbook") ? "page" : undefined}
          onClick={markPending("/playbook")}
        >
          <PlaybookIcon className="icon" />
          {labels.playbook}
        </Link>
        <Link
          href="/contact-status"
          className={`nav-item${isActive("/contact-status") ? " active" : ""}`}
          aria-current={isActive("/contact-status") ? "page" : undefined}
          onClick={markPending("/contact-status")}
        >
          <StatusGuideIcon className="icon" />
          {labels.contactStatusGuide}
        </Link>
      </div>

      {isAdmin && (
        <div className="nav-section">
          <div className="nav-title">{labels.administrationSection}</div>
          <Link
            href="/admin/reports"
            className={`nav-item${isActive("/admin/reports") ? " active" : ""}`}
            aria-current={isActive("/admin/reports") ? "page" : undefined}
            onClick={markPending("/admin/reports")}
          >
            <ReportsIcon className="icon" />
            {labels.reports}
          </Link>
          <Link
            href="/admin/absorptions"
            className={`nav-item${isActive("/admin/absorptions") ? " active" : ""}`}
            aria-current={isActive("/admin/absorptions") ? "page" : undefined}
            onClick={markPending("/admin/absorptions")}
          >
            <AbsorbIcon className="icon" />
            {labels.absorptions}
            {!!absorptionCount && <span className="pill-count">{absorptionCount}</span>}
          </Link>
          <Link
            href="/admin/duplicates"
            className={`nav-item${isActive("/admin/duplicates") ? " active" : ""}`}
            aria-current={isActive("/admin/duplicates") ? "page" : undefined}
            onClick={markPending("/admin/duplicates")}
          >
            <PersonIcon className="icon" />
            {labels.duplicates}
            {!!duplicateCount && <span className="pill-count">{duplicateCount}</span>}
          </Link>
          <Link
            href="/admin/audit-log"
            className={`nav-item${isActive("/admin/audit-log") ? " active" : ""}`}
            aria-current={isActive("/admin/audit-log") ? "page" : undefined}
            onClick={markPending("/admin/audit-log")}
          >
            <EyeIcon className="icon" />
            {labels.auditLog}
          </Link>
          <Link
            href="/admin/lusha"
            className={`nav-item${isActive("/admin/lusha") ? " active" : ""}`}
            aria-current={isActive("/admin/lusha") ? "page" : undefined}
            onClick={markPending("/admin/lusha")}
          >
            <BoltIcon className="icon" />
            {labels.lushaByBd}
          </Link>
          <Link
            href="/admin/gmail"
            className={`nav-item${isActive("/admin/gmail") ? " active" : ""}`}
            aria-current={isActive("/admin/gmail") ? "page" : undefined}
            onClick={markPending("/admin/gmail")}
          >
            <MailIcon className="icon" />
            {labels.gmailStatus}
            {!!gmailAttentionCount && <span className="pill-count">{gmailAttentionCount}</span>}
          </Link>
        </div>
      )}

      <div className="sidenav-footer">
        {/* "Cuenta" is the only entry left here (openspec/changes/
            contact-status-guide): "Guía de roles" moved into its own
            "Guías" nav-section above once a second reference page
            ("Estados de contacto") existed to group it with — see that
            section's comment. */}
        <Link href="/account" className="nav-item">
          <AccountIcon className="icon" />
          {labels.account}
        </Link>
      </div>
    </nav>
  );
}
