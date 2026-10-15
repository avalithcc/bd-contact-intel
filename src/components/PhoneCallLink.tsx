"use client";

import { useState } from "react";
import { useCallAttempt } from "@/components/CallAttemptProvider";
import { Dialog } from "@/components/Dialog";

/** Shown before dialling a number Lusha flags as being on a do-not-call registry. Strings are already filled by the caller. */
export interface DoNotCallWarning {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
}

/**
 * The `tel:` link of PhoneValue. The click still opens the dialer, untouched;
 * it additionally records the attempt (CallAttemptProvider). Without a
 * provider or a contact it is a plain link.
 *
 * With `warn` (a number Lusha flagged doNotCall) the click is held on a confirmation first: neither the dialer nor the
 * call log is touched until the BD confirms. It is a confirmation, not a block: calling someone you have a relationship
 * with is legitimate, the point is that nobody dials a flagged number without knowing.
 */
export function PhoneCallLink({
  href,
  value,
  personId,
  personName,
  warn,
}: {
  href: string;
  value: string;
  personId?: string;
  personName?: string;
  warn?: DoNotCallWarning;
}) {
  const calls = useCallAttempt();
  const [asking, setAsking] = useState(false);
  const log = () => {
    if (calls && personId) calls.startCall({ personId, personName: personName ?? "", number: value });
  };
  return (
    <>
      <a
        className="num"
        href={href}
        onClick={(e) => {
          if (warn) {
            e.preventDefault();
            setAsking(true);
            return;
          }
          log();
        }}
      >
        {value}
      </a>
      {warn && (
        <Dialog
          open={asking}
          onClose={() => setAsking(false)}
          title={warn.title}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>
                {warn.cancel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setAsking(false);
                  log();
                  window.location.href = href;
                }}
              >
                {warn.confirm}
              </button>
            </>
          }
        >
          <p>{warn.body}</p>
        </Dialog>
      )}
    </>
  );
}
