import type { MarketKey } from "@/lib/hiring/markets";
import { postingAdHref, type OpenPosting } from "@/lib/hiring/postingRow";

interface Labels {
  hiringTablePosition: string;
  hiringTableLocation: string;
  hiringTableMarket: string;
}

/** The company record's hiring tab: position (linked to the original ad), location and market. */
export function HiringPostingsTable({
  postings,
  labels,
  markets,
}: {
  postings: readonly OpenPosting[];
  labels: Labels;
  markets: Record<MarketKey, string>;
}) {
  return (
    <div className="table-wrap mt-xl">
      <table className="data compact">
        <thead>
          <tr>
            <th>{labels.hiringTablePosition}</th>
            <th>{labels.hiringTableLocation}</th>
            <th>{labels.hiringTableMarket}</th>
          </tr>
        </thead>
        <tbody>
          {postings.map((p) => {
            const href = postingAdHref(p.url);
            return (
              <tr key={p.id}>
                <td>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer">
                      {p.title}
                    </a>
                  ) : (
                    p.title
                  )}
                </td>
                <td>{p.location}</td>
                <td>
                  <span className="badge badge-neutral no-dot">{markets[p.market]}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
