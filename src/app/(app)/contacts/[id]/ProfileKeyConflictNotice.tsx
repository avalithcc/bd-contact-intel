import React from "react";
import { WarningIcon } from "@/components/icons";
import type { ProfileKeyOwner } from "@/lib/contacts/errors";
import type { ContactRecordLabels } from "@/lib/contacts/labels";

/**
 * Body of the alert shown when a LinkedIn save collides with another contact
 * (the caller wraps it in `alert alert-warn mt-md`). Same structure as the
 * approved mockup: warning icon, then ONE inner div holding the sentence, so
 * the flex alert does not split the text into separate items.
 *
 * Names and links the owner so any BD can check it. Only an admin gets the
 * Duplicados link (that screen is admin-only); everyone else is told to ask
 * an admin. The "nothing is merged automatically" clause is in both variants.
 * When the holder was already merged into another contact, the link goes to
 * the SURVIVOR and no merge is suggested: merging cannot free that key.
 */
export function ProfileKeyConflictNotice({
  labels: l,
  owner,
  isAdmin,
}: {
  labels: Pick<
    ContactRecordLabels,
    | "errorProfileKeyTakenPrefix"
    | "errorProfileKeyTakenNoRepeat"
    | "errorProfileKeyMergedPrefix"
    | "errorProfileKeyTakenRest"
    | "errorProfileKeyTakenAskAdmin"
    | "errorProfileKeyTakenDuplicates"
    | "errorProfileKeyTakenNoAuto"
  >;
  owner: ProfileKeyOwner;
  isAdmin: boolean;
}) {
  if (owner.mergedInto) {
    const survivor = owner.mergedInto;
    return (
      <>
        <WarningIcon className="icon" />
        <div>
          {l.errorProfileKeyMergedPrefix} <a href={`/contacts/${survivor.id}`}><strong>{survivor.name}</strong></a>.{" "}
          {l.errorProfileKeyTakenNoRepeat}
        </div>
      </>
    );
  }
  return (
    <>
      <WarningIcon className="icon" />
      <div>
        {l.errorProfileKeyTakenPrefix} <a href={`/contacts/${owner.id}`}><strong>{owner.name}</strong></a>.{" "}
        {l.errorProfileKeyTakenNoRepeat}
        <br />
        {isAdmin ? (
          <>
            {l.errorProfileKeyTakenRest} <a href="/admin/duplicates">{l.errorProfileKeyTakenDuplicates}</a>
          </>
        ) : (
          l.errorProfileKeyTakenAskAdmin
        )}
        {" — "}<strong>{l.errorProfileKeyTakenNoAuto}</strong>
      </div>
    </>
  );
}
