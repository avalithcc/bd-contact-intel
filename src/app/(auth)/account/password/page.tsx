import { getLocale } from "@/lib/i18n/server";
import { PasswordForm } from "./PasswordForm";

export default async function SetPasswordPage() {
  const locale = await getLocale();
  return <PasswordForm locale={locale} />;
}
