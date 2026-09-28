"use client";

import Link from "next/link";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import type { GenerateMessageLabels } from "@/lib/outreach/messageLabels";
import type { Locale } from "@/lib/i18n/locales";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";
import { HistoryIcon, LinkedInIcon } from "@/components/icons";
import { PropertyList, type AboutPaneProperty, type OwnerOption } from "./PropertyList";
import { QuickActions } from "./QuickActions";

export type { AboutPaneProperty, OwnerOption };

export interface AboutPaneProps {
  personId: string;
  labels: ContactRecordLabels;
  name: string;
  jobTitle: string | null;
  company: string | null;
  companyKey: string | null;
  statusLabel: string;
  statusValue: string;
  // "Estado" derivation "why" hint (contact-record.html:77) — pre-composed
  // server-side (see describeStatusReason, src/lib/contacts/labels.ts).
  // `null` when there's no evidence yet (status "new").
  statusReasonText: string | null;
  emailVerified: boolean;
  linkedinHref: string | null;
  ownerLabel: string | null;
  ownerBdId: string | null;
  ownerLocked: boolean;
  ownerOptions: OwnerOption[];
  ownerHint: string | null;
  email: string | null;
  hunterHint: string | null;
  sourceText: string | null;
  createdText: string;
  properties: AboutPaneProperty[];
  // "Ubicación" composite row (contact-record.html:86) — see PropertyList.
  locationProperties: { city: AboutPaneProperty; region: AboutPaneProperty; country: AboutPaneProperty };
  messageLabels: GenerateMessageLabels;
  locale: Locale;
  // Board drag/keyboard-menu handoff (task 10.5, 14.1): opens the matching
  // quick-action composer on load, e.g. `?openAction=meeting`.
  initialAction?: "email" | "meeting" | "discard" | null;
}

/**
 * Left pane of the Contact record shell (task 9.2; mockup-port r02 markup
 * rework onto design-system.css's `.record-left`/`.record-identity`/`.qa`/
 * `.props` classes — contact-record.html:60-87). Quick actions
 * (`QuickActions`) and the editable-properties list (`PropertyList`) are
 * unchanged in behavior; this component only composes the identity header
 * and the derived "Estado" row around them.
 */
export function AboutPane({
  personId,
  labels: l,
  name,
  jobTitle,
  company,
  companyKey,
  statusLabel,
  statusValue,
  statusReasonText,
  emailVerified,
  linkedinHref,
  ownerLabel,
  ownerBdId,
  ownerLocked,
  ownerOptions,
  ownerHint,
  email,
  hunterHint,
  sourceText,
  createdText,
  properties,
  locationProperties,
  messageLabels,
  locale,
  initialAction,
}: AboutPaneProps) {
  return (
    <aside className="record-left" aria-label={l.aboutSectionTitle}>
      <div className="record-identity">
        <Avatar id={personId} initials={initialsFromName(name)} size="lg" />
        <div>
          <h1>{name}</h1>
          {jobTitle && (
            <p className="headline">
              {jobTitle}
              {company && (
                <>
                  {" "}
                  {l.headlineConnector}{" "}
                  {companyKey ? <Link href={`/companies/${companyKey}`}>{company}</Link> : company}
                </>
              )}
            </p>
          )}
        </div>
        <div className="row wrap">
          <span className={statusBadgeClass(statusValue)}>{statusLabel}</span>
          {emailVerified && <span className="badge badge-verified">{l.verifiedBadge}</span>}
          {linkedinHref && (
            <a className="badge badge-outline no-dot" href={linkedinHref} target="_blank" rel="noreferrer">
              <LinkedInIcon className="icon" />
              {l.linkedInBadge}
            </a>
          )}
        </div>
      </div>

      <QuickActions
        personId={personId}
        name={name}
        labels={l}
        email={email}
        messageLabels={messageLabels}
        locale={locale}
        initialAction={initialAction}
      />

      <div className="section-title">
        {l.aboutSectionTitle}
        <span className="actions">
          {/* Mockup itself links this to `href="#"` (contact-record.html:74)
              — property-change history has no destination yet in the
              approved design either; kept as the same inert placeholder
              rather than inventing a page that isn't specified. */}
          <a className="btn btn-ghost btn-sm" href="#">
            <HistoryIcon className="icon" />
            {l.historyAction}
          </a>
        </span>
      </div>

      <PropertyList
        personId={personId}
        labels={l}
        statusLabel={statusLabel}
        statusValue={statusValue}
        statusReasonText={statusReasonText}
        ownerLabel={ownerLabel}
        ownerBdId={ownerBdId}
        ownerLocked={ownerLocked}
        ownerOptions={ownerOptions}
        ownerHint={ownerHint}
        emailVerified={emailVerified}
        hunterHint={hunterHint}
        sourceText={sourceText}
        createdText={createdText}
        properties={properties}
        locationProperties={locationProperties}
      />
    </aside>
  );
}
