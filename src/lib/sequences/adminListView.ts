import type { ListScope, OwnerOption } from "./listScope";

/** What the admin list adds to the BD list: the tab, the counts, the owner menu and chip. Absent for a BD. */
export type AdminListView = {
  scope: ListScope;
  meId: string;
  tabs: { mine: number; all: number };
  owners: readonly OwnerOption[];
  chipOwner: OwnerOption | null;
};
