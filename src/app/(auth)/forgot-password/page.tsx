import { getLocale } from "@/lib/i18n/server";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default async function ForgotPasswordPage() {
  const locale = await getLocale();
  return <ForgotPasswordForm locale={locale} />;
}
