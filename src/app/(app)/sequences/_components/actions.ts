import type { CardActionId } from "@/lib/sequences/memberCard";

/**
 * What a control on the detail screen asks for. The components only report intent: the container that mounts them
 * (the go-live PR) decides whether it opens a dialog (PR 12) or calls an existing server action in actions.ts.
 */
export type DetailAction =
  | { type: "editSequence" | "generateMissing" | "approveReady" | "changeCadence" | "createNext" }
  | { type: CardActionId; memberId: string };
export type OnAction = (action: DetailAction) => void;
