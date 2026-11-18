/**
 * The subject-line rules for outreach emails, in ONE place, used both to write the prompt (messagePrompt.ts) and to
 * CHECK what the model returned (generateMessage.ts). That pairing is the point of this module.
 *
 * Why it exists: the subject rule already told the model, in writing, never to use vendor vocabulary like "capacidad
 * senior", and the comment above SUBJECT_RULE records that a previous rewrite was meant to fix exactly that. A read of
 * production on 2026-11-16 found 10 of the last 25 live subjects still built on "capacidad ... senior", one subject of
 * 72 characters against a stated ceiling of 60, and three addressed "para Avalith" — selling to ourselves. The rule was
 * stated and never enforced, so it was followed when convenient.
 *
 * The lesson this encodes: a prompt instruction is a request, not a constraint. Anything that must hold about the
 * output has to be checked after generation, and the check has to read from the same constant the prompt was written
 * from, or the two drift apart silently.
 */

/** The rule's own ceiling, separate from `MAX_SUBJECT_CHARS` in emailOutputParsing.ts, which is a 150-char anti-abuse
 * cap on anything reaching the UI. This is the editorial limit a subject must satisfy to be accepted. */
export const SUBJECT_MAX_CHARS = 60;
/** The shape the rule asks for. Under this is not rejected — a short, concrete subject is fine — but it is reported. */
export const SUBJECT_TARGET_MIN_CHARS = 35;

/**
 * Vendor vocabulary, exactly as the prompt lists it. The prompt text below is BUILT from this array, so adding a term
 * here adds it to what the model is told and to what is enforced, in one edit.
 */
// "oportunidad" and "opportunity" were both removed on 2026-11-18 by the owner. The Spanish one sat on this list while
// his own call to action - pinned as approved verbatim by messagePromptRegister.test.ts - used it, so the prompt asked
// for a word the checker rejected; he chose the list, not the sentence. The English twin followed on the same call, so
// the two languages stay symmetric: the pairs here (soluciones/solutions, propuesta/proposal, servicios/services) are
// meant to ban a CONCEPT, and banning it in one language only would reject an English draft for what a Spanish one may
// say. Neither word appeared in any live subject or body when they were removed.
export const SUBJECT_BANNED_PHRASES = [
  "capacidad senior",
  "staff augmentation",
  "squads",
  "nearshore",
  "soluciones",
  "propuesta",
  "servicios",
  "senior capacity",
  "solutions",
  "proposal",
  "services",
] as const;

/**
 * The failure mode a plain substring check misses. Four of the live offenders read "Capacidad DE INGENIERÍA senior",
 * which does not contain the bigram "capacidad senior" at all — the two words are simply separated. So the pair is
 * checked as co-occurrence anywhere in the subject, in both languages.
 */
const BANNED_WORD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["capacidad", "senior"],
  ["capacity", "senior"],
];

export type SubjectViolation =
  | { kind: "banned_phrase"; term: string }
  | { kind: "banned_word_pair"; terms: [string, string] }
  | { kind: "too_long"; length: number; max: number }
  | { kind: "names_avalith" }
  | { kind: "names_sender" }
  // The owner's choice: the subject is a neutral FRAGMENT naming what they are hiring for, not a question.
  | { kind: "asks_a_question" }
  // The headline form: the recipient's company as the subject of a verb, so the subject reads as a news bulletin ABOUT
  // them instead of a line written TO them. Reported as "Getnet abre backend y Salesforce en LATAM y España", which is
  // the first shape example ("Affirm suma backend en Card y Fraud") copied with another verb - the model copies shapes.
  | { kind: "company_headline"; company: string };

/** Lowercased and accent-stripped, so "ingeniería" and "ingenieria" are the same string to every check below. */
export function normalizeSubject(subject: string): string {
  return subject
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function containsWord(haystack: string, word: string): boolean {
  // Unicode-aware boundaries: JS \b treats only ASCII as word characters, so it misplaces boundaries around accented
  // letters. The haystack is already accent-stripped, but the guard is kept so a future non-normalized caller is safe.
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${word}($|[^\\p{L}\\p{N}_])`, "u").test(haystack);
}

/**
 * Everything that must hold about a subject before it is worth showing a BD.
 *
 * `senderName` is checked because the rule forbids naming the sender, and "Avalith" because of the defect recorded in
 * messagePrompt.ts: a missing company placeholder once made the model address Avalith as the recipient, and four of
 * those emails were sent. A subject reading "para Avalith" is that bug surfacing, so it is rejected outright.
 */
export function validateSubject(subject: string, opts: { senderName?: string | null; companyName?: string | null } = {}): SubjectViolation[] {
  const violations: SubjectViolation[] = [];
  const normalized = normalizeSubject(subject);

  for (const term of SUBJECT_BANNED_PHRASES) {
    if (normalized.includes(normalizeSubject(term))) violations.push({ kind: "banned_phrase", term });
  }

  for (const [a, b] of BANNED_WORD_PAIRS) {
    if (containsWord(normalized, a) && containsWord(normalized, b)) {
      // Already reported as the exact phrase; do not count the same text twice.
      if (!violations.some((v) => v.kind === "banned_phrase" && normalizeSubject(v.term) === `${a} ${b}`)) {
        violations.push({ kind: "banned_word_pair", terms: [a, b] });
      }
    }
  }

  if (subject.length > SUBJECT_MAX_CHARS) {
    violations.push({ kind: "too_long", length: subject.length, max: SUBJECT_MAX_CHARS });
  }

  if (containsWord(normalized, "avalith")) violations.push({ kind: "names_avalith" });

  const sender = opts.senderName?.trim();
  if (sender) {
    const firstName = normalizeSubject(sender.split(/\s+/)[0] ?? "");
    if (firstName.length > 2 && containsWord(normalized, firstName)) violations.push({ kind: "names_sender" });
  }

  if (subject.includes("?") || subject.includes("\u00bf")) violations.push({ kind: "asks_a_question" });
  // High precision on purpose: a company name followed by punctuation or a connector is fine ("Flybondi: una pregunta
  // sobre ingenieria", "Plataforma 10 y el equipo de ingenieria"), because neither makes the company act. Only a BARE
  // word after it turns the line into a headline. Grammar is not regex-detectable in general; this catches the one
  // shape that was actually produced, and rejects nothing that exists today.
  const company = opts.companyName?.trim();
  if (company && company.length > 2) {
    const head = normalizeSubject(subject);
    const name = normalizeSubject(company);
    if (head.startsWith(name)) {
      const rest = head.slice(name.length).trimStart();
      const next = rest.split(/\s+/)[0] ?? "";
      const connector = next === "" || /^[:,\u2013\u2014-]/.test(rest) || ["y", "e", "and", "en", "in", "de", "of", "para", "for"].includes(next);
      if (!connector) violations.push({ kind: "company_headline", company });
    }
  }
  return violations;
}

/**
 * The banned vendor vocabulary found in an email BODY (the compliance footer already stripped by the caller), in list order.
 *
 * Same list as the subject, so the two cannot drift. Matched as whole words, unlike the subject's substring test: a body is
 * long prose from an engineering-staffing company, and "microservices" must not be refused for containing "services".
 * The capacidad/senior co-occurrence is NOT applied here for the same reason: across a whole body the two words
 * legitimately appear far apart.
 */
export function bannedTermsInBody(text: string): string[] {
  const normalized = normalizeSubject(text);
  return SUBJECT_BANNED_PHRASES.filter((term) => containsWord(normalized, normalizeSubject(term)));
}

/** One line per violation, appended to a retry so the model is told what it broke rather than asked again blindly. */
export function describeViolations(violations: readonly SubjectViolation[]): string {
  return violations
    .map((v) => {
      switch (v.kind) {
        case "banned_phrase":
          return `it used the banned vendor term "${v.term}"`;
        case "banned_word_pair":
          return `it used "${v.terms[0]}" and "${v.terms[1]}" together, which is the same vendor framing written apart`;
        case "too_long":
          return `it was ${v.length} characters, over the hard maximum of ${v.max}`;
        case "names_avalith":
          return "it named Avalith, which the subject must never do";
        case "asks_a_question":
          return "it was a question; the subject must be a neutral fragment naming what they are hiring for, with no question mark";
        case "company_headline":
          return `it started with "${v.company}" followed by a verb, which reads as a news headline about them instead of a line written to them`;
        case "names_sender":
          return "it named the sender, which the subject must never do";
      }
    })
    .join("; ");
}

/** The banned-vocabulary line of the prompt, generated from the same array the validator reads. */
export function bannedVocabularyPromptLine(): string {
  const quoted = SUBJECT_BANNED_PHRASES.map((t) => `"${t}"`).join(", ");
  return `Never use vendor vocabulary: ${quoted}. This also covers the same words written apart — "capacidad de ingeniería senior" is as forbidden as "capacidad senior". A subject or a body containing any of them is rejected and regenerated, so it costs you a retry.`;
}

const REPLY_PREFIX = /^re:\s*/i;

/**
 * The subject of a step 2 reminder: step 1's subject behind a single "Re: ". A reminder is always sent threaded onto step 1,
 * so it inherits the subject instead of getting a generated one (the model's own step 2 subjects drifted, and one named
 * Avalith as the recipient). Idempotent: an existing reply prefix in any case, with or without the space, is normalized
 * rather than doubled. Deliberately NOT truncated to SUBJECT_MAX_CHARS: the inherited text is already compliant and a reply
 * prefix must never cut it.
 */
export function reminderSubject(step1Subject: string): string {
  const base = step1Subject.trim().replace(REPLY_PREFIX, "").trim();
  return `Re: ${base}`;
}
