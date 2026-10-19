"use client";

import { useRouter } from "next/navigation";
import type { MeetingView } from "@/lib/meetings/status";
import type { MeetingLabels } from "@/lib/meetings/labels";

/**
 * The admin's BD and date-range filters (meetings mockup 3c). Changing one navigates with the new query, keeping the tab, so
 * the URL stays shareable and the tab counts follow the filters. A date is applied only once it is a complete value.
 */
export function MeetingFilters({
  labels: l,
  view,
  bds,
  bd,
  from,
  to,
}: {
  labels: MeetingLabels;
  view: MeetingView;
  bds: { id: string; name: string }[];
  bd: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const go = (next: { bd: string; from: string; to: string }) => {
    const query = new URLSearchParams({ view });
    if (next.bd) query.set("bd", next.bd);
    if (next.from) query.set("from", next.from);
    if (next.to) query.set("to", next.to);
    router.push(`/reuniones?${query.toString()}`);
  };

  return (
    <div className="toolbar filters mb-lg">
      <div className="field">
        <label className="label" htmlFor="meetings-bd">
          {l.filterBd}
        </label>
        <select id="meetings-bd" className="select input-sm" value={bd} onChange={(e) => go({ bd: e.target.value, from, to })}>
          <option value="">{l.filterBdAll}</option>
          {bds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="meetings-from">
          {l.filterFrom}
        </label>
        <input id="meetings-from" className="input input-sm" type="date" value={from} onChange={(e) => e.target.value && go({ bd, from: e.target.value, to })} />
      </div>
      <div className="field">
        <label className="label" htmlFor="meetings-to">
          {l.filterTo}
        </label>
        <input id="meetings-to" className="input input-sm" type="date" value={to} onChange={(e) => e.target.value && go({ bd, from, to: e.target.value })} />
      </div>
      <span className="badge badge-neutral no-dot">{l.adminBadge}</span>
    </div>
  );
}
