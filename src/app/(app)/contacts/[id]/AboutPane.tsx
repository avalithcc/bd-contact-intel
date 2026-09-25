"use client";

import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { PropertyList, type AboutPaneProperty } from "./PropertyList";
import styles from "./AboutPane.module.css";

export type { AboutPaneProperty };

export interface AboutPaneProps {
  personId: string;
  labels: ContactRecordLabels;
  name: string;
  headline: string | null;
  statusLabel: string;
  ownerLabel: string | null;
  properties: AboutPaneProperty[];
}

/**
 * Left pane of the Contact record shell (task 9.2): identity header and the
 * editable-properties list (task 9.4, see `PropertyList`). Quick actions
 * (Nota/Correo/Tarea, task 9.2) land in PR 09b3 as `QuickActions`.
 */
export function AboutPane({
  personId,
  labels: l,
  name,
  headline,
  statusLabel,
  ownerLabel,
  properties,
}: AboutPaneProps) {
  return (
    <aside className={styles.pane} aria-label={l.aboutSectionTitle}>
      <div className={styles.identity}>
        <h1 className={styles.name}>{name}</h1>
        {headline && <p className={styles.headline}>{headline}</p>}
        <span className={styles.statusBadge}>{statusLabel}</span>
      </div>

      <div className={styles.sectionTitle}>{l.aboutSectionTitle}</div>
      <PropertyList personId={personId} labels={l} ownerLabel={ownerLabel} properties={properties} />
    </aside>
  );
}
