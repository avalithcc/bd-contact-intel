import type { ReactNode } from "react";
import { CheckIcon } from "@/components/icons";
import { t } from "@/lib/i18n/dictionaries";
import type { UnsubscribeView } from "@/lib/sequences/unsubscribeHandlers";

// Public, recipient-facing pages for the unsubscribe flow, from mockups/baja-opciones.html (Option B, screens 2 and 3).
// Rendered in English like the emails. Nothing routes to them until the go-live PR; the page there supplies
// `postalAddress` from the recipient's market so no address is hard-coded here.

const copy = t("en").sequenceUnsubscribe;

function Shell({ postalAddress, children }: { postalAddress?: string; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo">
            avalith<span className="dot">.</span>
          </span>
        </div>
        <div className="card">
          <div className="card-body">
            {children}
            {postalAddress ? <p className="help center mt-lg">{postalAddress}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Screen 2. The button POSTs; the GET that rendered this page wrote nothing. */
export function UnsubscribeConfirm({
  email,
  token,
  postalAddress,
}: {
  email: string;
  token: string;
  postalAddress?: string;
}) {
  return (
    <Shell postalAddress={postalAddress}>
      <h3 className="center">{copy.confirmTitle}</h3>
      <p className="meta center mt-lg">{copy.confirmBody(email)}</p>
      <form className="form-actions mt-xl" method="post" action="/api/unsubscribe">
        <input type="hidden" name="t" value={token} />
        <button className="btn btn-primary btn-block" type="submit">
          {copy.confirmButton}
        </button>
      </form>
    </Shell>
  );
}

/** Screen 3. */
export function UnsubscribeDone({ email, postalAddress }: { email: string; postalAddress?: string }) {
  return (
    <Shell postalAddress={postalAddress}>
      <div className="empty">
        <div className="empty-icon">
          <CheckIcon className="icon-lg" />
        </div>
        <h3>{copy.doneTitle}</h3>
        <p>{copy.doneBody(email)}</p>
      </div>
    </Shell>
  );
}

/** Generic: names no address and does not say whether the token was unknown or malformed. */
export function UnsubscribeInvalid() {
  return (
    <Shell>
      <div className="empty">
        <h3>{copy.invalidTitle}</h3>
        <p>{copy.invalidBody}</p>
      </div>
    </Shell>
  );
}

export function UnsubscribePage({ view, postalAddress }: { view: UnsubscribeView; postalAddress?: string }) {
  if (view.kind === "confirm") return <UnsubscribeConfirm email={view.email} token={view.token} postalAddress={postalAddress} />;
  if (view.kind === "done") return <UnsubscribeDone email={view.email} postalAddress={postalAddress} />;
  return <UnsubscribeInvalid />;
}
