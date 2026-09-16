import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { listOutreachCandidates, outreachReasons } from "@/lib/outreach/queries";
import { ROLE_GROUPS, ROLE_GROUP_LABELS, type RoleGroupKey } from "@/lib/roleGroups";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const ROLE_GROUP_KEYS = new Set(ROLE_GROUPS.map((g) => g.key));

function isRoleGroupKey(v: string | undefined): v is RoleGroupKey {
  return !!v && ROLE_GROUP_KEYS.has(v as RoleGroupKey);
}

/** "8mo ago" / "3d ago" — same coarse relative time as the contacts list (see src/app/page.tsx). */
function relativeTime(date: Date): string {
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{
    roleGroup?: string;
    excludeNever?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getCurrentBd();
  const page = Math.max(1, Number(sp.page) || 1);
  const roleGroup = isRoleGroupKey(sp.roleGroup) ? sp.roleGroup : undefined;
  // A GET checkbox that's unchecked is simply omitted from the submitted
  // query string, indistinguishable from "form never submitted" — so the
  // control is phrased as an opt-in "exclude" checkbox (default unchecked)
  // rather than an "include" one. Unset or absent -> included (the
  // required default); present -> excluded.
  const excludeNeverMessaged = sp.excludeNever === "on";
  const includeNeverMessaged = !excludeNeverMessaged;

  const { rows, total, page: current, totalPages, hiringCompanyCount } =
    await listOutreachCandidates(me.id, { roleGroup, includeNeverMessaged }, page, PAGE_SIZE);

  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (roleGroup) params.set("roleGroup", roleGroup);
    if (excludeNeverMessaged) params.set("excludeNever", "on");
    params.set("page", String(p));
    return `/outreach?${params.toString()}`;
  };

  return (
    <main>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <div className="row" style={{ gap: "0.75rem" }}>
          <Link className="secondary-btn" href="/">
            ← contacts
          </Link>
          <Link className="secondary-btn" href="/hiring">
            hiring signals →
          </Link>
        </div>
      </div>

      <div style={{ marginBottom: "1.75rem" }}>
        <div className="eyebrow">// priority_outreach</div>
        <h1>
          who to message this week<span className="dot">.</span>
        </h1>
        <p className="soft" style={{ margin: 0 }}>
          Your contacts at companies currently hiring IT, ranked by relationship strength and
          seniority.
        </p>
      </div>

      <section className="panel">
        <div className="eyebrow">// filter</div>
        <form method="get" className="filter-toolbar">
          <div className="filter-field">
            <label htmlFor="roleGroup">Role group</label>
            <select id="roleGroup" name="roleGroup" defaultValue={roleGroup ?? ""}>
              <option value="">All groups</option>
              {ROLE_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field filter-field-checkbox">
            <label htmlFor="excludeNever" className="checkbox-label">
              <input
                id="excludeNever"
                name="excludeNever"
                type="checkbox"
                defaultChecked={excludeNeverMessaged}
              />
              Exclude never-messaged contacts
            </label>
          </div>
          <button type="submit" className="filter-submit">
            Filter
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="eyebrow">// candidates</div>
        <p className="soft" style={{ marginTop: 0 }}>
          {total} total · page {current} of {totalPages}
        </p>

        {!hiringCompanyCount && (
          <p className="muted">
            No hiring companies synced yet. Seed target companies and run a sync (see{" "}
            <Link href="/hiring">hiring signals</Link>) before priority outreach has anything to
            rank.
          </p>
        )}

        {hiringCompanyCount > 0 && !rows.length && (
          <p className="muted">
            {hiringCompanyCount} compan{hiringCompanyCount === 1 ? "y is" : "ies are"} hiring IT,
            but none of your contacts work there
            {roleGroup ? " in this role group" : ""}
            {!includeNeverMessaged ? " with a message history" : ""}. Try clearing the filter
            above.
          </p>
        )}

        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Company</th>
                  <th>Role group</th>
                  <th>Open IT roles</th>
                  <th>Last contact</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="rowlink" href={`/contact/${r.id}`}>
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                      </Link>
                    </td>
                    <td>{r.position ?? "—"}</td>
                    <td>{r.company ?? "—"}</td>
                    <td>{r.roleGroup ? ROLE_GROUP_LABELS[r.roleGroup] : "—"}</td>
                    <td>{r.openItCount}</td>
                    <td>{r.lastMessageAt ? relativeTime(new Date(r.lastMessageAt)) : "never"}</td>
                    <td>
                      <div className="reason-chips">
                        {outreachReasons(r, relativeTime).map((reason) => (
                          <span
                            key={reason}
                            className={
                              r.relationshipTier === "dormant"
                                ? "badge dormant"
                                : r.isLeadership
                                  ? "badge green"
                                  : "badge"
                            }
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="pager">
            {current > 1 ? (
              <Link className="secondary-btn" href={qs(current - 1)}>
                ← prev
              </Link>
            ) : (
              <span className="secondary-btn disabled">← prev</span>
            )}
            <span className="soft">
              {current} / {totalPages}
            </span>
            {current < totalPages ? (
              <Link className="secondary-btn" href={qs(current + 1)}>
                next →
              </Link>
            ) : (
              <span className="secondary-btn disabled">next →</span>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
