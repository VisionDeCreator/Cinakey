/** Launch caps and rate limits (Phase 10). */

export const STARTER_USD_MICROS = 5_000_000;

export const RATE_LIMITS = {
  startGeneration: { limit: 20, windowMs: 60 * 60 * 1000 },
  createProject: { limit: 10, windowMs: 60 * 60 * 1000 },
  recordExport: { limit: 30, windowMs: 60 * 60 * 1000 },
  staffGrant: { limit: 60, windowMs: 60 * 60 * 1000 },
  reportEgress: { limit: 120, windowMs: 60 * 60 * 1000 },
} as const;
