-- Migration 0009: publication reports + appeals (T-F, spec §5.2/§5.3, decision 04).
-- Public-library governance tables only. NEVER touch scoring, student, grade,
-- attempt, mastery or teaching-org tables (spec §3.4 isolation iron law).

-- 举报（任意登录用户）-> 审核员队列 -----------------------------------------

CREATE TABLE IF NOT EXISTS publication_reports (
  id               TEXT PRIMARY KEY,
  demonstration_id TEXT NOT NULL,
  reporter_id      TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN ('copyright','illegal','inappropriate','spam','other')),
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at       TEXT NOT NULL,
  resolved_at      TEXT,
  resolved_by      TEXT,
  resolution_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_publication_reports_demo
  ON publication_reports (demonstration_id);
CREATE INDEX IF NOT EXISTS idx_publication_reports_status
  ON publication_reports (status, created_at);

-- 申诉（作者对驳回/下架决定申诉）-> 审核员处理 ------------------------------

CREATE TABLE IF NOT EXISTS publication_appeals (
  id               TEXT PRIMARY KEY,
  demonstration_id TEXT NOT NULL,
  -- The version being appealed (rejection) or NULL when appealing a takedown.
  version_id       TEXT,
  appellant_id     TEXT NOT NULL,
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','denied')),
  created_at       TEXT NOT NULL,
  resolved_at      TEXT,
  resolved_by      TEXT,
  resolution_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_publication_appeals_demo
  ON publication_appeals (demonstration_id);
CREATE INDEX IF NOT EXISTS idx_publication_appeals_status
  ON publication_appeals (status, created_at);
