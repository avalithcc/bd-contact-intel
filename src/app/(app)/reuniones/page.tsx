import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { getMeetingPage } from "@/lib/meetings/queries";
import { isMeetingView } from "@/lib/meetings/status";
import { meetingViewTabs, resolveMeetingScope } from "@/lib/meetings/view";
import { meetingTabLabels, pickMeetingLabels } from "@/lib/meetings/labels";
import { formatMeetingWhen } from "@/lib/meetings/when";
import { MeetingFilters } from "./MeetingFilters";
import { MeetingsList, type MeetingRowView } from "./MeetingsList";

// The rows depend on the signed-in BD (a BD sees only their own meetings) and on the clock (what is "Por confirmar").
export const dynamic = "force-dynamic";

interface ReunionesPageProps {
  searchParams: Promise<{ view?: string; bd?: string; from?: string; to?: string }>;
}

/**
 * "Reuniones" (meeting-outcomes mockup 3a-3c): every meeting by status, with "Por confirmar" first when there is any.
 * One read for the tab counts, the active tab's rows and (admins) the BD filter's options; see getMeetingPage. A BD sees
 * their own meetings; an admin sees everyone's, filtered by BD and dates, and can change only their own.
 */
export default async function ReunionesPage({ searchParams }: ReunionesPageProps) {
  const sp = await searchParams;
  const me = await getCurrentBd();
  const dict = await getDictionary();
  const l = pickMeetingLabels(dict);
  const now = new Date();

  const scope = resolveMeetingScope(me, sp, now);
  const page = await getMeetingPage(me.id, scope, isMeetingView(sp.view) ? sp.view : null, now);
  const tabs = meetingViewTabs(
    page.counts,
    page.view,
    meetingTabLabels(l),
    scope.isAdmin ? { bd: scope.bdId ?? undefined, from: scope.fromDate ?? undefined, to: scope.toDate ?? undefined } : {},
  );

  const pendingTab = page.view === "pending";
  const whenLabels = {
    today: l.whenToday,
    yesterday: l.whenYesterday,
    tomorrow: l.whenTomorrow,
    agoMinutes: l.whenAgoMinutes,
    agoHours: l.whenAgoHours,
  };
  const rows: MeetingRowView[] = page.rows.map((r) => {
    const when = formatMeetingWhen(r.scheduledAt, now, whenLabels, { weekday: page.view === "pending" || page.view === "scheduled" });
    return {
      id: r.id,
      personId: r.personId,
      contactName: [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || l.unknownContact,
      company: r.company,
      bdName: r.bdName,
      scheduledAtIso: r.scheduledAt.toISOString(),
      whenText: when.text,
      ago: pendingTab ? when.ago : null,
      status: r.status === "scheduled" && r.scheduledAt.getTime() <= now.getTime() ? "pending" : r.status,
      notes: r.notes,
      canMutate: r.canMutate,
    };
  });

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
        </div>
      </div>

      {scope.isAdmin && (
        <MeetingFilters labels={l} view={page.view} bds={page.bds} bd={scope.bdId ?? ""} from={scope.fromDate ?? ""} to={scope.toDate ?? ""} />
      )}

      <nav className="view-tabs" aria-label={l.tabsAria}>
        {tabs.map((tab) => (
          <Link key={tab.key} className={`view-tab${tab.active ? " active" : ""}`} href={tab.href} aria-current={tab.active ? "page" : undefined}>
            {tab.label}
            <span className="count">{tab.count}</span>
          </Link>
        ))}
      </nav>

      <MeetingsList
        rows={rows}
        labels={l}
        showBd={scope.isAdmin}
        actionsVisible={!pendingTab}
        emptyText={scope.isAdmin ? l.emptyTabAdmin : l.emptyTab}
      />
      {pendingTab && rows.length > 0 && <p className="meta mt-md">{l.rowsHint}</p>}
    </main>
  );
}
