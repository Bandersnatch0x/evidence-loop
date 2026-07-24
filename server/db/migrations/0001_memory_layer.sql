-- Migration 0001: memory layer (mastery_scores + review_cards + evaluations)
-- Recovers the previous hand-written ensureColumn path as an idempotent SQL migration.

CREATE TABLE IF NOT EXISTS mastery_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  kp_id TEXT NOT NULL,
  score REAL NOT NULL,
  evidence_ids TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hmac TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mastery_student_kp
  ON mastery_scores (student_id, kp_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS review_cards (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  kp_id TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  due_at TEXT NOT NULL,
  state TEXT NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review_at TEXT,
  elapsed_days REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  prev_hash TEXT NOT NULL,
  hmac TEXT NOT NULL,
  UNIQUE (student_id, kp_id)
);
CREATE INDEX IF NOT EXISTS idx_review_due
  ON review_cards (student_id, due_at ASC);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  student_id TEXT,
  assignment_id TEXT,
  created_at TEXT,
  score REAL,
  status TEXT,
  provenance TEXT NOT NULL DEFAULT '{"kind":"evidence"}'
);
