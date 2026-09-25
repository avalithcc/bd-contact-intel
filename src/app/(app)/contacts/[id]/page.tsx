import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getContactRecord } from "@/lib/contacts/queries";
import { getDictionary } from "@/lib/i18n/server";
import { pickContactRecordLabels } from "@/lib/contacts/labels";
import { AboutPane, type AboutPaneProperty } from "./AboutPane";
import { RecordTabs } from "./RecordTabs";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface ContactRecordPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Three-pane record shell (task 9.2; mockups/contact-record.html). The
 * read-only shell shipped in PR 09b1; PR 09b2 wired inline property edit
 * (task 9.4); this PR (09b3) adds the Nota/Correo/Tarea quick actions.
 */
export default async function ContactRecordPage({ params }: ContactRecordPageProps) {
  const { id } = await params;
  const result = await getContactRecord(id);

  if (result.kind === "not_found") notFound();
  if (result.kind === "redirect") redirect(`/contacts/${result.personId}`);

  const { record } = result;
  const dict = await getDictionary();
  const l = pickContactRecordLabels(dict);

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
                content: <div className={styles.placeholder}>{l.timelineComingSoon}</div>,
              },
              {
                id: "overview",
                label: l.tabOverview,
                content: <div className={styles.placeholder}>{l.timelineComingSoon}</div>,
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
