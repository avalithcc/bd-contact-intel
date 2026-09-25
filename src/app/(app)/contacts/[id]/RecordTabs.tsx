"use client";

import { useState } from "react";
import styles from "./page.module.css";

export interface RecordTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

/** Mockup's clickable Actividad/Resumen tabs (contact-record.html) — content per tab is filled in by the page. */
export function RecordTabs({ tabs }: { tabs: RecordTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);

  return (
    <div>
      <div className={styles.tabs} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={tab.id === activeId ? styles.tabActive : styles.tab}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (tab.id === activeId ? <div key={tab.id}>{tab.content}</div> : null))}
    </div>
  );
}
