-- Migration 0014: 跨学科模拟考卷面 (T16)
--
-- 一份 MockExamPlan 记录「教师确定性组卷的结果」：有序题号 + KP 覆盖 +
-- 时长 + 状态。布置后复用 T07/T08 既有的 Paper / Attempt 模型，本表只回填
-- paper_id 做反查，不复制任何作答数据。
--
-- 铁律边界（ADR-0001 / ADR-0006）：
--   * 本表没有 score / evidence / mastery 任何一列 —— 组卷不产生分数；
--   * MockExamPlanStore 只读写本表，绝不反向写 attempts / evaluations /
--     mastery_scores；学生分数仍然只能由确定性 Runner 在作答后产出；
--   * question_ids 里的每一条都必须是 `questions` 表里已入库、且有权威答案
--     （D2: authored_key / test_case）的正式题。T15 的草稿题存在独立的
--     draft_questions 表，结构上不可能出现在这里；
--   * kp_coverage 里的 KP 全部来自题目自身标签 ∩ TeachingUnit.taught_kp_ids
--     （D4 已教进度），组卷路径不新造 KP。
--
-- 不加 questions / teaching_units 外键：题库允许教师删题，卷面是历史快照，
-- 不应被删题级联破坏（与 study_plan_snapshots 同一取舍）。

CREATE TABLE IF NOT EXISTS mock_exam_plans (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  -- JSON string[]：参与组卷的教学单元（跨学科时多个，单科时一个）。
  teaching_unit_ids TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  -- JSON string[]：有序题号。
  question_ids TEXT NOT NULL,
  -- JSON MockExamKpCoverage[]：{ kpId, subject, questionCount, teachingUnitId }。
  kp_coverage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'assigned', 'archived')),
  algorithm TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- 发布后回填的 T07 Paper id；draft 状态下为 NULL。
  paper_id TEXT,
  assigned_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mock_exam_plans_creator
  ON mock_exam_plans (creator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mock_exam_plans_class
  ON mock_exam_plans (class_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mock_exam_plans_paper
  ON mock_exam_plans (paper_id);
