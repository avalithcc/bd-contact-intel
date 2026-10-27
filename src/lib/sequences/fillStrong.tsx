import type { ReactNode } from "react";

/** Like `fill`, but the values named in `strong` are wrapped in <strong> (the approved cards bold the person and the BD). */
export function fillStrong(template: string, vars: Record<string, string | number>, strong: readonly string[]): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    if (!key || !(key in vars)) return part;
    return strong.includes(key) ? <strong key={i}>{vars[key]}</strong> : String(vars[key]);
  });
}
