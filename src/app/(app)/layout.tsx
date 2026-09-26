import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { pickNavLabels } from "@/lib/i18n/navLabels";
import { getCurrentBd } from "@/lib/queries";
import { ToastProvider } from "@/components/ToastProvider";
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
  const labels = pickNavLabels(t(locale));
  const me = await getCurrentBd();

  return (
    <ToastProvider>
      <div className="app">
        <Sidebar labels={labels} />
        <div className="main">
          <TopBar
            labels={labels}
            locale={locale}
            me={{ id: me.id, name: me.name, role: me.role === "admin" ? "admin" : "bd" }}
          />
          {children}
        </div>
      </div>
    </ToastProvider>
  );
}
