/**
 * Mastery configuration constants (ADR-0007 §4).
 *
 * A knowledge point counts as "mastered" once its evidence-derived score
 * reaches this threshold. Kept in config so teachers can tune the gate
 * without touching the intervention algorithm.
 */
export const MASTERY_THRESHOLD = 0.6
