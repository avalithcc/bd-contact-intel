const MAX_TITLE_CHARS = 40;

/**
 * Message for the "task completed" toast: the label followed by the task
 * title, so two quick completions can be told apart. The title is
 * whitespace-collapsed and clamped with an ellipsis (the toast is a one-line
 * strip). Built here, not in the dictionary, because server components
 * cannot pass dictionary functions to client components.
 */
export function completedToastMessage(label: string, title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean === "") return label;
  // Clamp by CODE POINTS, not `String.length`/`slice`, which count UTF-16
  // code units: cutting at a fixed unit index can land between the two
  // halves of a surrogate pair and leave a lone surrogate, so an emoji in a
  // task title would render as "<?>…". `Array.from` iterates code points.
  const points = Array.from(clean);
  const shown = points.length > MAX_TITLE_CHARS ? `${points.slice(0, MAX_TITLE_CHARS - 1).join("")}…` : clean;
  return `${label}: ${shown}`;
}
