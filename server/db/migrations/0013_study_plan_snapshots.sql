-- Migration 0013: 硬事实学习计划快照 (T18)
--
-- 只缓存「最近一次生成的 7 日计划」供 UI 秒开。计划本身是可重放的：
-- algorithm = 'plan.hard.v1' + 同一份硬事实必得同一结果，所以这张表
-- 丢了也不影响正确性，重算即可。
--
-- 铁律边界（ADR-0001 / ADR-0006）：
--   * 本表与 mastery_scores / review_cards / evaluations 无任何外键或写关系；
--   * StudyPlanSnapshotStore 只读写本表，绝不反向写入 score / evidence /
--     MasteryProfile；
--   * payload 里的 presentationHint 属建议层（llm_inference），tasks 属硬事实层，
--     两者在同一 JSON 里但语义分层，前端按 provenance 分别呈现。

CREATE TABLE IF NOT EXISTS study_plan_snapshots (
  student_id TEXT NOT NULL,
  teaching_unit_id TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  -- 完整 StudyPlan JSON（含 days / tasks / evidenceRefs）。
  payload TEXT NOT NULL,
  PRIMARY KEY (student_id, teaching_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_study_plan_snapshots_generated
  ON study_plan_snapshots (student_id, generated_at DESC);
