import type { RoleGroupKey } from "@/lib/roleGroups";
import { isMiamiArea, isOffshoreHub, type MarketKey } from "@/lib/hiring/markets";
import type { OpenPosting } from "@/lib/hiring/queries";
import type { Locale } from "@/lib/i18n/locales";

// Cap on how many open-role titles get fed into the prompt — a company with
// hundreds of postings would otherwise blow past a reasonable prompt size
// for no benefit; the model only needs a representative sample to summarize
// "what areas are they hiring for".
const MAX_TITLES = 40;

// Keyword check for "this company hires in Spain" — good enough to decide
// whether to mention the Madrid office at all (see messageRules below).
// Not a MarketKey bucket: Spain postings classify as "other" in
// src/lib/hiring/markets.ts, which has no Europe-specific rule (only
// LATAM/US/offshore-hub are modeled there).
const SPAIN_KEYWORDS = ["spain", "espana", "españa", "madrid", "barcelona"];
function mentionsSpain(location: string | null): boolean {
  if (!location) return false;
  const normalized = location
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return SPAIN_KEYWORDS.some((k) => normalized.includes(k.normalize("NFD").replace(/\p{Diacritic}/gu, "")));
}

// English labels for the model's own context only — this is a server-side
// prompt-engineering artifact, not user-facing UI copy, so it stays in
// English regardless of locale/persona (see the language contract on this
// change). The generated *message* itself is controlled separately by
// `locale` below.
const ROLE_GROUP_LABELS: Record<RoleGroupKey, string> = {
  c_level_tech: "C-level, technology (CTO/CIO/CDO/CPO)",
  c_level_business: "C-level, business (CEO/COO/founder)",
  eng_leadership: "Engineering leadership (VP/Director of Engineering)",
  engineering_manager: "Engineering manager",
  tech_lead_architect: "Tech lead / architect",
  product: "Product management",
  project_delivery: "Project/program delivery",
  developers: "Individual contributor developer",
  hr_recruiting: "HR / recruiting",
  sales_bd: "Sales / business development",
  operations: "Operations",
  other: "Other / unclassified role",
  no_position: "Unknown position",
};

const AVALITH_PROFILE = `
Avalith — company facts (do not add, embellish, or invent beyond this list):
- Software engineering company, founded in 2011.
- Positioning: "human-led, AI-accelerated delivery" — senior engineers design and spec the work; AI agents implement it under human direction.
- Services: Staff Augmentation (pre-vetted senior engineers embedded within days), Dedicated Teams (multi-role squads with a technical program manager), Turnkey product delivery, Product Discovery, US Placements, AI MVPs.
- 2,000+ pre-vetted developers.
- Offices in Mar del Plata (Argentina), Miami (US), Madrid (Spain), and Quito (Ecuador).
- Works in US-aligned timezones with small, senior teams.
- Public clients: Mercado Libre, Accenture, CookUnity, Global Hitss, GlobalLogic, Jampp, MODO, Ualá.
`.trim();

export interface OutreachMessageContact {
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  roleGroup: RoleGroupKey | null;
  isLeadership: boolean;
  connectedOn: string | null;
}

export interface OutreachMessageCompany {
  displayName: string;
  postings: OpenPosting[];
}

export interface BuildOutreachMessagePromptInput {
  contact: OutreachMessageContact;
  company: OutreachMessageCompany | null;
  senderName: string;
  senderTitle?: string;
  locale: Locale;
}

export interface OutreachMessagePrompt {
  system: string;
  prompt: string;
}

function summarizeHiring(company: OutreachMessageCompany | null): string {
  if (!company || company.postings.length === 0) {
    return [
      `Company: ${company?.displayName ?? "unknown"}`,
      "No open IT job posting data is available for this company right now.",
      "Do NOT invent or guess any open role, area, or headcount. Write a generic message about how Avalith could help their engineering org, without referencing specific open roles.",
    ].join("\n");
  }

  const sample = company.postings.slice(0, MAX_TITLES);
  const titles = sample.map((p) => p.title);
  const marketCounts = new Map<MarketKey, number>();
  const locations = new Set<string>();
  let miamiCount = 0;
  let offshoreCount = 0;
  let spain = false;
  for (const p of company.postings) {
    marketCounts.set(p.market, (marketCounts.get(p.market) ?? 0) + 1);
    if (p.location) locations.add(p.location);
    if (isMiamiArea(p.location)) miamiCount++;
    if (isOffshoreHub(p.location)) offshoreCount++;
    if (mentionsSpain(p.location)) spain = true;
  }

  const lines = [
    `Company: ${company.displayName}`,
    `Total open IT postings: ${company.postings.length}`,
    `Postings by market bucket: ${[...marketCounts.entries()]
      .map(([market, count]) => `${market}=${count}`)
      .join(", ")}`,
    `Sample locations (not exhaustive): ${[...locations].slice(0, 25).join("; ") || "not specified"}`,
    miamiCount > 0 ? `Of these, ${miamiCount} are in Florida/Miami.` : null,
    offshoreCount > 0 ? `Of these, ${offshoreCount} are in an offshore delivery hub (e.g. India, Philippines, Vietnam).` : null,
    spain ? "This company has open postings in Spain." : "This company has NO open postings in Spain — do not mention the Madrid office.",
    `Sample open role titles, up to ${MAX_TITLES} of ${company.postings.length} total: ${titles.join(" | ")}`,
  ].filter((l): l is string => l !== null);

  return lines.join("\n");
}

/**
 * Builds the system + user prompt for generating a single LinkedIn outreach
 * DM from Cristian (or the signed-in BD) to one contact, grounded only in
 * real data: the contact's own profile fields, their company's real open IT
 * postings (see getCompanyPostingsForKey in src/lib/hiring/queries.ts), and
 * a fixed Avalith company profile. Never touches the database itself — pure
 * string building, called from the "use server" action in
 * src/app/outreach/actions.ts so it stays independently testable.
 */
export function buildOutreachMessagePrompt(
  input: BuildOutreachMessagePromptInput,
): OutreachMessagePrompt {
  const { contact, company, senderName, senderTitle, locale } = input;
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "the contact";
  const firstName = contact.firstName || fullName;
  const roleLabel = contact.roleGroup ? ROLE_GROUP_LABELS[contact.roleGroup] : "unknown";
  const signOff = senderTitle ? `${senderName}, ${senderTitle}` : senderName;
  const writeInSpanish = locale !== "en";

  const system = `
You write short, natural, peer-to-peer LinkedIn outreach messages on behalf of a Business Developer at Avalith, a software engineering company. Follow these rules exactly:

1. Length: roughly 120-170 words. One short paragraph or two at most — this is a DM, not an email.
2. Language and tone: ${
    writeInSpanish
      ? "Write in Spanish, Rioplatense tone (voseo is fine, e.g. \"vos\", \"¿cómo va?\", \"te copa\"), since the sender and the contact are both Argentine. Keep it natural and informal but professional — a peer writing to a peer, not a cold sales pitch."
      : "Write in natural, professional English, warm but not overly casual — a peer writing to a peer, not a cold sales pitch."
  }
3. Open with the company's real hiring pain, derived ONLY from the open postings data given below (top areas being hired for, and where — LATAM, US, or elsewhere). If no posting data is given, skip this and speak generally instead.
4. Explain briefly how Avalith helps: Staff Augmentation or a Dedicated Team, engineers in US-aligned timezones, senior-only. Use ONLY the facts listed under "Avalith — company facts" below — never invent a client, a number, or a capability not listed there.
5. Position Avalith as a COMPLEMENT to their hiring, never as competing with their recruiting team: something that helps "while those roles get filled", or to take on a specific workstream with a dedicated squad. Never suggest replacing their hiring process.
6. If the postings data shows the company does NOT hire in LATAM, do not pitch "placement" — pitch staff augmentation or a dedicated team instead (the value is senior engineering capacity, not candidate placement).
7. Only mention the Madrid office if the postings data explicitly says the company hires in Spain. Only mention the Miami office if it is relevant (e.g. the company hires in Florida/Miami, or in the US generally).
8. Adapt the closing ask to the contact's seniority: if they ARE a decision-maker (leadership role), propose a 20-minute call directly. If they are NOT a clear decision-maker, ask for their perspective or an intro to whoever manages engineering capacity, low-pressure, and still offer the 20-minute call as an option.
9. Never invent facts, numbers, client names, or specific projects beyond what is given below. If information is missing, write around it generically rather than guessing.
10. Sign off with the sender's name only: "${signOff}". Do not add a generic closing line like "Saludos" beyond the name itself if the reference style doesn't need it.
11. Return ONLY the message text — no preamble, no explanation, no markdown, no quotation marks around it.

Avalith — company facts (do not add, embellish, or invent beyond this list):
${AVALITH_PROFILE}

Reference style (do not copy verbatim, this is a tone example only, in Spanish):
"Hola Gonzalo, ¿cómo va? Soy Cristian Civita, COO de Avalith. Estuve mirando las búsquedas de Affirm y vi que están sumando bastante gente senior de backend en Card, Fraud, Identity y Payments, casi todo remoto en US y Europa. Te escribo porque es justo lo que hacemos: desde 2011 armamos equipos chicos de ingenieros senior, con horario alineado a US, que se integran al equipo del cliente en pocos días. Trabajamos con fintechs como Ualá, MODO y Mercado Libre. No es para reemplazar sus búsquedas. La idea es darles capacidad senior rápido mientras esos roles se cubren, o tomar un frente puntual con un squad dedicado. ¿Te copa charlar 20 minutos la semana que viene? Me sirve mucho tu mirada sobre cómo manejan la capacidad de ingeniería, aunque no sea algo que decidas vos."
`.trim();

  const prompt = `
Write the LinkedIn DM now, using only the facts below.

Contact:
- First name: ${firstName}
- Full name: ${fullName}
- Position: ${contact.position ?? "unknown"}
- Seniority/role group: ${roleLabel}
- Is a likely decision-maker for engineering capacity: ${contact.isLeadership ? "yes" : "no"}
- LinkedIn connection date: ${contact.connectedOn ?? "unknown"}

Company hiring signal:
${summarizeHiring(company)}
`.trim();

  return { system, prompt };
}
