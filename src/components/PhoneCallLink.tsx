"use client";

import { useCallAttempt } from "@/components/CallAttemptProvider";

/**
 * The `tel:` link of PhoneValue. The click still opens the dialer, untouched;
 * it additionally records the attempt (CallAttemptProvider). Without a
 * provider or a contact it is a plain link.
 */
export function PhoneCallLink({
  href,
  value,
  personId,
  personName,
}: {
  href: string;
  value: string;
  personId?: string;
  personName?: string;
}) {
  const calls = useCallAttempt();
  return (
    <a
      className="num"
      href={href}
      onClick={() => {
        if (calls && personId) calls.startCall({ personId, personName: personName ?? "", number: value });
      }}
    >
      {value}
    </a>
  );
}
