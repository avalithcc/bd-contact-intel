"use client";

import { useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";
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

// App shell nav (design.md D9, Phase 8). Routes are unchanged from the
// pre-Phase-8 sidebar — only the visual language (mockups/styles.css) and,
// per the Phase 8 fresh-review fix, the labels (now sourced from the `es`
// dictionary instead of hardcoded English) change here. Phases 9-14 reshape
// the information architecture itself (e.g. a "Contacts" item pointing at
// /contacts) as each page migrates. Icons added in mockup-parity 3.3 (see
// src/components/icons.tsx for provenance/deviation notes, incl. why
// "outreach" gets an icon at all even though it's gone from the mockup).
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
      { labelKey: "outreach", href: "/outreach", icon: OutreachIcon },
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
 */
export function Sidebar({ labels }: { labels: NavLabels }) {
  const [isOpen, setIsOpen] = useState(true);
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <>
      <button
        className={styles.toggleButton}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={labels.toggleSidebar}
      >
        ☰
      </button>

      <nav
        className={`${styles.sidenav} ${isOpen ? styles.open : styles.closed}`}
        aria-label="Principal"
      >
        <Link href="/" className={styles.logo}>
          avalith<span className={styles.dot}>.</span>
        </Link>

        {NAVIGATION.map((section) => (
          <div key={section.titleKey} className={styles.navSection}>
            <h3 className={styles.navTitle}>{labels[section.titleKey]}</h3>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${isActive(item.href) ? styles.active : ""}`}
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                <item.icon className={styles.icon} />
                {labels[item.labelKey]}
              </Link>
            ))}
          </div>
        ))}

        <div className={styles.sidenavFooter}>
          <Link href="/account" className={styles.navItem}>
            <AccountIcon className={styles.icon} />
            {labels.account}
          </Link>
        </div>
      </nav>
    </>
  );
}
