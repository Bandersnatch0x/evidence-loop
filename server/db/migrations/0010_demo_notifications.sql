-- Migration 0010: demonstration reference notifications (T-J)
--
-- Public-library notification channel for teachers who reference public
-- demonstrations: new version available, source unavailable, forced takedown
-- with replace deadline (spec §5.3 / §11 #5). Independent of the teacher→student
-- tips channel (0006) — this is library-governance → teacher.
-- Notifications NEVER touch scoring/evidence (铁律).

CREATE TABLE IF NOT EXISTS demo_notifications (
  id              TEXT PRIMARY KEY,
  recipient_id    TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('new_version','source_unavailable','forced_takedown')),
  demo_version_id TEXT,
  question_id     TEXT,
  kp_id           TEXT,
  detail_json     TEXT NOT NULL DEFAULT '{}',
  read_at         TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demo_notifications_recipient
  ON demo_notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_notifications_kind
  ON demo_notifications (kind, created_at DESC);