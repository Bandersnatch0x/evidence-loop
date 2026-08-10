-- Migration 0019: 能力证据包 / 作品集导出记录 (T23)
--
-- 记录「谁、什么时候、导出了谁的哪个教学单元的作品集（含多少条 Attempt、
-- 用什么算法/量规版本）」——这是给实训报告/竞赛材料留痕用的业务台账，与
-- server/audit 的哈希链审计**互补**：
--   * audit_events 是 append-only 防篡改链（跨模块通用）；
--   * portfolio_exports 是可查询的业务视图（按学生/单元筛选历史导出）。
--
-- 铁律边界（ADR-0001 / ADR-0003）：
--   * 本表与 mastery_scores / review_cards / evaluations / attempts 无任何
--     外键或写关系；导出路径永不回写计分数据；
--   * 只存**标识与元数据**（id / 学生 / 单元 / 操作者 / 条目数 / 版本号），
--     绝不存包正文、题干、批注原文、evidence.actual 或任何自由文本，
--     避免 PII 二次落库。

CREATE TABLE IF NOT EXISTS portfolio_exports (
  id TEXT PRIMARY KEY,
  -- 确定性包 id：portfolio_<studentId>_<unitId>_<ISO 时间戳>
  package_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  teaching_unit_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  -- 包内 Attempt 条目数（元数据，非明细）
  attempt_count INTEGER NOT NULL DEFAULT 0,
  -- 打包算法版本，可重放（portfolio.hard.v1）
  algorithm TEXT NOT NULL,
  -- 量规版本（rubric.v1）
  rubric_version TEXT NOT NULL,
  exported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_exports_student
  ON portfolio_exports (student_id, exported_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_exports_unit
  ON portfolio_exports (teaching_unit_id, exported_at DESC);
