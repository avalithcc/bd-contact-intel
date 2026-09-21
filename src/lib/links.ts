/**
 * Outbound links to external tools, kept here so every page builds them
 * the same way.
 */

/**
 * LinkedIn company search for a display name. We deliberately link to the
 * search instead of a company page: no company's LinkedIn slug is stored
 * anywhere (neither board_candidate nor target_company has a website or
 * LinkedIn column), so a guessed /company/<slug> URL would 404 as often as
 * it worked. The search always resolves, and the first hit is normally the
 * company itself.
 */
export function linkedinCompanySearchUrl(displayName: string): string {
  const keywords = encodeURIComponent(displayName.trim());
  return `https://www.linkedin.com/search/results/companies/?keywords=${keywords}`;
}
