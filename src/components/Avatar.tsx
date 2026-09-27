import { avatarPaletteClass } from "./avatarPalette";

/**
 * Shared avatar (tasks.md mockup-parity 2.1; design-system.html "Avatares y
 * chip de responsable"). Contacts render as circles; BDs render as
 * rounded squares (`variant="bd"`, mockup's `.avatar-bd`). Color is
 * deterministic per `id` (see avatarPalette.ts) — a contact's avatar never
 * changes color between renders.
 */
export function Avatar({
  id,
  initials,
  variant = "circle",
  size = "md",
  className,
}: {
  id: string;
  initials: string;
  variant?: "circle" | "bd";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClass = size === "sm" ? "avatar-sm" : size === "lg" ? "avatar-lg" : "";
  const variantClass = variant === "bd" ? "avatar-bd" : "";

  return (
    <span
      className={["avatar", avatarPaletteClass(id), sizeClass, variantClass, className]
        .filter(Boolean)
        .join(" ")}
    >
      {initials}
    </span>
  );
}
