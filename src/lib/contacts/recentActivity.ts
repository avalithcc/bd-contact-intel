/**
 * Pure "most recent event across every channel" pick for the Resumen tab's
 * "Última actividad" stat (mockup-port r06; contact-record.html:153 "2 días
 * · Hilo de correo · Cristian"). Combines real `activity` rows (already
 * fetched for the Actividad tab) with connection message facts (already
 * fetched for the right panel) — no new query.
 */
export interface RecentActivityCandidate {
  at: Date;
  // Human label for the "foot" line (e.g. "Correo enviado", "LinkedIn").
  channelLabel: string;
  actorName: string | null;
}

export function mostRecentActivity(
  candidates: readonly RecentActivityCandidate[],
): RecentActivityCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, c) => (c.at.getTime() > latest.at.getTime() ? c : latest));
}

/**
 * "Puntos de contacto (todos los BDs)" total (contact-record.html:154 "11 ·
 * 6 LinkedIn · 3 correos · 2 notas") — a simple additive count across the
 * three channels the record page already has aggregate counts for.
 */
export interface TouchpointBreakdown {
  linkedin: number;
  email: number;
  notes: number;
}

export function touchpointTotal(breakdown: TouchpointBreakdown): number {
  return breakdown.linkedin + breakdown.email + breakdown.notes;
}
