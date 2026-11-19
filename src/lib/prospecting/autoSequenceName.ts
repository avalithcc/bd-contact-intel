/**
 * The dedicated Sequence's name, kept DB-free so a client component can recognise one without dragging `@/db` into
 * the browser bundle (serviceRoleBoundary.test.ts walks that graph transitively). autoSequence.ts re-exports these.
 *
 * The name IS the marker: there is no "automatic" flag on `sequence`, and the owner asked for the origin to be
 * visible in the Sequences list, which a name does and a column would not.
 */
export const AUTO_SEQUENCE_PREFIX = "Descubrimiento automático";

export const autoSequenceName = (bdName: string) => `${AUTO_SEQUENCE_PREFIX} · ${bdName.trim()}`;

/** Whether a Sequence was created by the automatic path. Used to word its header truthfully. */
export const isAutoSequenceName = (name: string | null | undefined) => (name ?? "").startsWith(AUTO_SEQUENCE_PREFIX);
