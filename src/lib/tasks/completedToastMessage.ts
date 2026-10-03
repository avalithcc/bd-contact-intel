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
  const shown = clean.length > MAX_TITLE_CHARS ? `${clean.slice(0, MAX_TITLE_CHARS - 1)}…` : clean;
  return `${label}: ${shown}`;
}
