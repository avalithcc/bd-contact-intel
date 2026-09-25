import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getContactRecord } from "@/lib/contacts/queries";
import { getDictionary } from "@/lib/i18n/server";
import { RecordTabs } from "./RecordTabs";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface ContactRecordPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Three-pane record shell (task 9.2; mockups/contact-record.html). This PR
 * (09b1) ships the read-only shell: identity, properties list, company and
 * connected-BD associations. Inline property editing and the Nota/Correo/
 * Tarea quick actions (task 9.4, still part of Phase 9) land in the
 * follow-up PR 09b2, which swaps the read-only `<dl>` below for the
 * interactive `AboutPane` client component.
 */
export default async function ContactRecordPage({ params }: ContactRecordPageProps) {
  const { id } = await params;
  const result = await getContactRecord(id);

  if (result.kind === "not_found") notFound();
  if (result.kind === "redirect") redirect(`/contacts/${result.personId}`);

  const { record } = result;
  const dict = await getDictionary();
  const l = dict.contactRecord;

  const name = [record.person.firstName, record.person.lastName].filter(Boolean).join(" ") || dict.contact.unnamed;
  const statusLabel = dict.leadStatuses[record.person.status as keyof typeof dict.leadStatuses] ?? record.person.status;

  return (
    <main>
      <div className={styles.record}>
        <aside aria-label={l.aboutSectionTitle}>
          <h1>{name}</h1>
          {record.person.jobTitle && <p>{record.person.jobTitle}</p>}
          <span className={styles.tabActive}>{statusLabel}</span>

          <div className={styles.cardTitle}>{l.aboutSectionTitle}</div>
          <dl>
            <div>
              <dt>{l.propOwner}</dt>
              <dd>{record.ownerName ?? l.emptyValue}</dd>
            </div>
            {record.properties.map((p) => (
              <div key={p.key}>
                <dt>{l[`prop${p.key.charAt(0).toUpperCase()}${p.key.slice(1)}` as keyof typeof l] as string}</dt>
                <dd>{p.value ?? l.emptyValue}</dd>
                {p.lastEdit && (
                  <dd className={styles.placeholder}>
                    {l.lastUpdatedByPrefix} {p.lastEdit.bdName ?? "—"} · {format(p.lastEdit.at, "d MMM", { locale: es })}
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </aside>

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
