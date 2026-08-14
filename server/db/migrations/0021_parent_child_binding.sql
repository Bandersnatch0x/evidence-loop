-- 0021 — 家长-子女真实绑定（决赛加码 · 家长端）
--
-- 替代之前写死在 weeklyReportRoutes 里的 PARENT_CHILD_BINDING 常量：
-- 绑定关系落库、可增删、可审计。Demo 种子写入 parent-demo → learner-demo。
-- 语义：parent_id = 家长会话 userId；child_student_id = 子女学生 id。

CREATE TABLE IF NOT EXISTS parent_children (
  parent_id TEXT NOT NULL,
  child_student_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_id, child_student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_children_child
  ON parent_children (child_student_id);
