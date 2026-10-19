/**
 * Replaces `{name}` placeholders in a dictionary string. Dictionary slices passed to client components cannot carry
 * functions, so those strings keep placeholders and the client fills them. Unknown placeholders stay visible.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
