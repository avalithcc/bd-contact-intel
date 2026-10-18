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
export function RecordTabs({ tabs, initialTabId, notice }: { tabs: RecordTab[]; initialTabId?: string; notice?: React.ReactNode }) {
  // Every tab's content is already rendered by the server page, so a deep link only picks the starting tab: no
  // refetch, and clicks stay purely client-side. An id that is not one of the tabs falls back to the first.
  const [activeId, setActiveId] = useState(tabs.find((t) => t.id === initialTabId)?.id ?? tabs[0]?.id);

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
      {notice}
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
