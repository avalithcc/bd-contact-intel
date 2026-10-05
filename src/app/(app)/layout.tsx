import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { pickNavLabels } from "@/lib/i18n/navLabels";
import { pickTopBarSearchLabels } from "@/lib/i18n/topBarSearchLabels";
import { getCurrentBd } from "@/lib/queries";
import { getAppShellBadgeCounts } from "@/lib/shell/appShellBadgeCounts";
import { ToastProvider } from "@/components/ToastProvider";
import { CallAttemptProvider } from "@/components/CallAttemptProvider";
import { ReconnectBanner } from "@/components/ReconnectBanner";
import { SyncHealthBanner } from "@/components/SyncHealthBanner";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { Sidebar } from "../contacts/Sidebar";
import { TopBar } from "../contacts/TopBar";

/**
 * Shell for every authenticated app page (fresh-review fix on tasks.md 8.2:
 * the shell must not wrap auth-flow pages like /login or
 * /account/password — see src/app/(auth)/layout.tsx).
 *
 * `getCurrentBd()` (mockup-parity 3.2, TopBar account menu) is the same
 * cheap `findFirst` by unique email index already called by most pages
 * under this layout (contacts/tasks/hiring/discovery/whats-new) — not a
 * new heavy query, just one more call site for it.
 *
 * `getAppShellBadgeCounts(me.id, ...)` (task-reminders backlog; follow-up-
 * queue) is the sidebar's "Tareas"/"Seguimientos" counts — ONE round trip,
 * two independent scalar subqueries in a single statement (fresh-review
 * fix: this used to be two separate sequential calls,
 * `getTaskBadgeCount`/`getFollowUpQueueBadgeCount`, doubling the shell's own
 * query budget on every page view — see appShellBadgeCountsQuery.ts's doc
 * comment). `me.id` above is free since `getCurrentBd()` is already paid
 * for by every page under this layout.
 *
 * mockup-port 02: the `.app`/`.main` wrapper below is contacts.html's own
 * shell grid (design-system.css) — `.app { grid-template-columns:
 * sidebar-width minmax(0,1fr) }`, `.main { display: flex; flex-direction:
 * column }` — replacing the previous `.main-layout` margin-left hack that
 * paired with Sidebar's fixed-position drawer.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const dict = t(locale);
  const labels = pickNavLabels(dict);
  const searchLabels = pickTopBarSearchLabels(dict);
  const me = await getCurrentBd();
  const now = new Date();
  const { taskCount, followUpCount, needsReconnectBanner, syncBanner } = await getAppShellBadgeCounts(me.id, now);

  return (
    <ToastProvider>
      <CallAttemptProvider labels={dict.callAttempt}>
        <div className="app">
          <Sidebar
            labels={labels}
            taskCount={taskCount}
            followUpCount={followUpCount}
            isAdmin={me.role === "admin"}
          />
          <div className="main">
            <TopBar
              labels={labels}
              searchLabels={searchLabels}
              locale={locale}
              me={{ id: me.id, name: me.name, role: me.role === "admin" ? "admin" : "bd" }}
            />
            {needsReconnectBanner && <ReconnectBanner labels={dict.reconnectBanner} />}
            {/* Without server OAuth config /account/email renders no card, so the link would land on nothing. */}
            {syncBanner && getGmailOAuthConfig().ok && <SyncHealthBanner kind={syncBanner} labels={dict.syncHealthBanner} />}
            {children}
          </div>
        </div>
      </CallAttemptProvider>
    </ToastProvider>
  );
}
