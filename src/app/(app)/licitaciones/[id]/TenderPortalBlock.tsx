import type { ReactNode } from "react";
import type { TenderPortal } from "@/db/schema";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { fillTemplate } from "@/lib/i18n/template";

/** A row exists only after a fetch, but one that never succeeded (not in the portal's search, or every try failed) holds no data. */
export function hasPortalData(portal: TenderPortal | null): portal is TenderPortal {
  return !!portal && portal.portalUrl !== null;
}

/**
 * What COMPR.AR's public view says about the tender. No row, or a row that never held data, renders NOTHING: "never fetched" must not
 * look like "the portal states nothing". Inside the block a null field is the portal's own blank, said in words.
 */
export function TenderPortalBlock({ portal, labels: l, when }: { portal: TenderPortal | null; labels: Dictionary["tenderDetail"]; when: (d: Date) => string }): ReactNode {
  if (!hasPortalData(portal)) return null;
  const text = (v: string | null) => v ?? l.portalNotStated;
  const date = (d: Date | null) => (d ? when(d) : l.portalNotStated);
  const rows: [string, string][] = [
    [l.portalObjeto, text(portal.objeto)],
    [l.portalCurrency, text(portal.currency)],
    [l.portalDuration, text(portal.contractDuration)],
    [l.portalValidity, text(portal.offerValidity)],
    [l.portalExtension, portal.acceptsExtension === null ? l.portalNotStated : portal.acceptsExtension ? l.portalYes : l.portalNo],
    [l.portalQuestionsUntil, date(portal.questionsUntil)],
    [l.portalOpening, date(portal.openingAt)],
    [l.portalGuaranteeOffer, text(portal.guaranteeOffer)],
    [l.portalGuaranteeContract, text(portal.guaranteeContract)],
    [l.portalGuaranteeChallenge, text(portal.guaranteeChallenge)],
  ];
  // The circular count comes from the acts grid of the public view; a zero says nothing a missing circular would not, so only a real count is shown.
  if ((portal.circularCount ?? 0) > 0) rows.push([l.portalCirculars, String(portal.circularCount)]);
  return (
    <div className="card mb-lg">
      <div className="card-header">
        <h3>{l.portalTitle}</h3>
      </div>
      <div className="card-body stack">
        <p className="help">{l.portalIntro}</p>
        <dl className="props">
          {rows.map(([label, value]) => (
            <div className="prop" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="help">{fillTemplate(l.portalCheckedAt, { when: when(portal.fetchedAt) })}</p>
        {portal.fetchError && (
          <div className="alert alert-warn">
            <div>{l.portalStale}</div>
          </div>
        )}
      </div>
    </div>
  );
}
