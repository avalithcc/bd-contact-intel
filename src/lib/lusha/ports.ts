// Wires the reveal orchestration to the real DB, the real gate and the Lusha client. The environment and the
// fetch implementation are arguments, so a test can run the whole path against a scratch database with a fake
// fetch and never reach the network. With the gate closed the key is empty and nothing here can be called.

import { assertContactEditableById } from "@/lib/contacts/queries";
import { isLushaEnabled } from "./adminDb";
import { getAccountUsage, enrichContact, searchContact, type FetchFn } from "./client";
import { getDailyCreditCap } from "./cap";
import { getLushaConfig } from "./config";
import type { RevealPorts } from "./reveal";
import { failReservation, getDailySpend, getRevealState, loadRevealSubject, rejectMatch, reserve, settleReveal, settleSearch } from "./revealDb";

export function livePorts(env: Record<string, string | undefined> = process.env, fetchFn: FetchFn = (url, init) => fetch(url, init)): RevealPorts {
  const config = getLushaConfig(env);
  const key = config.ok ? config.config.apiKey : "";
  return {
    config,
    cap: getDailyCreditCap(env),
    isLushaEnabled: (bdId) => isLushaEnabled(bdId),
    assertEditable: assertContactEditableById,
    loadSubject: (id) => loadRevealSubject(id),
    getRevealState: (id) => getRevealState(id),
    getDailySpend: () => getDailySpend(),
    reserve: (i) => reserve(i),
    settleSearch: (i) => settleSearch(i),
    settleReveal: (i) => settleReveal(i),
    failReservation: (id, code, payload) => failReservation(id, code, payload),
    rejectMatch: (id, bd) => rejectMatch(id, bd),
    searchContact: (i) => searchContact(key, fetchFn, i),
    enrichContact: (id, field) => enrichContact(key, fetchFn, id, field),
    getAccountUsage: () => getAccountUsage(key, fetchFn),
  };
}
