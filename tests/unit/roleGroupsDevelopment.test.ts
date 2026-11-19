/**
 * "<commercial qualifier> Development" is a sales title, and "Engineering
 * Lead" is an engineering one. One classifier serves both person.role_group
 * and job_posting.is_it, so a wrong pattern is wrong in both places.
 *
 * Title provenance: the five named titles come from the defect report. The
 * rest are standard public job-title vocabulary written for this test (the
 * local scratch database holds only 14 distinct titles); none is a
 * production export, and none is a person's data.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyPosition, type RoleGroupKey } from "../../src/lib/roleGroups";
import { IT_ROLE_GROUPS, isItPosting } from "../../src/lib/hiring/classify";

const ENGINEERING_GROUPS: RoleGroupKey[] = [
  "c_level_tech",
  "eng_leadership",
  "engineering_manager",
  "tech_lead_architect",
  "developers",
];

test("Broker Development Manager is sales", () => {
  assert.equal(classifyPosition("Broker Development Manager"), "sales_bd");
});
test("Business Development Manager is sales", () => {
  assert.equal(classifyPosition("Business Development Manager"), "sales_bd");
});
test("Engineering Lead is engineering", () => {
  assert.ok(ENGINEERING_GROUPS.includes(classifyPosition("Engineering Lead")));
});
test("Development Manager stays engineering_manager", () => {
  assert.equal(classifyPosition("Development Manager"), "engineering_manager");
});
test("Lead Engineer stays tech_lead_architect", () => {
  assert.equal(classifyPosition("Lead Engineer"), "tech_lead_architect");
});
test("Sales Development Representative stays sales_bd", () => {
  assert.equal(classifyPosition("Sales Development Representative"), "sales_bd");
});

const COMMERCIAL_DEVELOPMENT: string[] = [
  "Business Development Manager",
  "Broker Development Manager",
  "Sales Development Manager",
  "Partner Development Manager",
  "Channel Development Manager",
  "Market Development Manager",
  "Client Development Manager",
  "Customer Development Manager",
  "Account Development Manager",
  "Business Development Lead",
  "Business Development Director",
  "Head of Business Development",
  "Director of Business Development",
  "Director, Business Development",
  "Global Business Development Manager",
  "Senior Business Development Manager",
  "VP of Global Business Development & Alliances",
  "VP Business Development",
  "Vice President, Business Development",
  "Business Developer",
  "Director de Desarrollo de Negocios",
  "Gerente de Desarrollo de Negocios",
  "Gerente de Desarrollo Comercial",
];

for (const title of COMMERCIAL_DEVELOPMENT) {
  test(`commercial development stays out of engineering: ${title}`, () => {
    const group = classifyPosition(title);
    assert.ok(!ENGINEERING_GROUPS.includes(group), `${title} -> ${group}`);
    assert.equal(isItPosting(title), false);
  });
}

const ENGINEERING_LEADERSHIP: [string, RoleGroupKey][] = [
  ["Engineering Lead", "tech_lead_architect"],
  ["Engineering Leader", "tech_lead_architect"],
  ["Software Engineering Lead", "tech_lead_architect"],
  ["Senior Engineering Lead", "tech_lead_architect"],
  ["Technology Lead", "tech_lead_architect"],
  ["Engineering Director", "eng_leadership"],
  ["Director of Engineering", "eng_leadership"],
  ["Director, Engineering", "eng_leadership"],
  ["Head of Engineering", "eng_leadership"],
  ["Engineering Head", "eng_leadership"],
  ["VP Engineering", "eng_leadership"],
  ["VP of Engineering", "eng_leadership"],
  ["Engineering Manager", "engineering_manager"],
  ["Development Manager", "engineering_manager"],
  ["Software Development Manager", "engineering_manager"],
  ["Lead Engineer", "tech_lead_architect"],
  ["Tech Lead", "tech_lead_architect"],
];

for (const [title, group] of ENGINEERING_LEADERSHIP) {
  test(`engineering leadership phrasing: ${title} -> ${group}`, () => {
    assert.equal(classifyPosition(title), group);
    assert.equal(isItPosting(title), true);
  });
}

test("titles unrelated to development keep their group", () => {
  assert.equal(classifyPosition("Software Engineer"), "developers");
  assert.equal(classifyPosition("Sales Manager"), "sales_bd");
  assert.equal(classifyPosition("Account Executive"), "sales_bd");
  assert.equal(classifyPosition("CTO"), "c_level_tech");
});

test("isItPosting is exactly classifyPosition membership in IT_ROLE_GROUPS", () => {
  const titles = [
    ...COMMERCIAL_DEVELOPMENT,
    ...ENGINEERING_LEADERSHIP.map(([t]) => t),
    "Product Manager",
    "Recruiter",
    "",
  ];
  for (const t of titles) {
    assert.equal(isItPosting(t), IT_ROLE_GROUPS.includes(classifyPosition(t)), t);
  }
});

test("classify.ts reuses classifyPosition and owns no pattern of its own", () => {
  const src = readFileSync("src/lib/hiring/classify.ts", "utf8");
  assert.match(src, /import \{ classifyPosition[^}]*\} from "@\/lib\/roleGroups"/);
  assert.doesNotMatch(src, /RegExp|\/[^/\n]+\/[gimsuy]*\.test|\.match\(/);
});

import { planPostingIsItPage, type PostingIsItRow } from "../../src/lib/hiring/postingIsItBackfill";

test("posting backfill planner flips both ways and never mutates its input", () => {
  const rows: PostingIsItRow[] = [
    { id: "a", title: "Engineering Lead", isIt: false },
    { id: "b", title: "Business Development Manager", isIt: true },
    { id: "c", title: "Software Engineer", isIt: true },
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  const first = planPostingIsItPage(rows);
  const second = planPostingIsItPage(rows);
  assert.deepEqual(first, [
    { id: "a", from: false, to: true },
    { id: "b", from: true, to: false },
  ]);
  assert.deepEqual(second, first);
  assert.deepEqual(rows, snapshot);
});

// Real production titles (supplied by the owner's measurement of the 263 false-negative
// postings and the 94 technical people in c_level_business). Structure, not a list:
// the head of the title decides; qualifiers, parentheticals and a "VP" without an
// engineering domain do not.
const REAL_COMMA_INVERTED: [string, RoleGroupKey][] = [
  ["Manager, Forward Deployed Engineering", "engineering_manager"],
  ["Sr. Manager, Field Engineering", "engineering_manager"],
  ["Manager, Solutions Engineering", "engineering_manager"],
  ["Manager, Machine Learning Engineering", "engineering_manager"],
  ["Manager, AI Platform Engineering", "engineering_manager"],
  ["Director, Field Engineering", "eng_leadership"],
  ["Director, Forward Deployed Engineering & AI GTM Lead", "eng_leadership"],
  ["Sr. Manager, Engineering", "engineering_manager"],
  ["Sr. Manager -  BFSI, Field Engineering", "engineering_manager"],
  ["Director - Engineering", "eng_leadership"],
  ["Global Engineering Senior Director - US", "eng_leadership"],
  ["Vice President, Engineering", "eng_leadership"],
];
for (const [title, group] of REAL_COMMA_INVERTED) {
  test(`real title, leader first: ${title} -> ${group}`, () => {
    assert.equal(classifyPosition(title), group);
    assert.equal(isItPosting(title), true);
  });
}

const REAL_HIJACKED: [string, RoleGroupKey][] = [
  ["Senior Software Engineer, Backend", "developers"],
  ["Senior Software Engineer, Backend (Partner Merchant Interface)", "developers"],
  ["Software Engineer (Partner)", "developers"],
  ["Vice President of Engineering", "eng_leadership"],
  ["Senior Vice President of Engineering", "eng_leadership"],
  ["Partner Engineer", "developers"],
  ["Member of Technical Staff, Security Engineering", "developers"],
  ["Data Engineering Specialist | DataOps & Data Platform", "developers"],
];
for (const [title, group] of REAL_HIJACKED) {
  test(`real title, incidental word does not win: ${title} -> ${group}`, () => {
    assert.equal(classifyPosition(title), group);
  });
}

test("a VP without an engineering domain is not engineering leadership", () => {
  assert.equal(classifyPosition("VP Sales"), "sales_bd");
  assert.equal(classifyPosition("Vice President of Sales"), "sales_bd");
  assert.equal(classifyPosition("VP Finance"), "c_level_business");
});

test("real partners and owners keep their group, product owners do not become executives", () => {
  assert.equal(classifyPosition("Managing Partner"), "c_level_business");
  assert.equal(classifyPosition("Partner"), "c_level_business");
  assert.equal(classifyPosition("Founding Partner"), "c_level_business");
  assert.equal(classifyPosition("Owner"), "c_level_business");
  assert.equal(classifyPosition("Product Owner"), "product");
});

test("non-software engineering stays out of IT", () => {
  for (const t of ["Mechanical Engineering Apprentice", "Electrical Engineering Expert", "Manager, Mechanical Engineering"]) {
    assert.equal(isItPosting(t), false, t);
  }
});

// A technical architecture is engineering; a brand or information architecture is not. Found on production: "VP,
// Solution Architecture" was the only genuine loss among the 142 postings that stopped being IT, because the
// leader-first rewrite looked for "engineering|software" and an architecture title says neither.
test("a technical architecture is engineering, a brand or information one is not", () => {
  assert.equal(classifyPosition("VP, Solution Architecture"), "eng_leadership");
  assert.equal(classifyPosition("Director, Enterprise Architecture"), "eng_leadership");
  assert.equal(classifyPosition("Solutions Architect"), "tech_lead_architect");
  for (const t of ["VP, Brand Architecture", "Head of Information Architecture"]) {
    assert.notEqual(classifyPosition(t), "eng_leadership", t);
    assert.equal(isItPosting(t), false, t);
  }
});
