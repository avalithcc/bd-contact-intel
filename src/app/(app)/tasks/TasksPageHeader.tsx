import type { ReactNode } from "react";

/** The /tasks page header, built the way the approved mockup and the contacts
 * page build theirs: eyebrow, lowercase h1 with the accent dot, meta subline. */
export function TasksPageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  actions: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="titles">
        <div className="eyebrow">{eyebrow}</div>
        <h1>
          {title}
          <span className="dot">.</span>
        </h1>
        <p className="meta">{subtitle}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
