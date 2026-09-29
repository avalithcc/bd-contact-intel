import { notFound } from "next/navigation";
import { PASSWORD_RESET_ENABLED } from "@/lib/auth/passwordReset";
import { getLocale } from "@/lib/i18n/server";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default async function ForgotPasswordPage() {
  // Off until the project has custom SMTP — see passwordReset.ts. A reachable
  // form here would fail silently: generic confirmation, no email delivered.
  if (!PASSWORD_RESET_ENABLED) notFound();
  const locale = await getLocale();
  return <ForgotPasswordForm locale={locale} />;
}
