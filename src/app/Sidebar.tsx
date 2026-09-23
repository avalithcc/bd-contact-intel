"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

export interface SidebarItem {
  label: string;
  href: string;
  icon?: string;
}

export interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

const NAVIGATION: SidebarSection[] = [
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

      <nav className={`${styles.sidebar} ${isOpen ? styles.open : styles.closed}`}>
        <div className={styles.header}>
          <Link href="/" className={styles.logo}>
            avalith<span className={styles.dot}>.</span>
          </Link>
        </div>

        <div className={styles.sections}>
          {NAVIGATION.map((section) => (
            <div key={section.title} className={styles.section}>
              <h3 className={styles.sectionTitle}>{section.title}</h3>
              <ul className={styles.items}>
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`${styles.item} ${
                        isActive(item.href) ? styles.active : ""
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <Link href="/account" className={styles.footerLink}>
            Account
          </Link>
        </div>
      </nav>
    </>
  );
}
