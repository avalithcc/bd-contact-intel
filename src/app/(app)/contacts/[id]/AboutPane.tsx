"use client";

import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { PropertyList, type AboutPaneProperty } from "./PropertyList";
import { QuickActions } from "./QuickActions";
import styles from "./AboutPane.module.css";

export type { AboutPaneProperty };

export interface AboutPaneProps {
  personId: string;
  labels: ContactRecordLabels;
  name: string;
  headline: string | null;
  statusLabel: string;
  ownerLabel: string | null;
  email: string | null;
  properties: AboutPaneProperty[];
}

/**
 * Left pane of the Contact record shell (task 9.2): identity header, quick
 * actions (`QuickActions` — Nota/Correo/Tarea wired; Reunión/Descartar
 * render-only placeholders for Phase 10), and the editable-properties list
 * (task 9.4, see `PropertyList`).
 */
export function AboutPane({
  personId,
  labels: l,
  name,
  headline,
  statusLabel,
  ownerLabel,
  email,
  properties,
}: AboutPaneProps) {
  return (
    <aside className={styles.pane} aria-label={l.aboutSectionTitle}>
      <div className={styles.identity}>
        <h1 className={styles.name}>{name}</h1>
        {headline && <p className={styles.headline}>{headline}</p>}
        <span className={styles.statusBadge}>{statusLabel}</span>
      </div>

      <QuickActions personId={personId} labels={l} email={email} />

      <div className={styles.sectionTitle}>{l.aboutSectionTitle}</div>
      <PropertyList personId={personId} labels={l} ownerLabel={ownerLabel} properties={properties} />
    </aside>
  );
}
