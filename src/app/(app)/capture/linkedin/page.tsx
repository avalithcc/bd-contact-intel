import Link from "next/link";
import { redirect } from "next/navigation";
import { WarningIcon } from "@/components/icons";
import { captureRedirectPath, parseCaptureUrl, type CaptureRejection } from "@/lib/contacts/linkedinCapture";
import { findLivePersonIdByProfileKey } from "@/lib/contacts/linkedinLookup";
import { getDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

interface CaptureLinkedinPageProps {
  searchParams: Promise<{ url?: string | string[] }>;
}

/**
 * Landing of the old "Guardar desde LinkedIn" bookmarklet (linkedin-exists-check
 * mockup). The bookmarklet UI was replaced by the browser extension, but bookmarks
 * and favorites people already saved keep pointing here, so the route stays. Receives only a URL: a personal profile is normalized to its
 * `profile_key`, looked up (merged keys included) and redirected to the record
 * or to "Nuevo contacto"; anything else renders the "enlace no válido" screen.
 * Never fetches LinkedIn. Behind the same session gate as every `(app)` route;
 * the middleware keeps this path and query through the login `?next=` round trip.
 */
export default async function CaptureLinkedinPage({ searchParams }: CaptureLinkedinPageProps) {
  const { url } = await searchParams;
  const parsed = parseCaptureUrl(Array.isArray(url) ? url[0] : url);

  if (parsed.ok) {
    const livePersonId = await findLivePersonIdByProfileKey(parsed.profileKey);
    redirect(captureRedirectPath(parsed, livePersonId));
  }

  const dict = await getDictionary();
  const l = dict.linkedinCapture;
  const reasonText: Record<CaptureRejection, string> = {
    company: l.reasonCompany,
    general: l.reasonGeneral,
    not_linkedin: l.reasonNotLinkedin,
    missing: l.reasonMissing,
  };

  return (
    <main className="page page-narrow">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
        </div>
      </div>
      <div className="card">
        <div className="card-body">
          <div className="empty" role="alert">
            <div className="empty-icon">
              <WarningIcon className="icon" />
            </div>
            <h3>{l.heading}</h3>
            <p>
              {reasonText[parsed.reason]}
              {parsed.received && (
                <>
                  {" "}
                  {l.receivedPrefix} <span className="mono">{parsed.received}</span>.
                </>
              )}
              {parsed.reason !== "general" && (
                <>
                  {" "}
                  {l.openProfileBefore}
                  <span className="mono">{l.openProfileExample}</span>
                  {l.openProfileAfter}
                </>
              )}
            </p>
            <div className="row" style={{ justifyContent: "center" }}>
              <Link href="/contacts" className="btn btn-primary">
                {l.goToContacts}
              </Link>
              <Link href="/contacts?new=1" className="btn btn-secondary">
                {l.createWithoutLink}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
