import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getContactRecord } from "@/lib/contacts/queries";
import { getPersonTimeline, isTimelineActivityType } from "@/lib/activity/queries";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { pickContactRecordLabels } from "@/lib/contacts/labels";
import { AboutPane, type AboutPaneProperty } from "./AboutPane";
import { RecordTabs } from "./RecordTabs";
import { Timeline } from "./Timeline";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface ContactRecordPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ activityType?: string }>;
}

/**
 * Three-pane record shell (task 9.2; mockups/contact-record.html). The
 * read-only shell shipped in PR 09b1; PR 09b2 wired inline property edit
 * (task 9.4); PR 09b3 added the Nota/Correo/Tarea quick actions; PR 10a
 * (task 10.1) replaces the "Actividad" placeholder with the filtered
 * timeline pane.
 */
export default async function ContactRecordPage({ params, searchParams }: ContactRecordPageProps) {
  const { id } = await params;
  const { activityType: rawActivityType } = await searchParams;
  const result = await getContactRecord(id);

  if (result.kind === "not_found") notFound();
  if (result.kind === "redirect") redirect(`/contacts/${result.personId}`);

  const { record } = result;
  const dict = await getDictionary();
  const l = pickContactRecordLabels(dict);
  const activityType = rawActivityType && isTimelineActivityType(rawActivityType) ? rawActivityType : undefined;
  const me = await getCurrentBd();
  const timeline = await getPersonTimeline(record.person.id, me.id, { type: activityType });

  const name = [record.person.firstName, record.person.lastName].filter(Boolean).join(" ") || dict.contact.unnamed;
  const statusLabel = dict.leadStatuses[record.person.status as keyof typeof dict.leadStatuses] ?? record.person.status;

  const properties: AboutPaneProperty[] = record.properties.map((p) => ({
    key: p.key,
    label: l[`prop${p.key.charAt(0).toUpperCase()}${p.key.slice(1)}` as keyof typeof l] as string,
    value: p.value,
    lastUpdatedLabel: p.lastEdit
      ? `${l.lastUpdatedByPrefix} ${p.lastEdit.bdName ?? "—"} · ${format(p.lastEdit.at, "d MMM", { locale: es })}`
      : null,
  }));

  return (
    <main>
      <div className={styles.record}>
        <AboutPane
          personId={record.person.id}
          labels={l}
          name={name}
          headline={record.person.jobTitle}
          statusLabel={statusLabel}
          ownerLabel={record.ownerName}
          email={record.person.email}
          properties={properties}
        />

        <div className={styles.main}>
          <RecordTabs
            tabs={[
              {
                id: "activity",
                label: l.tabActivity,
                content: (
                  <Timeline
                    personId={record.person.id}
                    labels={l}
                    entries={timeline.entries}
                    countsByType={timeline.countsByType}
                    activeType={activityType}
                  />
                ),
              },
              {
                id: "overview",
                label: l.tabOverview,
                content: <div className={styles.placeholder}>{l.overviewComingSoon}</div>,
              },
            ]}
          />
        </div>

        <aside className={styles.right}>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{l.companyCardTitle}</h3>
            <div>{record.person.company ?? l.noCompany}</div>
          </div>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{l.connectedBdsTitle}</h3>
            {record.connections.length ? (
              record.connections.map((c) => (
                <div key={c.bdId} className={styles.assocRow}>
                  <span>{c.bdName ?? "—"}</span>
                  <span>{c.connectedOn ? `${l.connectedOnPrefix} ${c.connectedOn}` : l.emptyValue}</span>
                </div>
              ))
            ) : (
              <div className={styles.placeholder}>{l.associationsComingSoon}</div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
