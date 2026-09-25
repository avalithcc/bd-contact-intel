"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

export interface SidebarItem {
  label: string;
  href: string;
}

export interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

// App shell nav (design.md D9, Phase 8). Labels/routes are unchanged from
// the pre-Phase-8 sidebar — only the visual language (mockups/styles.css)
// changes here. Phases 9-14 reshape the information architecture itself
// (e.g. a "Contacts" item pointing at /contacts) as each page migrates.
export const NAVIGATION: SidebarSection[] = [
  {
    title: "CENTRAL",
    items: [
      { label: "Leads", href: "/leads" },
      { label: "Companies", href: "/companies" },
      { label: "Tasks", href: "/tasks" },
      { label: "Outreach", href: "/outreach" },
    ],
  },
  {
    title: "AREAS",
    items: [
      { label: "Hiring", href: "/hiring" },
      { label: "What's New", href: "/whats-new" },
      { label: "Discovery", href: "/discovery" },
    ],
  },
];

/**
 * App shell sidebar (design.md D9, Phase 8). Lives under `src/app/contacts/`
 * rather than `src/components/` per D9 — it's extracted only once Company
 * (or another surface) adopts it too.
 */
export function Sidebar() {
  const [isOpen, setIsOpen] = useState(true);
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <>
      <button
        className={styles.toggleButton}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle sidebar"
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
          <div key={section.title} className={styles.navSection}>
            <h3 className={styles.navTitle}>{section.title}</h3>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${isActive(item.href) ? styles.active : ""}`}
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        <div className={styles.sidenavFooter}>
          <Link href="/account" className={styles.navItem}>
            Account
          </Link>
        </div>
      </nav>
    </>
  );
}
