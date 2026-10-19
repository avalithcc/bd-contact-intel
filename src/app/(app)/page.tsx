import { redirect } from "next/navigation";

/**
 * "/" is where the logo, the error pages and the default post-login redirect land. The old contacts list that
 * lived here was replaced by /contacts, so the root only forwards: a legacy `?companyKey=` link opens that
 * company's record (which lists its contacts), anything else opens the contacts list.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ companyKey?: string | string[] }> }) {
  const { companyKey } = await searchParams;
  const key = Array.isArray(companyKey) ? companyKey[0] : companyKey;
  redirect(key ? `/companies/${encodeURIComponent(key)}` : "/contacts");
}
