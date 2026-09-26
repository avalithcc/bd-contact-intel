import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { pickNavLabels } from "@/lib/i18n/navLabels";
import { ToastProvider } from "@/components/ToastProvider";
import { Sidebar } from "../contacts/Sidebar";
import { TopBar } from "../contacts/TopBar";

/**
 * Shell for every authenticated app page (fresh-review fix on tasks.md 8.2:
 * the shell must not wrap auth-flow pages like /login or
 * /account/password — see src/app/(auth)/layout.tsx).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const labels = pickNavLabels(t(locale));

  return (
    <ToastProvider>
      <Sidebar labels={labels} />
      <div className="main-layout">
        <TopBar labels={labels} />
        {children}
      </div>
    </ToastProvider>
  );
}
