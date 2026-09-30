"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  AccountIcon,
  EyeIcon,
  PersonIcon,
  ReportsIcon,
} from "@/components/icons";

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
  isAdmin,
}: {
  labels: NavLabels;
  taskCount?: number;
  followUpCount?: number;
  // Admin-only "Administración" section (admin-conversation-access mockup,
  // screen 1: admin-conversation.html:57-61) — "Registro de auditoría" and
  // "Reportes" (owner-reporting decision 1/5) are wired here; see
  // NAVIGATION's own comment for why Duplicados/Migración stay out of this
  // real Sidebar for now. Hidden entirely (not just visually gated) for a BD.
  isAdmin?: boolean;
}) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);
  // "Tareas"/"Seguimientos" are the only two items with a cheap badge count
  // today (see the comment above NAVIGATION) — both riding the pill-count
  // class the mockup already ships.
  const pillCountByLabelKey: Partial<Record<SidebarItem["labelKey"], number | undefined>> = {
    tasks: taskCount,
    followUps: followUpCount,
  };

  return (
    <nav className="sidenav" aria-label="Principal">
      <Link href="/" className="logo">
        avalith<span className="dot">.</span>
      </Link>

      {NAVIGATION.map((section) => (
        <div key={section.titleKey} className="nav-section">
          <div className="nav-title">{labels[section.titleKey]}</div>
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${isActive(item.href) ? " active" : ""}`}
              aria-current={isActive(item.href) ? "page" : undefined}
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

      {isAdmin && (
        <div className="nav-section">
          <div className="nav-title">{labels.administrationSection}</div>
          <Link
            href="/admin/reports"
            className={`nav-item${isActive("/admin/reports") ? " active" : ""}`}
            aria-current={isActive("/admin/reports") ? "page" : undefined}
          >
            <ReportsIcon className="icon" />
            {labels.reports}
          </Link>
          <Link
            href="/admin/duplicates"
            className={`nav-item${isActive("/admin/duplicates") ? " active" : ""}`}
            aria-current={isActive("/admin/duplicates") ? "page" : undefined}
          >
            <PersonIcon className="icon" />
            {labels.duplicates}
          </Link>
          <Link
            href="/admin/audit-log"
            className={`nav-item${isActive("/admin/audit-log") ? " active" : ""}`}
            aria-current={isActive("/admin/audit-log") ? "page" : undefined}
          >
            <EyeIcon className="icon" />
            {labels.auditLog}
          </Link>
        </div>
      )}

      <div className="sidenav-footer">
        {/* "Guía de roles" (openspec/changes/bd-playbook, owner decision
            2026-09-30): grouped with "Cuenta" as a reference/setup item with
            no live count, not under "Espacio de trabajo" (reserved for
            objects a BD works through with counts/pills). This group is
            expected to grow with more reference items later; if it doesn't,
            this entry moves into "Mi perfil" (/account) instead — the route
            below (src/app/(app)/playbook) is self-contained for exactly
            that move. */}
        <Link
          href="/playbook"
          className={`nav-item${isActive("/playbook") ? " active" : ""}`}
          aria-current={isActive("/playbook") ? "page" : undefined}
        >
          <PlaybookIcon className="icon" />
          {labels.playbook}
        </Link>
        <Link href="/account" className="nav-item">
          <AccountIcon className="icon" />
          {labels.account}
        </Link>
      </div>
    </nav>
  );
}
