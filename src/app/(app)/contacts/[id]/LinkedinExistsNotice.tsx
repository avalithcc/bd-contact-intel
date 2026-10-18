"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { CloseIcon, InfoIcon } from "@/components/icons";
import { withoutQueryParams, type NoticeOwner } from "@/lib/contacts/linkedinCapture";

export interface LinkedinExistsNoticeLabels {
  title: string;
  body: string;
  ownerOther: string;
  ownerMine: string;
  noOwner: string;
  close: string;
}

/**
 * "Ya está en el CRM" (linkedin-exists-check mockup, section 2): shown on the
 * record when the bookmarklet found the person (`?from=linkedin`). Dismissible,
 * no stored state: dismissing removes ?from=linkedin from the URL, so a refresh does not bring it back.
 */
export function LinkedinExistsNotice({
  labels,
  variant,
  owner,
}: {
  labels: LinkedinExistsNoticeLabels;
  variant: NoticeOwner;
  owner: { id: string; name: string } | null;
}) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (!open) return null;

  return (
    <div className="alert alert-info" role="status" id="ya-existe">
      <InfoIcon className="icon" />
      <div className="grow">
        <div className="title">{labels.title}</div>
        {labels.body}{" "}
        {variant === "none" || !owner ? (
          labels.noOwner
        ) : variant === "mine" ? (
          labels.ownerMine
        ) : (
          <>
            {labels.ownerOther}{" "}
            <span className="owner-chip">
              <Avatar id={owner.id} initials={initialsFromName(owner.name)} variant="bd" size="sm" />
              {owner.name}
            </span>
          </>
        )}
      </div>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={labels.close} onClick={() => {
          setOpen(false);
          // Drop ?from=linkedin so a refresh does not bring the notice back.
          router.replace(withoutQueryParams(pathname, searchParams.toString(), ["from"]));
        }}>
        <CloseIcon className="icon" />
      </button>
    </div>
  );
}
