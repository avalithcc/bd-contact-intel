/**
 * Reads one tender's PUBLIC data from COMPR.AR's citizen view. No login, no credentials, no browser: three plain HTTP requests
 * that carry the site's own session cookie, the same thing anyone's browser does on the public search.
 *   1. GET  /BuscarAvanzado.aspx                       -> the WebForms hidden state
 *   2. POST the state + the process number             -> the results grid (its row target is read from the page)
 *   3. POST the state of step 2 + that row target      -> 302 to /PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=..., the citizen view
 * It never throws: every failure is an `error` outcome so one tender cannot fail a run. Nothing identifying the user or the
 * company is ever sent: a generic User-Agent and the portal's own cookie, and that is all.
 */
import { parseCitizenView, parseSearchPage, readFormState, type FormState, type PortalFields } from "@/lib/tenders/portalParse";

export const PORTAL_ORIGIN = "https://comprar.gob.ar";
const SEARCH_URL = `${PORTAL_ORIGIN}/BuscarAvanzado.aspx`;
export const PORTAL_USER_AGENT = "tender-monitor/1.0";
/** For the whole three-request exchange of ONE tender. */
export const PORTAL_TENDER_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;

export type PortalOutcome = { kind: "ok"; fields: PortalFields; portalUrl: string } | { kind: "not_found" } | { kind: "error"; message: string };

class PortalFetchError extends Error {}
const fail = (message: string): never => {
  throw new PortalFetchError(message);
};

interface Session {
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  cookies: Map<string, string>;
}

function storeCookies(session: Session, res: Response): void {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) session.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

/** One request, following redirects by hand so the host can be checked on every hop. A redirect after a POST becomes a GET. */
async function request(session: Session, url: string, form?: Record<string, string>): Promise<{ html: string; url: string }> {
  let current = url;
  let body = form ? new URLSearchParams(form).toString() : undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers: Record<string, string> = { "User-Agent": PORTAL_USER_AGENT, Accept: "text/html" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers.Referer = SEARCH_URL;
    }
    if (session.cookies.size > 0) headers.Cookie = [...session.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await session.fetchImpl(current, { method: body !== undefined ? "POST" : "GET", headers, body, redirect: "manual", signal: session.signal });
    storeCookies(session, res);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return fail("redirect_without_location");
      const next = new URL(location, current);
      if (next.origin !== PORTAL_ORIGIN) return fail("redirect_off_portal");
      current = next.toString();
      body = undefined;
      continue;
    }
    if (!res.ok) return fail(`http_${res.status}`);
    return { html: await res.text(), url: current };
  }
  return fail("too_many_redirects");
}

const postback = (state: FormState, target: string, fields: Record<string, string> = {}): Record<string, string> => ({
  __EVENTTARGET: target,
  __EVENTARGUMENT: "",
  __VIEWSTATE: state.viewState,
  __VIEWSTATEGENERATOR: state.viewStateGenerator,
  __EVENTVALIDATION: state.eventValidation,
  ...fields,
});

export async function fetchPortalProcess(processNumber: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<PortalOutcome> {
  const session: Session = { fetchImpl: opts.fetchImpl ?? fetch, signal: AbortSignal.timeout(opts.timeoutMs ?? PORTAL_TENDER_TIMEOUT_MS), cookies: new Map() };
  try {
    const first = await request(session, SEARCH_URL);
    const state1 = readFormState(first.html) ?? fail("no_form_state");

    const list = await request(session, SEARCH_URL, postback(state1, "ctl00$CPH1$btnListarPliegoNumero", { "ctl00$CPH1$txtNumeroProceso": processNumber }));
    const search = parseSearchPage(list.html);
    if (search.resultCount === 0) return { kind: "not_found" };
    if (search.resultCount === null || !search.rowTarget) return fail("unrecognised_search_page");
    const state2 = readFormState(list.html) ?? fail("no_form_state");

    const view = await request(session, SEARCH_URL, postback(state2, search.rowTarget));
    if (!view.url.includes("VistaPreviaPliegoCiudadano")) return fail("no_citizen_view");
    const parsed = parseCitizenView(view.html);
    if (!parsed.ok) return { kind: "error", message: parsed.reason };
    return { kind: "ok", fields: parsed.fields, portalUrl: view.url };
  } catch (err) {
    return { kind: "error", message: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}
