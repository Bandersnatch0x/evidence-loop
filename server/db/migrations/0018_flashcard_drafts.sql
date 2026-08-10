-- Migration 0018: 媒体/转写 → 闪卡草稿（T22）
--
-- 两张自有表，服务端与 T15 `draft_questions` 同构但独立：
--   flashcard_draft_jobs : 一次 粘贴字幕 / WebVTT / 音频转写 的生成任务
--   draft_flashcards     : LLM 候选闪卡，provenance = llm_inference
--
-- 铁律（ADR-0001）：本迁移不建任何 Question —— 闪卡草稿行永远不能被作答、
-- 被计分。只有教师校对确认后，服务端才把内容写成 `questions` 里的一条
-- fill_blank 题（source = authored_key）。因此本组表没有任何 score /
-- evidence / attempt 列（DDL 层面杜绝写分）。
--
-- PII 收敛（ADR-0003 / T10）：转写原文不落库。只有 sha256 哈希
-- （flashcard_draft_jobs.raw_text_hash）加逐条截断片段
-- （draft_flashcards.source_excerpt）用于并排校对。

CREATE TABLE IF NOT EXISTS flashcard_draft_jobs (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  teaching_unit_id TEXT,
  question_bank_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'transcript',
  source_ref TEXT,
  raw_text_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  generator_model TEXT NOT NULL,
  degraded INTEGER NOT NULL DEFAULT 0,
  draft_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flashcard_jobs_teacher
  ON flashcard_draft_jobs (teacher_id, created_at DESC);

CREATE TABLE IF NOT EXISTS draft_flashcards (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  front TEXT NOT NULL DEFAULT '',
  back TEXT NOT NULL DEFAULT '',
  source_excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  provenance_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  front_grounded INTEGER NOT NULL DEFAULT 0,
  confirmed_question_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draft_flashcards_job
  ON draft_flashcards (job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_draft_flashcards_teacher
  ON draft_flashcards (teacher_id, status);
