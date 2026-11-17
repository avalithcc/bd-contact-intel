/**
 * "You emailed" badge on a follow-up card: the viewing BD sent this contact a personal email from their own mailbox
 * (not a sequence send). Renders nothing when false — an absent badge says more than a negative one.
 */
export function EmailedByMeBadge({ emailedByMe, label, title }: { emailedByMe: boolean; label: string; title: string }) {
  if (!emailedByMe) return null;
  return (
    <span className="badge badge-outline no-dot" title={title}>
      {label}
    </span>
  );
}
