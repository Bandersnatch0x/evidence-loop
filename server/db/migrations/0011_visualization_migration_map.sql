-- Migration 0011: Phase E visualization migration guard table (ticket T-K)
--
-- Records question_id → demonstration/version mapping produced by
-- ensureDemonstrationMigration so re-runs are idempotent (只补缺不覆盖).
-- Idempotent guard: a question already mapped is never migrated again.

CREATE TABLE IF NOT EXISTS visualization_migration_map (
  question_id     TEXT PRIMARY KEY,
  demo_id         TEXT NOT NULL,
  version_id      TEXT NOT NULL,
  migrated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_viz_migration_demo
  ON visualization_migration_map (demo_id);