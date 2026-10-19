"use client";

import { Tooltip } from "@/components/Tooltip";
import { phoneReviewVariant } from "@/lib/phoneReview";

export interface PhoneReviewLabels {
  phoneReviewBadge: string;
  phoneReviewNoCountryTitle: string;
  phoneReviewNoCountryBody: string;
  phoneReviewUnrecognizedTitle: string;
  phoneReviewUnrecognizedBody: string;
}

/**
 * "Revisar formato" mark next to a stored phone that is not E.164 (phone-review-marker mockup). On the record it
 * explains why in a tooltip and a click/Enter opens the property's inline edit; saving a valid number rewrites it
 * to E.164 and the mark stops rendering. The contacts list shows the plain badge instead (no tooltip, no click).
 */
export function PhoneReviewBadge({ value, labels, onEdit }: { value: string; labels: PhoneReviewLabels; onEdit: () => void }) {
  const noCountry = phoneReviewVariant(value) === "no_country";
  return (
    <Tooltip
      title={noCountry ? labels.phoneReviewNoCountryTitle : labels.phoneReviewUnrecognizedTitle}
      body={noCountry ? labels.phoneReviewNoCountryBody : labels.phoneReviewUnrecognizedBody}
      actionLabel=""
      onActivate={onEdit}
    >
      <span className="badge badge-warn no-dot">{labels.phoneReviewBadge}</span>
    </Tooltip>
  );
}
