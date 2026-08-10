-- Migration 0015: 学情周报导出记录 (T19)
--
-- 记录「谁、什么时候、以什么格式、导出了谁的哪一周报告」。这是给教务/家长
-- 沟通留痕用的业务台账，与 server/audit 的哈希链审计**互补**：
--   * audit_events 是 append-only 防篡改链（跨模块通用）；
--   * weekly_report_exports 是可查询的业务视图（按学生/单元筛选历史导出）。
--
-- 铁律边界（ADR-0001 / ADR-0003）：
--   * 本表与 mastery_scores / review_cards / evaluations 无任何外键或写关系；
--     周报路径永不回写计分数据；
--   * 只存**标识与元数据**（id / 时间窗 / 格式 / 算法版本），
--     绝不存报告正文、教师提示原文或任何自由文本，避免 PII 二次落库。

CREATE TABLE IF NOT EXISTS weekly_report_exports (
  id TEXT PRIMARY KEY,
  -- 确定性报告 id：report_<studentId>_<unitId>_<from>_<to>
  report_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  teaching_unit_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  -- 'json' | 'html'
  format TEXT NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  -- 报告算法版本，可重放（report.weekly.v1）
  algorithm TEXT NOT NULL,
  -- 'ok' | 'insufficient_evidence'
  status TEXT NOT NULL,
  exported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_weekly_report_exports_student
  ON weekly_report_exports (student_id, exported_at DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_report_exports_unit
  ON weekly_report_exports (teaching_unit_id, exported_at DESC);
