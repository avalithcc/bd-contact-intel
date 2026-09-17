import { getLocale } from "@/lib/i18n/server";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const locale = await getLocale();
  return <LoginForm locale={locale} localeSwitcher={<LocaleSwitcher locale={locale} />} />;
}
