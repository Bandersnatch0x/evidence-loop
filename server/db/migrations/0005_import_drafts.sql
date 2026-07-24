-- Migration 0005: OCR / document import drafts (T04)
--
-- Import drafts are the only product of parse/OCR + LLM split. They stay in
-- `pending_review` until a teacher confirms items into the questions table.
-- Unconfirmed drafts are NOT questions and cannot enter 测评态 (D2 gate).

CREATE TABLE IF NOT EXISTS import_drafts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  question_bank_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  source_filename TEXT NOT NULL,
  parse_method TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  items_json TEXT NOT NULL,
  privacy_notice TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_question_ids TEXT NOT NULL DEFAULT '[]',
  ocr_provider TEXT,
  egress_class TEXT NOT NULL DEFAULT 'L1',
  allows_egress INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_import_drafts_author
  ON import_drafts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_drafts_status
  ON import_drafts (author_id, status);
