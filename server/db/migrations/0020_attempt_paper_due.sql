-- 0020 — attempts 表补 paper_id / due_at（T07 打包绑定、T12 截止时间）
--
-- JsonAttemptStore 整行 JSON 天然携带 Attempt.paperId / dueAt；SQLite 列式存储
-- 需要显式列。SqliteAttemptStore 依赖本迁移后列存在（复赛 item 2）。
-- ALTER 只执行一次（schema_migrations 记录），无需 IF NOT EXISTS。

ALTER TABLE attempts ADD COLUMN paper_id TEXT;
ALTER TABLE attempts ADD COLUMN due_at TEXT;

CREATE INDEX IF NOT EXISTS idx_attempts_paper ON attempts (paper_id);
