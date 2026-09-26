/**
 * Tests for src/lib/hubspot/companies.ts (design D3, hubspot-import spec
 * "Company matching and creation" / "Company domain storage" /
 * "Contact-to-company linking" / "Company notes become company-level
 * activities" / "Own-company skip"). Synthetic fixtures only — no real
 * HubSpot export data.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapHubSpotCompanyRow,
  normalizeDomain,
  normalizeCompactCompanyKey,
  groupHubSpotCompanies,
  planCompanyResolution,
  resolveContactCompanyKey,
  type HubSpotCompanyRow,
  type ExistingCompanyRef,
} from "@/lib/hubspot/companies";

function row(overrides: Partial<HubSpotCompanyRow> = {}): HubSpotCompanyRow {
  return {
    hubspotCompanyId: "1",
    name: "Acme Corp",
    domain: "acme.com",
    additionalDomains: [],
    note: null,
    city: null,
    country: null,
    sector: null,
    ...overrides,
  };
}

test("normalizeDomain strips protocol, www, and path", () => {
  assert.equal(normalizeDomain("https://www.Acme.com/about"), "acme.com");
  assert.equal(normalizeDomain("http://acme.com"), "acme.com");
  assert.equal(normalizeDomain("acme.com"), "acme.com");
  assert.equal(normalizeDomain("  "), null);
  assert.equal(normalizeDomain(undefined), null);
});

test("mapHubSpotCompanyRow projects the pinned columns", () => {
  const mapped = mapHubSpotCompanyRow({
    "ID de registro": "42",
    "Nombre de la empresa": "Acme Corp",
    "Nombre de dominio de la empresa": "www.acme.com",
    "Dominios adicionales": "acme.io; acme.co.uk",
    "Associated Note": "Met at a conference",
    Ciudad: "Buenos Aires",
    "País/región": "Argentina",
    Sector: "Software",
  });
  assert.deepEqual(mapped, {
    hubspotCompanyId: "42",
    name: "Acme Corp",
    domain: "acme.com",
    additionalDomains: ["acme.io", "acme.co.uk"],
    note: "Met at a conference",
    city: "Buenos Aires",
    country: "Argentina",
    sector: "Software",
  });
});

test("mapHubSpotCompanyRow blanks become null and missing additional domains become []", () => {
  const mapped = mapHubSpotCompanyRow({
    "ID de registro": "42",
    "Nombre de la empresa": "",
    "Nombre de dominio de la empresa": "",
    "Dominios adicionales": "",
    "Associated Note": "",
    Ciudad: "",
    "País/región": "",
    Sector: "",
  });
  assert.equal(mapped.name, null);
  assert.equal(mapped.domain, null);
  assert.deepEqual(mapped.additionalDomains, []);
  assert.equal(mapped.note, null);
});

test("groupHubSpotCompanies merges rows that share a domain (primary or additional)", () => {
  const rows = [
    row({ hubspotCompanyId: "1", domain: "acme.com", additionalDomains: [] }),
    row({ hubspotCompanyId: "2", name: "Acme Inc", domain: null, additionalDomains: ["acme.com"] }),
    row({ hubspotCompanyId: "3", name: "Other Co", domain: "other.com", additionalDomains: [] }),
  ];
  const groups = groupHubSpotCompanies(rows);
  assert.equal(groups.length, 2);
  const acmeGroup = groups.find((g) => g.rows.some((r) => r.hubspotCompanyId === "1"))!;
  assert.equal(acmeGroup.rows.length, 2);
  assert.ok(acmeGroup.domains.includes("acme.com"));
});

test("groupHubSpotCompanies keeps domain-less rows as singleton groups", () => {
  const rows = [row({ hubspotCompanyId: "1", domain: null, additionalDomains: [] })];
  const groups = groupHubSpotCompanies(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.domains, []);
});

test("planCompanyResolution: domain match links to existing company, creates nothing", () => {
  const existing: ExistingCompanyRef[] = [{ companyKey: "acme corp", domain: "acme.com" }];
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", domain: "acme.com" })],
    existing,
    new Map([["1", 1]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 0);
  assert.equal(result.byHubspotCompanyId.get("1")?.companyKey, "acme corp");
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "domain");
});

test("planCompanyResolution: no domain match falls back to normalized-name match and fills empty domain", () => {
  const existing: ExistingCompanyRef[] = [{ companyKey: "acme", domain: null }];
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Acme Corp", domain: "acme.com" })],
    existing,
    new Map([["1", 1]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 0);
  assert.equal(result.byHubspotCompanyId.get("1")?.companyKey, "acme");
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "name");
  assert.deepEqual(result.domainFills, [{ companyKey: "acme", domain: "acme.com" }]);
});

test("planCompanyResolution: name match does NOT overwrite an existing non-empty domain", () => {
  const existing: ExistingCompanyRef[] = [{ companyKey: "acme", domain: "already-set.com" }];
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Acme Corp", domain: "acme.com" })],
    existing,
    new Map([["1", 1]]),
    new Set(),
  );
  // acme.com doesn't match already-set.com by domain, so it falls through to
  // name matching; since the existing domain is non-empty, it is NOT filled.
  assert.equal(result.domainFills.length, 0);
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "name");
});

test("planCompanyResolution: creates a company only when it is a primary company of an imported contact", () => {
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "New Co", domain: "newco.com", note: null })],
    [],
    new Map([["1", 2]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 1);
  assert.equal(result.companiesToCreate[0]!.companyKey, "new co");
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "created");
});

test("planCompanyResolution: creates a company that carries a note even with zero primary contacts", () => {
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Noted Co", domain: "noted.com", note: "Some note" })],
    [],
    new Map(),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 1);
  assert.equal(result.notesToCreate.length, 1);
  assert.equal(result.notesToCreate[0]!.companyKey, "noted co");
});

test("planCompanyResolution: unlinked, note-less company creates nothing", () => {
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Nobody Links Here", domain: "nobody.com", note: null })],
    [],
    new Map(),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 0);
  assert.equal(result.byHubspotCompanyId.get("1")?.companyKey, null);
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "unresolved");
});

test("planCompanyResolution: own-company group creates nothing and no note, is flagged own_company", () => {
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Avalith", domain: "avalith.net", note: "Internal note" })],
    [],
    new Map([["1", 5]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 0);
  assert.equal(result.notesToCreate.length, 0);
  assert.equal(result.byHubspotCompanyId.get("1")?.companyKey, null);
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "own_company");
});

test("planCompanyResolution: representative for creation is the row with the most primary contacts, ties -> lowest id", () => {
  const rows = [
    row({ hubspotCompanyId: "20", name: "Group Co", domain: "groupco.com" }),
    row({ hubspotCompanyId: "5", name: "Group Co Inc", domain: null, additionalDomains: ["groupco.com"] }),
  ];
  const result = planCompanyResolution(rows, [], new Map([["20", 1], ["5", 1]]), new Set());
  assert.equal(result.companiesToCreate.length, 1);
  assert.equal(result.companiesToCreate[0]!.hubspotCompanyId, "5");
});

test("planCompanyResolution: note is skipped when one with the same hubspotCompanyId already exists", () => {
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Noted Co", domain: "noted.com", note: "Some note" })],
    [],
    new Map(),
    new Set(["1"]),
  );
  assert.equal(result.notesToCreate.length, 0);
  // it still creates the company (the note existing doesn't change eligibility
  // computed from the incoming row carrying a note)
  assert.equal(result.companiesToCreate.length, 1);
});

test("resolveContactCompanyKey: absent primary company id is noCompanyResolved", () => {
  const resolved = resolveContactCompanyKey(null, new Map());
  assert.equal(resolved.companyKey, null);
  assert.equal(resolved.noCompanyResolved, true);
  assert.equal(resolved.ownCompany, false);
});

test("resolveContactCompanyKey: unresolved company id is noCompanyResolved", () => {
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Nobody Links Here", domain: "nobody.com", note: null })],
    [],
    new Map(),
    new Set(),
  );
  const resolved = resolveContactCompanyKey("1", result.byHubspotCompanyId);
  assert.equal(resolved.companyKey, null);
  assert.equal(resolved.noCompanyResolved, true);
});

test("resolveContactCompanyKey: own-company link is skipped, not counted as noCompanyResolved", () => {
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Avalith", domain: "avalith.net" })],
    [],
    new Map([["1", 1]]),
    new Set(),
  );
  const resolved = resolveContactCompanyKey("1", result.byHubspotCompanyId);
  assert.equal(resolved.companyKey, null);
  assert.equal(resolved.noCompanyResolved, false);
  assert.equal(resolved.ownCompany, true);
});

test("normalizeDomain strips a trailing port", () => {
  assert.equal(normalizeDomain("acme.com:8080"), "acme.com");
  assert.equal(normalizeDomain("https://acme.com:443/path"), "acme.com");
});

test("normalizeDomain strips a trailing dot (FQDN)", () => {
  assert.equal(normalizeDomain("acme.com."), "acme.com");
  assert.equal(normalizeDomain("www.acme.com."), "acme.com");
});

test("planCompanyResolution: two creation-eligible groups that normalize to the same companyKey with different domains create once and link the second by name, reporting a domain conflict", () => {
  const rows = [
    row({ hubspotCompanyId: "1", name: "Acme Corp", domain: "acme.com", additionalDomains: [], note: null }),
    row({ hubspotCompanyId: "2", name: "Acme Corp.", domain: "acme-alt.com", additionalDomains: [], note: null }),
  ];
  const result = planCompanyResolution(
    rows,
    [],
    new Map([["1", 1], ["2", 1]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 1);
  assert.equal(result.companiesToCreate[0]!.domain, "acme.com");
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "created");
  assert.equal(result.byHubspotCompanyId.get("2")?.matchReason, "name");
  assert.equal(result.byHubspotCompanyId.get("2")?.companyKey, result.companiesToCreate[0]!.companyKey);
  assert.deepEqual(result.domainConflicts, [
    {
      companyKey: result.companiesToCreate[0]!.companyKey,
      keptDomain: "acme.com",
      rejectedDomain: "acme-alt.com",
      hubspotCompanyId: "2",
    },
  ]);
});

test("planCompanyResolution: two creation-eligible groups that normalize to the same companyKey and are both domain-less create once and link the second, no conflict reported", () => {
  const rows = [
    row({ hubspotCompanyId: "1", name: "Acme Corp", domain: null, additionalDomains: [], note: null }),
    row({ hubspotCompanyId: "2", name: "Acme Corp.", domain: null, additionalDomains: [], note: null }),
  ];
  const result = planCompanyResolution(
    rows,
    [],
    new Map([["1", 1], ["2", 1]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 1);
  assert.equal(result.companiesToCreate[0]!.domain, null);
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "created");
  assert.equal(result.byHubspotCompanyId.get("2")?.matchReason, "name");
  assert.equal(result.domainConflicts.length, 0);
});

test("planCompanyResolution: creation collisions are resolved deterministically by ascending hubspotCompanyId regardless of input row order", () => {
  const rows = [
    row({ hubspotCompanyId: "9", name: "Acme Corp.", domain: "acme-alt.com", additionalDomains: [], note: null }),
    row({ hubspotCompanyId: "3", name: "Acme Corp", domain: "acme.com", additionalDomains: [], note: null }),
  ];
  const result = planCompanyResolution(
    rows,
    [],
    new Map([["9", 1], ["3", 1]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 1);
  // lowest hubspotCompanyId ("3") wins regardless of its position in the input array
  assert.equal(result.companiesToCreate[0]!.hubspotCompanyId, "3");
  assert.equal(result.companiesToCreate[0]!.domain, "acme.com");
  assert.equal(result.domainConflicts[0]!.rejectedDomain, "acme-alt.com");
});

test("planCompanyResolution: two groups name-matching the same existing domain-less company with different domains fill once and report a domain conflict", () => {
  const existing: ExistingCompanyRef[] = [{ companyKey: "acme", domain: null }];
  const rows = [
    row({ hubspotCompanyId: "1", name: "Acme Corp", domain: "acme.com", additionalDomains: [], note: null }),
    row({ hubspotCompanyId: "2", name: "Acme Corp.", domain: "acme-alt.com", additionalDomains: [], note: null }),
  ];
  const result = planCompanyResolution(
    rows,
    existing,
    new Map([["1", 1], ["2", 1]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 0);
  assert.deepEqual(result.domainFills, [{ companyKey: "acme", domain: "acme.com" }]);
  assert.deepEqual(result.domainConflicts, [
    { companyKey: "acme", keptDomain: "acme.com", rejectedDomain: "acme-alt.com", hubspotCompanyId: "2" },
  ]);
  assert.equal(result.byHubspotCompanyId.get("1")?.companyKey, "acme");
  assert.equal(result.byHubspotCompanyId.get("2")?.companyKey, "acme");
});

// --- H6 dry-run fix: compact-key fallback (company.domain not yet populated) --

test("normalizeCompactCompanyKey strips spaces, punctuation and generic suffix tokens", () => {
  assert.equal(normalizeCompactCompanyKey("mercadolibre com"), "mercadolibre");
  assert.equal(normalizeCompactCompanyKey("mercadolibre"), "mercadolibre");
  assert.equal(normalizeCompactCompanyKey("cook unity"), "cookunity");
  assert.equal(normalizeCompactCompanyKey("kavak com"), "kavak");
  assert.equal(normalizeCompactCompanyKey("thoughtworks holding"), "thoughtworks");
  assert.equal(normalizeCompactCompanyKey("thoughtworks"), "thoughtworks");
  assert.equal(normalizeCompactCompanyKey("the bridge"), "bridge");
  assert.equal(normalizeCompactCompanyKey("bridge"), "bridge");
  assert.equal(normalizeCompactCompanyKey("nisum technologies"), "nisum");
  assert.equal(normalizeCompactCompanyKey("nisum"), "nisum");
});

test("normalizeCompactCompanyKey normalizes a URL-shaped name to the host label, never containing 'https'", () => {
  const compact = normalizeCompactCompanyKey("https://www truelogic io/");
  assert.equal(compact, "truelogic");
  assert.ok(!compact!.includes("https"));
  assert.equal(normalizeCompactCompanyKey("truelogic software"), "truelogic");
});

test("normalizeCompactCompanyKey returns null for blank input", () => {
  assert.equal(normalizeCompactCompanyKey(""), null);
  assert.equal(normalizeCompactCompanyKey(null), null);
  assert.equal(normalizeCompactCompanyKey(undefined), null);
});

test("planCompanyResolution: unique compact-key match links to the existing company and fills its empty domain", () => {
  const existing: ExistingCompanyRef[] = [{ companyKey: "mercadolibre com", domain: null }];
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "MercadoLibre", domain: null, additionalDomains: [] })],
    existing,
    new Map([["1", 1]]),
    new Set(),
  );
  assert.equal(result.companiesToCreate.length, 0);
  assert.equal(result.byHubspotCompanyId.get("1")?.companyKey, "mercadolibre com");
  assert.equal(result.byHubspotCompanyId.get("1")?.matchReason, "compact");
  assert.equal(result.ambiguousCompactMatches, 0);
  assert.deepEqual(result.compactMatches, [{ hubspotName: "MercadoLibre", existingCompanyKey: "mercadolibre com" }]);
});

test("planCompanyResolution: an ambiguous compact match is NOT recorded in compactMatches (owner review is only for confident matches)", () => {
  const existing: ExistingCompanyRef[] = [
    { companyKey: "acme io", domain: null },
    { companyKey: "acme inc", domain: null },
  ];
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Acme", domain: "acme-new.com", additionalDomains: [] })],
    existing,
    new Map([["1", 1]]),
    new Set(),
  );
  assert.deepEqual(result.compactMatches, []);
});

test("planCompanyResolution: a domain or exact-name match is NOT recorded in compactMatches — only the loose fallback needs owner review", () => {
  const existing: ExistingCompanyRef[] = [{ companyKey: "acme corp", domain: "acme.com" }];
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", domain: "acme.com" })],
    existing,
    new Map([["1", 1]]),
    new Set(),
  );
  assert.deepEqual(result.compactMatches, []);
});

test("planCompanyResolution: compact match does not overwrite an existing non-empty domain", () => {
  const existing: ExistingCompanyRef[] = [{ companyKey: "kavak com", domain: "kavak.com.mx" }];
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Kavak", domain: null, additionalDomains: [] })],
    existing,
    new Map([["1", 1]]),
    new Set(),
  );
  assert.equal(result.byHubspotCompanyId.get("1")?.companyKey, "kavak com");
  assert.equal(result.domainFills.length, 0);
});

test("planCompanyResolution: a compact key matching two DIFFERENT existing companies is ambiguous — creates instead of guessing", () => {
  const existing: ExistingCompanyRef[] = [
    { companyKey: "acme io", domain: null },
    { companyKey: "acme inc", domain: null },
  ];
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Acme", domain: "acme-new.com", additionalDomains: [] })],
    existing,
    new Map([["1", 1]]),
    new Set(),
  );
  assert.equal(result.ambiguousCompactMatches, 1);
  assert.equal(result.companiesToCreate.length, 1);
});

test("planCompanyResolution: a company created earlier in the same run is compact-matched by a later group", () => {
  const rows = [
    row({ hubspotCompanyId: "1", name: "Nisum", domain: null, additionalDomains: [], note: null }),
    row({ hubspotCompanyId: "2", name: "Nisum Technologies", domain: null, additionalDomains: [], note: null }),
  ];
  const result = planCompanyResolution(rows, [], new Map([["1", 1], ["2", 1]]), new Set());
  assert.equal(result.companiesToCreate.length, 1);
  assert.equal(result.byHubspotCompanyId.get("2")?.matchReason, "compact");
  assert.equal(result.byHubspotCompanyId.get("2")?.companyKey, result.companiesToCreate[0]!.companyKey);
});

test("resolveContactCompanyKey: resolved company id returns its companyKey", () => {
  const result = planCompanyResolution(
    [row({ hubspotCompanyId: "1", name: "Acme Corp", domain: "acme.com" })],
    [{ companyKey: "acme", domain: "acme.com" }],
    new Map([["1", 1]]),
    new Set(),
  );
  const resolved = resolveContactCompanyKey("1", result.byHubspotCompanyId);
  assert.equal(resolved.companyKey, "acme");
  assert.equal(resolved.noCompanyResolved, false);
});
