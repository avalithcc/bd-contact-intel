/** The industry chip selection as pure functions, so the partial state and the shortcuts are tested without a browser. */
import { industryValuesOf, type IndustryGroupKey } from "./industryGroups";

/** `true` when every value of the group is selected, `"mixed"` when only some are (the chip is partial), else `false`. */
export function groupState(industries: readonly string[], group: IndustryGroupKey): boolean | "mixed" {
  const values = industryValuesOf(group);
  const on = values.filter((v) => industries.includes(v)).length;
  return on === 0 ? false : on === values.length ? true : "mixed";
}

/** A group chip is a shortcut: fully on -> drop its values; off or partial -> select all of them. Other groups are untouched. */
export function toggleGroup(industries: readonly string[], group: IndustryGroupKey): string[] {
  const values = industryValuesOf(group);
  const rest = industries.filter((v) => !values.includes(v));
  return groupState(industries, group) === true ? rest : [...rest, ...values];
}

export const toggleValue = (industries: readonly string[], value: string): string[] =>
  industries.includes(value) ? industries.filter((v) => v !== value) : [...industries, value];
