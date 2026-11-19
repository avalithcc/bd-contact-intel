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
  | "hospitality_revenue"
  | "sales_bd"
  | "operations"
  | "other"
  | "no_position";

export interface RoleGroupDef {
  key: RoleGroupKey;
}

// Ordered for display; classification order is defined separately by RULES
// below (must match: c_level_tech, c_level_business, eng_leadership,
// engineering_manager, tech_lead_architect, product, project_delivery,
// developers, hr_recruiting, hospitality_revenue, sales_bd, operations, other; no_position is
// the null/blank fallback and is checked before any rule).
//
// Display labels are localized — see src/lib/i18n/dictionaries/{en,es}.ts
// (`roleGroups` record), keyed by the same RoleGroupKey so the key list
// lives in exactly one place.
export const ROLE_GROUPS: RoleGroupDef[] = [
  { key: "c_level_tech" },
  { key: "c_level_business" },
  { key: "eng_leadership" },
  { key: "engineering_manager" },
  { key: "tech_lead_architect" },
  { key: "product" },
  { key: "project_delivery" },
  { key: "developers" },
  { key: "hr_recruiting" },
  { key: "hospitality_revenue" },
  { key: "sales_bd" },
  { key: "operations" },
  { key: "other" },
  { key: "no_position" },
];

// Unicode-aware "word" character class: letters (incl. accented), digits, underscore.
const WORD_CHAR = "\\p{L}\\p{N}_";

/** Build a case-insensitive, Unicode-aware word-boundary regex over alternatives. */
function w(...patterns: string[]): RegExp {
  const alt = patterns.join("|");
  return new RegExp(`(?<![${WORD_CHAR}])(?:${alt})(?![${WORD_CHAR}])`, "iu");
}

const VP = "vp|svp|evp|vice ?president";
const VP_DOMAIN = `(?<![${WORD_CHAR}])(?:engineering|software|technology|tech|it|platform|infrastructure|ingenier[ií]a|tecnolog[ií]a)(?![${WORD_CHAR}])`;

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
      "(?<!vice[ -])president\\w*",
      "presidente",
      // "Product Owner" / "Scrum Owner" are not business owners.
      "(?<!product |scrum |process )owner",
      "due[ñn]o",
      "managing (?:director|partner)",
      "general manager",
      "gerente general",
      "country manager",
      "socio\\w*",
      // Only a partner AT THE HEAD: bare "Partner", "Partner at X", "Founding
      // Partner". "Partner Engineer" / "Partner Manager" are not.
      "^partner(?:\\s+(?:at|en|@)\\s.*)?$",
      "(?:founding|general|equity|senior|name|venture) partner",
      "board member",
      // General management / ownership / board in Spanish, Italian and German
      // (same job as "general manager"; seen on the hotel import).
      // Bare "direttore" and "amministratore" are whole-title only: qualified
      // forms ("direttore commerciale", "amministratore di sistema") name a
      // different job and must not be promoted.
      "directora? general",
      "consejer[oa] delegad[oa]",
      "directora? de hotel",
      "hotel manager",
      "^direttore$",
      "direttore generale",
      "direttrice generale",
      "proprietari[oa]",
      // Endings are the gender forms only (-in, -innen), with the word boundary
      // doing the rest, so "des Geschäftsführers" does not match. Anyone
      // supporting the manager (assistant, secretary, office manager) is not
      // the manager: the lookahead rejects the whole title.
      "(?<!(?:assistent|assistant|assistenz|sekret[äa]e?r|office manager)[^]*)(?!.*(?:assistent|assistant|assistenz|sekret[äa]e?r|office manager))(?:gesch(?:ä|ae)ftsf(?:ü|ue)hrer|hoteldirektor|hotelmanager|generaldirektor)(?:in|innen)?",
      // Bare "Direktor" is whole-title only, like "direttore": "Direktor
      // Vertrieb" names a different job.
      "^direktor(?:in)?$",
      "unternehmensinhaber\\w*",
      "inhaber\\w*",
      "^amministratore$",
      "amministratore (?:delegato|unico)",
      "(?:miembro|vocal) del consejo de administraci[oó]n",
      "(?:membro|membra) del consiglio di amministrazione",
      // Director-level finance = the CFO of a smaller company. Controllers
      // ("financial controller") are intentionally NOT listed: not C-level.
      "directora? financier[oa]",
      "directora? de finanzas",
      "directora? de administraci[oó]n y finanzas",
      "(?:finance|financial) director",
      "director of finance",
      "direttore finanziario",
      "direttrice finanziaria",
      "finanzdirektor\\w*",
      "directeur financier",
      "directrice financi[eè]re",
    ),
  ],
  [
    // A commercial qualifier before "development" makes it a sales title:
    // "Business Development Manager", "Broker Development Manager", "VP of
    // Global Business Development". It sits ahead of every engineering rule
    // because those match "vp", "development manager" and "development lead"
    // wherever they appear. Plain "Development Manager" has no qualifier and
    // stays engineering_manager. Spanish: "desarrollo de negocios/comercial".
    "sales_bd",
    w(
      "(?:business|broker|sales|partner|channel|market|client|customer|account) development",
      "business developer",
      "desarrollo (?:de negocios?|comercial)",
    ),
  ],
  [
    "eng_leadership",
    w(
      // A VP is engineering leadership only with an engineering domain anywhere
      // in the title; a bare "VP" says nothing about the function (VP Sales).
      // Non-engineering VPs fall to their function, or to the last rule.
      `(?:${VP})(?=.*${VP_DOMAIN})`,
      `(?<=${VP_DOMAIN}.*)(?:${VP})`,
      "head of (?:engineering|technology|software|tech|development|it|platform|data|infrastructure)",
      // The comma form ("Director, Software Engineering") is how LinkedIn
      // renders many US titles, and without it these fall through to developers.
      "(?:director|directora),?(?: of| de)? (?:engineering|software|technology|tecnolog[ií]a|it|ti|sistemas|desarrollo|ingenier[ií]a|platform|technical)",
      "engineering director",
      "engineering head",
      "technical director",
      "it director",
      "gerente de (?:tecnolog[ií]a|sistemas|desarrollo|it|ingenier[ií]a)",
      "jefe de (?:sistemas|tecnolog[ií]a|desarrollo|it)",
      // "TI" (tecnologias de la informacion) only inside a leadership title:
      // a bare "ti" would also match the pronoun and "Ti"-named companies.
      "(?:gerente|jefe|jefa)(?: de)? ti",
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
      // Discipline-prefixed managers ("SRE Manager", "QA Manager") are listed
      // explicitly rather than as a generic "<word> manager", which would
      // swallow sales, marketing and account managers.
      "(?:sre|qa|devops|data|platform|infrastructure|mobile|frontend|front-?end|backend|back-?end|cloud|security) manager",
      "l[ií]der de (?:equipo|desarrollo)",
    ),
  ],
  [
    "tech_lead_architect",
    w(
      "tech(?:nical)? lead(?:er)?",
      // "Engineering Lead" reads the same as "Lead Engineer" below; only the
      // second used to match.
      "(?:engineering|technology) lead(?:er)?",
      "team lead(?:er)?",
      "lead (?:software |backend |frontend |full ?stack )?(?:engineer|developer)",
      // "Lead" also appears as a suffix ("QA Lead", "Frontend Lead") and with
      // disciplines the prefix form never covered. Both were landing in
      // developers, which hid real technical decision-makers from outreach.
      "(?:qa|devops|sre|data|ai|ml|mobile|frontend|front-?end|backend|back-?end|full ?stack|software|development|automation|cloud|security|platform)(?: automation)? lead(?:er)?",
      "lead (?:ai|ml|machine learning|data|qa|devops|sre|cloud|security|mobile|platform)(?: \\w+)? (?:engineer|developer)",
      "(?:software|development) project lead(?:er)?",
      "architect",
      "arquitect[oa]",
      "l[ií]der t[eé]cnico",
      "staff (?:\\w+ )?engineer",
      "principal (?:\\w+ )?engineer",
    ),
  ],
  [
    "product",
    w(
      "product (?:manager|owner|lead|director|designer)",
      "head of product",
      "(?:vp|vice ?president),? (?:of )?product",
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
      "member of (?:the )?technical staff",
      // Software disciplines only. Bare "engineering" would pull in mechanical
      // and electrical engineering, which are not IT.
      "(?:data|software|machine learning|ml|ai|platform|security|cloud|devops|site reliability|forward deployed|solutions?|systems?|quality|test|infrastructure|mobile|frontend|backend|full ?stack|analytics|database|reliability) engineering",
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
    "hospitality_revenue",
    w(
      // Revenue / reservations / distribution owners at hotels. Sits right
      // before sales_bd so it beats sales_bd and operations, but never steals
      // from the groups above. Bare "reservas" is deliberately NOT a term:
      // it hits front-line "Agente de Reservas" and finance names such as
      // "Banco de Reservas". Bare "distribution manager" (logistics) and
      // "revenue operations" (SaaS) and "revenue assurance" (telecom audit)
      // are left out for the same reason. The "<head|director> of revenue"
      // form is an ALLOWLIST: it only matches at end of title, before a
      // separator or employer ("at"/"en"), or before a hotel qualifier
      // (distribution, reservations, channel, e-commerce). A denylist of SaaS
      // words (growth, cycle, enablement, ...) would leak every new one.
      "revenue manag\\w*",
      "(?:director|directora|head|jefe|jefa|gerente|responsable)(?: of| de)? revenue(?=\\s*(?:$|[-–—|(@]|(?:&|y|and|/)\\s*(?:distribution|distribuci[oó]n|reservations?|reservas|channel|e-?commerce)|(?:at|en)\\s))",
      "channel manager",
      "(?:online|digital|hotel|channel) distribution manager",
      "yield manager",
      "(?:booking|reservations?) manager",
      "(?:director|directora|head|jefe|jefa|gerente|responsable)(?: of| de) reserv(?:ations|as)",
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
  [
    "operations",
    w(
      "operations",
      "operaciones",
      "head of ops",
      // Hotel guest / event operations. Qualified forms only: bare "event" or
      // "guest" would sweep in photographers and speakers. This rule runs last,
      // so marketing/sales/HR event managers keep their earlier group.
      "guest (?:relations|experience|services)",
      "directora? de (?:alojamiento|ocio|entretenimiento|eventos)",
      "event (?:manager|director)",
      "director of events?",
    ),
  ],
  // Last resort: an executive "VP ..." whose function matched nothing above.
  ["c_level_business", w("vp", "svp", "evp", "vice ?president")],
];

// --- Head of the title -------------------------------------------------------
// The rules above are substring patterns, so any incidental word ("Partner" in a
// parenthetical, "Vice President" inside "Vice President of Engineering") used to
// win by list order. Classification therefore works on the title's STRUCTURE:
// parenthetical qualifiers and seniority words are dropped, and a leader-first
// title ("Manager, Field Engineering", "Director - Engineering") is rewritten to
// the "<domain> <leader>" form the rules already know. A VP or a partner only
// counts as such when the rules say so at the head (see the patterns above).

const SENIORITY = /(?<![\p{L}\p{N}_])(?:senior|sr\.?|global|associate|regional|interim)(?![\p{L}\p{N}_])/giu;
const BARE_LEADER = /^(?:manager|director|head|lead(?:er)?|vp|svp|evp|vice president)$/iu;
// A technical architecture reads as engineering for the leader-first rewrite, so "VP, Solution Architecture"
// lands in engineering rather than falling through to c_level_business. Qualified on purpose: a bare
// "architecture" would also swallow "Brand Architecture" and "Information Architecture" (design, not code).
const SOFTWARE_ENGINEERING =
  /engineering|software|ingenier[ií]a|(?:solutions?|software|enterprise|data|cloud|security|technical|systems?|platform) architecture/iu;
const NON_SOFTWARE_ENGINEERING = /mechanical|electrical|civil|chemical|industrial|manufacturing|structural|hardware|petroleum|aerospace|biomedical/iu;

function classifyText(text: string): RoleGroupKey {
  for (const [key, rx] of RULES) {
    if (rx.test(text)) return key;
  }
  return "other";
}

/** "Manager, Field Engineering" / "Director - Engineering" read as "<domain> <leader>". */
function invertLeaderFirst(segments: string[]): string | null {
  if (segments.length < 2 || !BARE_LEADER.test(segments[0])) return null;
  const rest = segments.slice(1);
  const software = rest.find((r) => SOFTWARE_ENGINEERING.test(r));
  if (software && NON_SOFTWARE_ENGINEERING.test(software)) return null;
  return `${software ? "engineering" : rest[0]} ${segments[0]}`;
}

/**
 * Classify a contact's `position` string into a role group.
 * Null/blank positions map to "no_position"; anything not matching any rule
 * falls back to "other".
 */
export function classifyPosition(position: string | null | undefined): RoleGroupKey {
  const p = position?.trim();
  if (!p) return "no_position";
  const cleaned = p.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(SENIORITY, " ").replace(/\s+/g, " ").trim();
  const segments = cleaned.split(/\s*(?:[,|]|\s[-–—]\s)\s*/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const inverted = invertLeaderFirst(segments);
  if (inverted) {
    const g = classifyText(inverted);
    if (g !== "other") return g;
  }
  return classifyText(cleaned);
}
