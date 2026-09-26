"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavLabels } from "@/lib/i18n/navLabels";
import {
  ContactsIcon,
  CompaniesIcon,
  TasksIcon,
  OutreachIcon,
  HiringIcon,
  WhatsNewIcon,
  DiscoveryIcon,
  AccountIcon,
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
// out here — the apply instructions require counts to come from cheap
// existing queries, and no cheap count-only query exists yet for
// contacts/tasks/discovery (getContactListPage, getOpenTasks etc. all
// return full rows, not a lightweight count). Adding one is out of scope
// for this batch; revisit once such a query exists.
export const NAVIGATION: SidebarSection[] = [
  {
    titleKey: "workspaceSection",
    items: [
      { labelKey: "leads", href: "/contacts", icon: ContactsIcon },
      { labelKey: "companies", href: "/companies", icon: CompaniesIcon },
      { labelKey: "tasks", href: "/tasks", icon: TasksIcon },
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
export function Sidebar({ labels }: { labels: NavLabels }) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);

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
            </Link>
          ))}
        </div>
      ))}

      <div className="sidenav-footer">
        <Link href="/account" className="nav-item">
          <AccountIcon className="icon" />
          {labels.account}
        </Link>
      </div>
    </nav>
  );
}
