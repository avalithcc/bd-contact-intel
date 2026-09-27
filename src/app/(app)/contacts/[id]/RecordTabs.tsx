"use client";

import { useState } from "react";

export interface RecordTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

/**
 * Mockup's clickable Actividad/Resumen tabs (contact-record.html:89-91;
 * mockup-port r03 markup rework onto design-system.css's `.tabs`/`.tab`
 * classes) — content per tab is filled in by the page. Fresh-review
 * SUGGESTION fix (kept): wires the tab/tabpanel pair together (id/
 * aria-controls/aria-labelledby) instead of only marking the tab buttons.
 */
export function RecordTabs({ tabs }: { tabs: RecordTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Secciones de la ficha">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={tab.id === activeId}
            aria-controls={`tabpanel-${tab.id}`}
            className="tab"
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) =>
        tab.id === activeId ? (
          <div key={tab.id} id={`tabpanel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`}>
            {tab.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
