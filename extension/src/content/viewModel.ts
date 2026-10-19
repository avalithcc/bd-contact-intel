/**
 * Card state to what the card shows (copy from the mockup). Pure: the DOM rendering in card.ts only turns this
 * structure into elements, so the states can be tested without a browser.
 */
import { avatarPaletteClass } from "../../../src/components/avatarPalette";
import { initialsFromName } from "../../../src/components/initials";
import type { FoundPerson } from "../shared/messages";
import { STRINGS as S } from "../shared/strings";

export type CardState =
  | { kind: "loading" }
  | FoundPerson
  | { kind: "not_found" }
  | { kind: "signed_out" }
  | { kind: "error" };

export type BodyView =
  | { kind: "loading"; message: string }
  | {
      kind: "found";
      initials: string;
      avatarClass: string;
      name: string;
      subtitle: string;
      ownerName: string | null;
      ownerInitials: string;
      ownerAvatarClass: string;
      lastActivity: string | null;
      actionLabel: string;
      help: string;
    }
  | { kind: "not_found"; badge: string; message: string; actionLabel: string; actionBusy: boolean; help: string }
  | { kind: "signed_out"; message: string; actionLabel: string; help: string }
  | { kind: "error"; message: string; actionLabel: string };

export interface CardView {
  badge: { tone: "success"; text: string } | null;
  pill: { label: string; ariaLabel: string; dot: "success" | "neutral" | null };
  busy: boolean;
  body: BodyView;
}

const ACTIVITY_DATE = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** "15 oct 2026 · Llamada". The CRM works in Argentina time. */
export function formatActivity(activity: { label: string; date: string }): string {
  // Composed from parts: the locale's own pattern adds "de" between the pieces ("15 de oct de 2026").
  const part = (type: string) =>
    ACTIVITY_DATE.formatToParts(new Date(activity.date)).find((p) => p.type === type)?.value.replace(/\./g, "") ?? "";
  return `${part("day")} ${part("month")} ${part("year")} · ${activity.label}`;
}

/** `reading`: the profile is being read for "Agregar al CRM" (the lazy Experience section may take a moment). */
export function buildCardView(state: CardState, reading = false): CardView {
  switch (state.kind) {
    case "loading":
      return {
        badge: null,
        pill: { label: S.searching, ariaLabel: S.pillSearching, dot: null },
        busy: true,
        body: { kind: "loading", message: S.searchingLong },
      };
    case "found":
      return {
        badge: { tone: "success", text: S.inCrm },
        pill: { label: S.inCrm, ariaLabel: S.pillFound(state.name), dot: "success" },
        busy: false,
        body: {
          kind: "found",
          initials: initialsFromName(state.name),
          avatarClass: avatarPaletteClass(state.personId),
          name: state.name,
          subtitle: [state.jobTitle, state.company].filter(Boolean).join(" · "),
          ownerName: state.ownerName,
          ownerInitials: initialsFromName(state.ownerName ?? ""),
          ownerAvatarClass: avatarPaletteClass(state.ownerName ?? "-"),
          lastActivity: state.lastActivity ? formatActivity(state.lastActivity) : null,
          actionLabel: S.viewInCrm,
          help: S.viewHelp,
        },
      };
    case "not_found":
      return {
        badge: null,
        pill: { label: S.notInCrm, ariaLabel: S.pillNotFound, dot: "neutral" },
        busy: false,
        body: {
          kind: "not_found",
          badge: S.notInCrm,
          message: S.notFoundMessage,
          actionLabel: reading ? S.reading : S.addToCrm,
          actionBusy: reading,
          help: S.addHelp,
        },
      };
    case "signed_out":
      return {
        badge: null,
        pill: { label: S.noSession, ariaLabel: S.pillSignedOut, dot: "neutral" },
        busy: false,
        body: { kind: "signed_out", message: S.signedOutMessage, actionLabel: S.signIn, help: S.signInHelp },
      };
    case "error":
      return {
        badge: null,
        pill: { label: S.errorShort, ariaLabel: S.pillError, dot: "neutral" },
        busy: false,
        body: { kind: "error", message: S.errorMessage, actionLabel: S.retry },
      };
  }
}
