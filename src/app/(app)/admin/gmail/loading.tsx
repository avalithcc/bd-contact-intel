import { getDictionary } from "@/lib/i18n/server";
import { FleetHead } from "./FleetTable";

/** Route-level fallback for /admin/gmail: the real header (with its tooltips) over skeleton rows, as in the mockup's loading state. */
export default async function GmailFleetLoading() {
  const d = (await getDictionary()).gmailFleet;
  const widths = [80, 110, 90, 150, 70, 70];
  return (
    <main className="page" aria-busy="true">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{d.eyebrow}</div>
          <h1>
            {d.title}
            <span className="dot">.</span>
          </h1>
        </div>
      </div>
      <div className="table-wrap" aria-busy="true" aria-label={d.loading}>
        <table className="data">
          <FleetHead d={d} />
          <tbody>
            {Array.from({ length: 4 }, (_, i) => (
              <tr key={i}>
                <td>
                  <div className="owner-chip">
                    <span className="skeleton" style={{ width: 28, height: 28, borderRadius: "50%" }} />
                    <div className="skeleton" style={{ height: 14, width: 120 }} />
                  </div>
                </td>
                {widths.map((w, j) => (
                  <td key={j}>
                    <div className="skeleton" style={{ height: 14, width: w }} />
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
