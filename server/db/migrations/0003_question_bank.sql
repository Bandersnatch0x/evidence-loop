-- Migration 0003: teacher-private question bank (T03)
--
-- Questions are the structured unit produced by teacher hand-entry: stem +
-- RunnerSpec payload + KP tags + difficulty + D2 authority source. Ownership is
-- teacher-private (author_id). payload_json is the same RunnerSpec shape the
-- RunnerRegistry already routes by question_type, so no scoring rewrite is
-- needed. solution_json (T09) is added by migration 0004.

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  question_bank_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  question_type TEXT NOT NULL,
  stem TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  kp_ids TEXT NOT NULL DEFAULT '[]',
  difficulty INTEGER NOT NULL DEFAULT 3,
  source TEXT NOT NULL DEFAULT 'authored_key',
  created_at TEXT NOT NULL,
  term_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_questions_author
  ON questions (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_bank
  ON questions (question_bank_id);
CREATE INDEX IF NOT EXISTS idx_questions_type
  ON questions (question_type);
