-- Migration 0012: material → draft questions (T15)
--
-- Two product tables behind the teacher proofreading gate:
--   material_import_jobs : one paste / .txt / doc-parse run
--   draft_questions      : LLM candidates, provenance = llm_inference
--
-- Iron rule (ADR-0001): nothing in this migration is a Question. A draft row
-- can NEVER be answered or scored — only the teacher confirm gate writes a row
-- into `questions` (source = authored_key). Drafts hold no score / evidence /
-- attempt column by construction, so the generation path cannot touch grades.
--
-- PII surface (T10): the raw material text is NOT stored. Only a sha256 hash
-- plus a short per-draft excerpt used for side-by-side proofreading.

CREATE TABLE IF NOT EXISTS material_import_jobs (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  teaching_unit_id TEXT,
  question_bank_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'paste',
  source_ref TEXT,
  raw_text_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  generator_model TEXT NOT NULL,
  degraded INTEGER NOT NULL DEFAULT 0,
  draft_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_material_import_jobs_teacher
  ON material_import_jobs (teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_import_jobs_status
  ON material_import_jobs (teacher_id, status);

CREATE TABLE IF NOT EXISTS draft_questions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  provenance_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  confirmed_question_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draft_questions_job
  ON draft_questions (job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_draft_questions_teacher
  ON draft_questions (teacher_id, status);
