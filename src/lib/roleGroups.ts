/**
 * Deterministic classification of a free-text LinkedIn `Position` into a
 * coarse role group, for filtering the contact base by function/seniority.
 *
 * Ported from the validated Python prototype (priority-ordered keyword/regex
 * rules, first match wins). Titles are mixed English/Spanish and matched
 * case-insensitively on word boundaries.
 *
 * Note on word boundaries: JS's built-in `\b` only treats ASCII
 * `[A-Za-z0-9_]` as word characters, so it misclassifies boundaries around
 * accented letters (e.g. "tecnología", "líder"). `wordBoundary` below builds
 * an equivalent boundary using `\p{L}\p{N}_` (Unicode letters/numbers) so
 * Spanish accented titles are matched correctly.
 */

export type RoleGroupKey =
  | "c_level_tech"
  | "c_level_business"
  | "eng_leadership"
  | "engineering_manager"
  | "tech_lead_architect"
  | "product"
  | "project_delivery"
  | "developers"
  | "hr_recruiting"
  | "sales_bd"
  | "operations"
  | "other"
  | "no_position";

export interface RoleGroupDef {
  key: RoleGroupKey;
  label: string;
}

// Ordered for display; classification order is defined separately by RULES
// below (must match: c_level_tech, c_level_business, eng_leadership,
// engineering_manager, tech_lead_architect, product, project_delivery,
// developers, hr_recruiting, sales_bd, operations, other; no_position is
// the null/blank fallback and is checked before any rule).
export const ROLE_GROUPS: RoleGroupDef[] = [
  { key: "c_level_tech", label: "C-Level Tech" },
  { key: "c_level_business", label: "C-Level / Founders" },
  { key: "eng_leadership", label: "Engineering Leadership" },
  { key: "engineering_manager", label: "Engineering Managers" },
  { key: "tech_lead_architect", label: "Tech Leads & Architects" },
  { key: "product", label: "Product" },
  { key: "project_delivery", label: "Project & Delivery" },
  { key: "developers", label: "Developers" },
  { key: "hr_recruiting", label: "HR & Recruiting" },
  { key: "sales_bd", label: "Sales & BD" },
  { key: "operations", label: "Operations" },
  { key: "other", label: "Other" },
  { key: "no_position", label: "No position" },
];

export const ROLE_GROUP_LABELS: Record<RoleGroupKey, string> = Object.fromEntries(
  ROLE_GROUPS.map((g) => [g.key, g.label]),
) as Record<RoleGroupKey, string>;

// Unicode-aware "word" character class: letters (incl. accented), digits, underscore.
const WORD_CHAR = "\\p{L}\\p{N}_";

/** Build a case-insensitive, Unicode-aware word-boundary regex over alternatives. */
function w(...patterns: string[]): RegExp {
  const alt = patterns.join("|");
  return new RegExp(`(?<![${WORD_CHAR}])(?:${alt})(?![${WORD_CHAR}])`, "iu");
}

type Rule = [Exclude<RoleGroupKey, "other" | "no_position">, RegExp];

// Priority-ordered rules — first match wins. Faithfully ported from the
// Python prototype at scratchpad roles.py.
const RULES: Rule[] = [
  [
    "c_level_tech",
    w(
      "cto",
      "cio",
      "cdo",
      "cpo",
      "chief (?:technology|information|digital|product|data|technical|architect\\w*) officer",
      "chief technical officer",
    ),
  ],
  [
    "c_level_business",
    w(
      "ceo",
      "coo",
      "cfo",
      "cmo",
      "cro",
      "chief \\w+(?: \\w+)? officer",
      "founder",
      "co-?founder",
      "co ?founder",
      "fundador\\w*",
      "co-?fundador\\w*",
      "cofundador\\w*",
      "president\\w*",
      "presidente",
      "owner",
      "due[ñn]o",
      "managing (?:director|partner)",
      "general manager",
      "gerente general",
      "country manager",
      "socio\\w*",
      "partner",
      "board member",
    ),
  ],
  [
    "eng_leadership",
    w(
      "vp",
      "vice ?president",
      "svp",
      "evp",
      "head of (?:engineering|technology|software|tech|development|it|platform|data|infrastructure)",
      "(?:director|directora)(?: of| de)? (?:engineering|software|technology|tecnolog[ií]a|it|sistemas|desarrollo|ingenier[ií]a|platform|technical)",
      "engineering director",
      "technical director",
      "it director",
      "gerente de (?:tecnolog[ií]a|sistemas|desarrollo|it|ingenier[ií]a)",
      "jefe de (?:sistemas|tecnolog[ií]a|desarrollo|it)",
      "it manager",
      "tech manager",
      "technology manager",
    ),
  ],
  [
    "engineering_manager",
    w(
      "engineering manager",
      "engineer manager",
      "software (?:engineering|development) manager",
      "development manager",
      "dev manager",
      "l[ií]der de (?:equipo|desarrollo)",
    ),
  ],
  [
    "tech_lead_architect",
    w(
      "tech(?:nical)? lead(?:er)?",
      "team lead(?:er)?",
      "lead (?:software |backend |frontend |full ?stack )?(?:engineer|developer)",
      "architect",
      "arquitect[oa]",
      "l[ií]der t[eé]cnico",
      "staff (?:software )?engineer",
      "principal (?:software )?engineer",
    ),
  ],
  [
    "product",
    w(
      "product (?:manager|owner|lead|director|designer)",
      "head of product",
      "po",
      "director of product",
      "vp of product",
    ),
  ],
  [
    "project_delivery",
    w(
      "project manager",
      "program manager",
      "delivery (?:manager|director|lead)",
      "head of delivery",
      "scrum master",
      "agile coach",
      "pmo",
      "gerente de proyect\\w+",
      "jefe de proyect\\w+",
      "l[ií]der de proyect\\w+",
    ),
  ],
  [
    "developers",
    w(
      "developer",
      "engineer",
      "desarrollador\\w*",
      "programador\\w*",
      "ingenier[oa] de software",
      "devops",
      "sre",
      "qa",
      "tester",
      "full ?-?stack",
      "back ?-?end",
      "front ?-?end",
      "data scientist",
      "analista programador",
      "software",
    ),
  ],
  [
    "hr_recruiting",
    w(
      "recruit\\w*",
      "talent",
      "hr\\w*",
      "human resources",
      "recursos humanos",
      "rrhh",
      "people",
      "reclutador\\w*",
      "selecci[oó]n",
    ),
  ],
  [
    "sales_bd",
    w(
      "sales",
      "business development",
      "account (?:manager|executive)",
      "comercial",
      "ventas",
      "sdr",
      "bdr",
      "customer success",
      "marketing",
    ),
  ],
  ["operations", w("operations", "operaciones", "head of ops")],
];

/**
 * Classify a contact's `position` string into a role group.
 * Null/blank positions map to "no_position"; anything not matching any rule
 * falls back to "other".
 */
export function classifyPosition(position: string | null | undefined): RoleGroupKey {
  const p = position?.trim();
  if (!p) return "no_position";
  for (const [key, rx] of RULES) {
    if (rx.test(p)) return key;
  }
  return "other";
}
