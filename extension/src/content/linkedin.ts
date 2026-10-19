/**
 * Content script on www.linkedin.com. Shows the CRM card on a profile page (`/in/<slug>/` only), keeps it in
 * step with LinkedIn's single-page navigation and refreshes it when the tab regains focus. It makes no network
 * request itself: every CRM call is a message to the service worker. It reads the profile page's text exactly
 * once per "Agregar al CRM" click (readProfileBasicsWhenLoaded) and never on load, navigation or in the background.
 */
import { profileUrlFromLocation } from "../shared/profileUrl";
import type { LookupResult, WorkerRequest } from "../shared/messages";
import { Card } from "./card";
import { readProfileBasicsWhenLoaded } from "./profileReader";
import { buildCardView, type CardState } from "./viewModel";

const COLLAPSED_KEY = "collapsed";

let profileUrl: string | null = null;
let state: CardState = { kind: "loading" };
let collapsed = false;
/** Generation whose profile "Agregar al CRM" is reading (waits for the lazy Experience section), else null. */
let readingGen: number | null = null;
/** Bumped on every profile change so a slow answer for the previous profile is dropped. */
let generation = 0;

async function ask(request: WorkerRequest): Promise<LookupResult> {
  try {
    return (await chrome.runtime.sendMessage(request)) as LookupResult;
  } catch {
    // e.g. the extension was updated and this script is orphaned: show the retry state instead of failing silently.
    return { kind: "error" };
  }
}

async function addToCrm(url: string): Promise<void> {
  if (readingGen === generation) return;
  const mine = generation;
  readingGen = mine;
  render();
  try {
    const basics = await readProfileBasicsWhenLoaded(document);
    if (mine === generation) await ask({ type: "open-add", profileUrl: url, basics });
  } catch {
    // Nothing to open; the button comes back so the BD can retry.
  } finally {
    if (readingGen === mine) readingGen = null;
    render();
  }
}

const card = new Card({
  onAction(kind) {
    if (!profileUrl) return;
    if (kind === "found" && state.kind === "found") void ask({ type: "open-view", personId: state.personId });
    // The one and only read of the page: the BD pressed "Agregar al CRM" on THIS profile.
    else if (kind === "not_found") void addToCrm(profileUrl);
    else if (kind === "signed_out") void ask({ type: "open-login" });
    else if (kind === "error") void refresh(false);
  },
  onCollapse: () => setCollapsed(true),
  onExpand: () => setCollapsed(false),
});

function render(): void {
  if (!profileUrl) return;
  card.render(buildCardView(state, readingGen === generation), collapsed);
}

function setCollapsed(value: boolean): void {
  collapsed = value;
  void chrome.storage.local.set({ [COLLAPSED_KEY]: value }).catch(() => undefined);
  render();
}

/** `silent` keeps the current card on screen while the answer is on its way (a refresh, not a new profile). */
async function refresh(silent: boolean): Promise<void> {
  const url = profileUrl;
  if (!url) return;
  const mine = generation;
  if (!silent) {
    state = { kind: "loading" };
    render();
  }
  const result = await ask({ type: "lookup", profileUrl: url, force: silent });
  if (mine !== generation) return;
  if (result.kind === "invalid") {
    card.unmount();
    return;
  }
  state = result;
  render();
}

function sync(): void {
  const next = profileUrlFromLocation(location);
  if (next === profileUrl) return;
  profileUrl = next;
  generation++;
  if (!next) {
    card.unmount();
    return;
  }
  void refresh(false);
}

function refreshOnFocus(): void {
  if (document.visibilityState === "visible" && profileUrl && state.kind !== "loading") void refresh(true);
}

async function start(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(COLLAPSED_KEY);
    collapsed = stored[COLLAPSED_KEY] === true;
  } catch {
    collapsed = false;
  }
  sync();
  // LinkedIn navigates without reloading. The Navigation API reports it; without it, a cheap URL check does.
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  if (navigation) navigation.addEventListener("currententrychange", sync);
  else setInterval(sync, 1000);
  window.addEventListener("popstate", sync);
  window.addEventListener("focus", refreshOnFocus);
  document.addEventListener("visibilitychange", refreshOnFocus);
}

void start();
