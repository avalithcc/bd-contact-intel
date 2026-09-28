/**
 * "Empresa" column's company-logo initial chip (mockups/contacts.html:
 * `<span class="company-logo">ML</span>` for Mercado Libre, `G` for
 * Globant). Deliberately its OWN initials rule, not a reuse of
 * `@/components/initials`#initialsFromName — the mockup's single-word
 * companies (Globant, Nubank) show ONE letter, while that person-avatar
 * helper takes two letters from a lone word. Pure — no DB.
 */
export function companyLogoInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
