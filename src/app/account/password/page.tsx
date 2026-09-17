import { getLocale } from "@/lib/i18n/server";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";
import { PasswordForm } from "./PasswordForm";

export default async function SetPasswordPage() {
  const locale = await getLocale();
  return <PasswordForm locale={locale} localeSwitcher={<LocaleSwitcher locale={locale} />} />;
}
