-- Migration 0016: 证据驱动的轻激励徽章 (T20)
--
-- 只存「某学生某枚徽章何时被授予、凭哪些硬证据」。这张表是**可重放缓存**：
-- 判定算法 achievement.hard.v1 + 同一份 Attempt 历史必得同一批徽章，
-- earnedAt 又取自触发它的 Attempt.createdAt（不是判定时刻），所以整张表
-- 丢了重算即可，不影响任何正确性。
--
-- 铁律边界（ADR-0001 / ADR-0006）：
--   * 本表与 mastery_scores / review_cards / evaluations / attempts 无任何
--     外键或写关系；AchievementStore 只读写本表，授予徽章绝不反向写入
--     score / evidence / MasteryProfile，对掌握度算法零影响；
--   * evidence_refs 是**非空**的自证链（NOT NULL + CHECK 挡住 '[]'），
--     「没有证据就没有徽章」在存储层就成立；
--   * presentation_hint 属建议层（provenance = llm_inference，祝贺文案），
--     可为空，且**不参与**是否授予 —— 它只是被顺带存下来的展示物。
--
-- 克制边界（PRD Out of Scope）：本表没有 points / rank / level / streak 列，
-- 也没有任何跨学生比较用的排序键 —— 积分排行榜在 schema 层就构造不出来。

CREATE TABLE IF NOT EXISTS student_achievements (
  student_id TEXT NOT NULL,
  -- 固定目录 5 选 1：first_evidence_pass / repair_plus_20 /
  -- weak_kp_cleared / streak_study_3 / plan_day_done
  achievement_id TEXT NOT NULL,
  -- 触发它的硬事实时间（Attempt.createdAt），首次授予即定格。
  earned_at TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  -- AchievementEvidenceRef[] 的 JSON。非空数组 —— 审计入口。
  evidence_refs TEXT NOT NULL CHECK (
    evidence_refs <> '' AND evidence_refs <> '[]'
  ),
  -- AchievementPresentationHint 的 JSON（建议层，可为 NULL）。
  presentation_hint TEXT,
  PRIMARY KEY (student_id, achievement_id)
);

-- 学生成就墙按获得时间倒序。
CREATE INDEX IF NOT EXISTS idx_student_achievements_earned
  ON student_achievements (student_id, earned_at DESC);

-- 教师聚合视图只做 COUNT(*) GROUP BY achievement_id，不做排名。
CREATE INDEX IF NOT EXISTS idx_student_achievements_catalog
  ON student_achievements (achievement_id);
