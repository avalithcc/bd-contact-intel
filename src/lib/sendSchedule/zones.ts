/**
 * The visual time-zone reference of the schedule popover. It states one instant in other clocks and warns when the
 * recipient's local time is outside working hours; it never changes when an email leaves and persists nothing.
 *
 * The data has no time zone, only person.city / region / country (and company.country), so a recipient's zone is a
 * best guess: one default zone per country, refined by a small city table and, for the United States, a short state
 * table. A guess for a country that spans several zones is flagged `approx` ("aprox." in the UI). Zones are IANA ids
 * read through Intl.DateTimeFormat for the INSTANT chosen, so daylight saving follows the chosen date, not today's.
 */
import { slotOf, type Slot } from "./time";

export interface RecipientPlace {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

export interface RecipientZone {
  zone: string;
  approx: boolean;
  /** "Tampa, EE. UU." — for a single recipient. */
  place: string;
  /** "Florida" or "México" — for a group of recipients. */
  area: string;
  /** Country key; recipients of one country share a row when several are approved together. */
  group: string;
}

type Country = { key: string; es: string; zone: string; approx?: boolean; names: string };
// `names` are normalized aliases (lowercase, no accents, punctuation as spaces), pipe separated.
const COUNTRIES: Country[] = [
  { key: "ar", es: "Argentina", zone: "America/Argentina/Buenos_Aires", names: "argentina" },
  { key: "uy", es: "Uruguay", zone: "America/Montevideo", names: "uruguay" },
  { key: "cl", es: "Chile", zone: "America/Santiago", names: "chile" },
  { key: "co", es: "Colombia", zone: "America/Bogota", names: "colombia" },
  { key: "pe", es: "Perú", zone: "America/Lima", names: "peru" },
  { key: "ec", es: "Ecuador", zone: "America/Guayaquil", names: "ecuador" },
  { key: "ve", es: "Venezuela", zone: "America/Caracas", names: "venezuela" },
  { key: "bo", es: "Bolivia", zone: "America/La_Paz", names: "bolivia" },
  { key: "py", es: "Paraguay", zone: "America/Asuncion", names: "paraguay" },
  { key: "cr", es: "Costa Rica", zone: "America/Costa_Rica", names: "costa rica" },
  { key: "pa", es: "Panamá", zone: "America/Panama", names: "panama" },
  { key: "gt", es: "Guatemala", zone: "America/Guatemala", names: "guatemala" },
  { key: "do", es: "República Dominicana", zone: "America/Santo_Domingo", names: "republica dominicana|dominican republic" },
  { key: "mx", es: "México", zone: "America/Mexico_City", approx: true, names: "mexico" },
  { key: "br", es: "Brasil", zone: "America/Sao_Paulo", approx: true, names: "brasil|brazil" },
  { key: "ca", es: "Canadá", zone: "America/Toronto", approx: true, names: "canada" },
  { key: "us", es: "EE. UU.", zone: "America/New_York", approx: true, names: "us|usa|u s|u s a|united states|united states of america|estados unidos|ee uu|eeuu" },
  { key: "es", es: "España", zone: "Europe/Madrid", names: "espana|spain" },
  { key: "pt", es: "Portugal", zone: "Europe/Lisbon", names: "portugal" },
  { key: "gb", es: "Reino Unido", zone: "Europe/London", names: "reino unido|united kingdom|uk|great britain|england|inglaterra" },
  { key: "ie", es: "Irlanda", zone: "Europe/Dublin", names: "irlanda|ireland" },
  { key: "fr", es: "Francia", zone: "Europe/Paris", names: "francia|france" },
  { key: "de", es: "Alemania", zone: "Europe/Berlin", names: "alemania|germany" },
  { key: "it", es: "Italia", zone: "Europe/Rome", names: "italia|italy" },
  { key: "nl", es: "Países Bajos", zone: "Europe/Amsterdam", names: "paises bajos|netherlands|holanda" },
];

// City -> zone for the countries that span several. Normalized, pipe separated.
const CITY_ZONES: Record<string, Record<string, string>> = {
  mx: {
    "America/Mexico_City": "ciudad de mexico|mexico city|cdmx|guadalajara|monterrey|puebla|queretaro|merida|leon|toluca|san luis potosi",
    "America/Tijuana": "tijuana|mexicali|ensenada",
    "America/Cancun": "cancun|playa del carmen",
  },
  br: {
    "America/Sao_Paulo": "sao paulo|rio de janeiro|brasilia|belo horizonte|curitiba|porto alegre|salvador|recife|campinas",
    "America/Manaus": "manaus",
  },
  ca: {
    "America/Toronto": "toronto|ottawa|montreal|quebec",
    "America/Vancouver": "vancouver|victoria",
    "America/Edmonton": "calgary|edmonton",
    "America/Winnipeg": "winnipeg",
  },
  us: {
    "America/New_York": "miami|tampa|orlando|jacksonville|atlanta|new york|boston|philadelphia|washington dc|charlotte|raleigh|detroit|pittsburgh|columbus|cleveland",
    "America/Chicago": "chicago|dallas|houston|austin|san antonio|minneapolis|st louis|nashville|new orleans|kansas city|milwaukee",
    "America/Denver": "denver|salt lake city|albuquerque|boise",
    "America/Phoenix": "phoenix|tucson",
    "America/Los_Angeles": "los angeles|san francisco|san diego|san jose|seattle|portland|las vegas|sacramento",
  },
};

// US states by zone, "Name,AB" pairs: a short table, enough for a visual reference.
const US_STATES: Record<string, string> = {
  "America/New_York": "Florida,FL;Georgia,GA;New York,NY;New Jersey,NJ;Massachusetts,MA;Pennsylvania,PA;North Carolina,NC;South Carolina,SC;Virginia,VA;Ohio,OH;Michigan,MI;Connecticut,CT;Maryland,MD;Delaware,DE;Maine,ME;New Hampshire,NH;Vermont,VT;Rhode Island,RI;West Virginia,WV;Indiana,IN",
  "America/Chicago": "Texas,TX;Illinois,IL;Minnesota,MN;Wisconsin,WI;Missouri,MO;Louisiana,LA;Alabama,AL;Mississippi,MS;Oklahoma,OK;Arkansas,AR;Iowa,IA;Kansas,KS;Nebraska,NE;Tennessee,TN;Kentucky,KY",
  "America/Denver": "Colorado,CO;Utah,UT;New Mexico,NM;Montana,MT;Wyoming,WY;Idaho,ID",
  "America/Phoenix": "Arizona,AZ",
  "America/Los_Angeles": "California,CA;Washington,WA;Oregon,OR;Nevada,NV",
  "America/Anchorage": "Alaska,AK",
  "Pacific/Honolulu": "Hawaii,HI",
};

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hasName = (list: string, name: string) => list.split("|").includes(name);

function usState(region: string): { name: string; zone: string } | null {
  const wanted = normalize(region);
  for (const [zone, pairs] of Object.entries(US_STATES)) {
    for (const pair of pairs.split(";")) {
      const [name, abbr] = pair.split(",");
      if (normalize(name!) === wanted || normalize(abbr!) === wanted) return { name: name!, zone };
    }
  }
  return null;
}

/** Best guess of where a recipient is. Null when there is no usable country (the row is then left out). */
export function resolveRecipientZone(p: RecipientPlace): RecipientZone | null {
  const country = p.country?.trim() ? normalize(p.country) : "";
  const entry = COUNTRIES.find((c) => hasName(c.names, country));
  if (!entry) return null;
  const city = p.city?.trim() ? normalize(p.city) : "";
  const label = (head: string | null | undefined) => [head?.trim(), entry.es].filter(Boolean).join(", ");
  let zone = entry.zone;
  let approx = entry.approx === true;
  let area = entry.es;
  const state = entry.key === "us" && p.region?.trim() ? usState(p.region) : null;
  if (state) {
    zone = state.zone;
    approx = false;
    area = state.name;
  } else {
    const byCity = city ? Object.entries(CITY_ZONES[entry.key] ?? {}).find(([, cities]) => hasName(cities, city)) : undefined;
    if (byCity) {
      zone = byCity[0];
      approx = false;
    }
  }
  return { zone, approx, place: label(p.city?.trim() || p.region?.trim()), area, group: entry.key };
}

/** "9:00": the clock an instant reads in `zone`. */
export const zoneClock = (instant: Date, zone: string): string => local(instant, zone).clock;

export type ZoneKey = "argentina" | "recipient" | "recipients" | "newYork" | "madrid" | "mexicoCity" | "bogota" | "saoPaulo";
export interface ZoneRow {
  key: ZoneKey;
  zone: string;
  /** Local clocks, "9:00". More than one when a group of recipients spans several zones of one country. */
  clocks: string[];
  /** The local calendar day relative to Argentina's: -1, 0 or +1. */
  dayShift: -1 | 0 | 1;
  /** Recipient rows only: the local time is before 9:00 or on a Saturday/Sunday (see localAdvisory). */
  warn: boolean;
  approx: boolean;
  count: number;
  areas: string[];
  group?: string;
}

const ARGENTINA = "America/Argentina/Buenos_Aires";
const FIXED: { key: ZoneKey; zone: string }[] = [
  { key: "newYork", zone: "America/New_York" },
  { key: "madrid", zone: "Europe/Madrid" },
  { key: "mexicoCity", zone: "America/Mexico_City" },
  { key: "bogota", zone: "America/Bogota" },
  { key: "saoPaulo", zone: "America/Sao_Paulo" },
];
const BUSINESS_START = 9 * 60;

function local(instant: Date, zone: string): { date: string; minutes: number; clock: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + minute, clock: `${hour}:${parts.minute}` };
}

const shiftOf = (instant: Date, zone: string): -1 | 0 | 1 => {
  const day = local(instant, zone).date;
  const base = local(instant, ARGENTINA).date;
  return day === base ? 0 : day > base ? 1 : -1;
};

function row(instant: Date, key: ZoneKey, zone: string, extra: Partial<ZoneRow> = {}): ZoneRow {
  const l = local(instant, zone);
  return { key, zone, clocks: [l.clock], dayShift: shiftOf(instant, zone), warn: false, approx: false, count: 1, areas: [], ...extra };
}

const fixedRows = (instant: Date, taken: ReadonlySet<string>) => FIXED.filter((f) => !taken.has(f.zone)).map((f) => row(instant, f.key, f.zone));

/** Argentina (the base), the recipient's own clock when known, then the fixed references minus any that repeat it. */
export function buildZoneRows(instant: Date, recipient: RecipientZone | null): ZoneRow[] {
  const rows = [row(instant, "argentina", ARGENTINA)];
  if (recipient) rows.push(row(instant, "recipient", recipient.zone, { warn: localAdvisory(instant, recipient.zone) !== null, approx: recipient.approx, areas: [recipient.area], group: recipient.group }));
  return [...rows, ...fixedRows(instant, new Set(recipient ? [recipient.zone] : []))];
}

/** Several recipients (approve in bulk): one row per country with the distinct local clocks and how many people. */
export function buildGroupRows(instant: Date, recipients: readonly RecipientZone[]): ZoneRow[] {
  const byGroup = new Map<string, RecipientZone[]>();
  for (const r of recipients) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  const rows = [...byGroup.entries()].map(([group, members]) => {
    const zones = [...new Set(members.map((m) => m.zone))];
    const clocks = zones.map((z) => local(instant, z));
    return row(instant, "recipients", zones[0]!, {
      clocks: clocks.map((c) => c.clock),
      warn: zones.some((z) => localAdvisory(instant, z) !== null),
      approx: members.some((m) => m.approx),
      count: members.length,
      areas: [...new Set(members.map((m) => m.area))],
      group,
    });
  });
  const taken = new Set(recipients.map((r) => r.zone));
  return [row(instant, "argentina", ARGENTINA), ...rows, ...fixedRows(instant, taken)];
}

export interface LocalAdvisory {
  early: boolean;
  weekend: boolean;
  /** Local weekday, 0 = Sunday. */
  weekday: number;
  clock: string;
}

const weekdayOfDate = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The disclaimer, in the ZONE given (the recipient's, or Miami for an unknown Sequence recipient): before 9:00 and/or Saturday or Sunday. */
export function localAdvisory(instant: Date, zone: string): LocalAdvisory | null {
  const l = local(instant, zone);
  const weekday = weekdayOfDate(l.date);
  const early = l.minutes < BUSINESS_START;
  const weekend = weekday === 0 || weekday === 6;
  return early || weekend ? { early, weekend, weekday, clock: l.clock } : null;
}

/** Offset of `zone` from UTC at an instant, in ms. */
function offsetMs(instant: Date, zone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(instant)
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** 9:00 wall clock of a local calendar date in `zone`, as an instant (a second pass settles the daylight-saving edge). */
function nineAmIn(zone: string, date: string): Date {
  const guess = Date.parse(`${date}T09:00:00Z`);
  const first = guess - offsetMs(new Date(guess), zone);
  return new Date(guess - offsetMs(new Date(first), zone));
}

/**
 * The "Usar <próximo día hábil> 9:00" button: 9:00 recipient time on the same local day when the problem is only the
 * hour, on the next Monday when it is a weekend. Null when there is nothing to fix. The slot is in Argentina time.
 */
export function suggestBusinessDay(instant: Date, zone: string): { slot: Slot; weekday: number; localClock: string } | null {
  const advisory = localAdvisory(instant, zone);
  if (!advisory) return null;
  const today = local(instant, zone).date;
  const ahead = advisory.weekday === 6 ? 2 : advisory.weekday === 0 ? 1 : 0;
  const day = new Date(Date.parse(`${today}T00:00:00Z`) + ahead * 86_400_000).toISOString().slice(0, 10);
  return { slot: slotOf(nineAmIn(zone, day)), weekday: weekdayOfDate(day), localClock: "9:00" };
}
