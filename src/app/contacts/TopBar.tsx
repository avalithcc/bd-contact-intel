"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./TopBar.module.css";
import { NAVIGATION } from "./Sidebar";
import type { NavLabels } from "@/lib/i18n/navLabels";

function breadcrumbFor(pathname: string, labels: NavLabels): string {
  const item = NAVIGATION.flatMap((section) => section.items).find((i) =>
    pathname.startsWith(i.href),
  );
  // "/" is the legacy pre-Phase-12 contacts home, kept as a separate,
  // still-bdId-scoped page (task 11.7 SUGGESTION) — /contacts (task 12.2)
  // is the new unified list this breadcrumb/search now points at.
  return item ? labels[item.labelKey] : labels.contactsFallback;
}

/**
 * App shell top bar (design.md D9, Phase 8). Search is contacts-only (owner
 * decision, tasks.md 8.2): it submits to `/contacts` (task 12.2 — this
 * route didn't exist yet when the shell shipped, so it targeted `/`),
 * using the same `q` param that page reads (getContactListPage's search
 * condition, listQueries.ts). Deliberately does not include the mockup's
 * "Crear"/account dropdowns — those duplicate per-page controls (e.g.
 * UserMenu) that later phases migrate onto this shell one page at a time,
 * not a Phase 8 shell-only concern.
 */
export function TopBar({ labels }: { labels: NavLabels }) {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(q ? `/contacts?q=${encodeURIComponent(q)}` : "/contacts");
  }

  return (
    <header className={styles.topbar}>
      <nav className={styles.breadcrumbs} aria-label="Ruta de navegación">
        <span>{breadcrumbFor(pathname, labels)}</span>
      </nav>
      <form className={styles.search} onSubmit={onSubmit} role="search">
        <span className="sr-only">Buscar contactos</span>
        <input
          type="search"
          placeholder="Buscar contactos por nombre, empresa o correo electrónico"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
    </header>
  );
}
