"use client";

import { useRouter } from "next/navigation";

/**
 * Checkbox filter for link-driven pages (no <form>): toggling it navigates
 * to `href`, the same URL the page would otherwise put on a toggle Link.
 * Keeps boolean filters rendered as checkboxes, consistent with the
 * form-based filters on /outreach and /hiring.
 */
export function FilterCheckbox({
  id,
  label,
  checked,
  href,
}: {
  id: string;
  label: string;
  checked: boolean;
  href: string;
}) {
  const router = useRouter();

  return (
    <label htmlFor={id} className="checkbox-label">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={() => router.push(href)}
      />
      {label}
    </label>
  );
}
