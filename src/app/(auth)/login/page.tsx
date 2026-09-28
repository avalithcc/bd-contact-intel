import { getLocale } from "@/lib/i18n/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const locale = await getLocale();
  return <LoginForm locale={locale} next={next} error={error} />;
}
