import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";

/**
 * The admin check runs here, before the route's loading.tsx streams anything: with it only in page.tsx a BD would get a 200
 * response that shows the "Estado de Gmail" skeleton first and the not-found page after. Here the 404 status is set before the
 * first byte and the skeleton never reaches a BD. page.tsx keeps its own check; getCurrentBd is cached per request.
 */
export default async function GmailFleetLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }
  return children;
}
