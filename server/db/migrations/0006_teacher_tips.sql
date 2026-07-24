-- Migration 0006: teacher batch tips / 站内消息 (T14)
--
-- Tips are teacher-authored short messages fan-out to enrolled students.
-- They NEVER write result.score / evidence / MasteryProfile (铁律).
-- Delivery is one row per student; readAt null = unread.

CREATE TABLE IF NOT EXISTS teacher_tips (
  id TEXT PRIMARY KEY,
  teaching_unit_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kp_ids TEXT NOT NULL DEFAULT '[]',
  paper_id TEXT,
  question_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_teacher_tips_unit
  ON teacher_tips (teaching_unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_tips_teacher
  ON teacher_tips (teacher_id, created_at DESC);

CREATE TABLE IF NOT EXISTS teacher_tip_deliveries (
  tip_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  read_at TEXT,
  PRIMARY KEY (tip_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_tip_deliveries_student
  ON teacher_tip_deliveries (student_id, read_at);
