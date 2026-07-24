-- Migration 0004: T09 standard solution column on questions.
-- Separate file from 0003 so T03 (question bank) and T09 (solution) migrations
-- never collide. Nullable JSON: imported questions may omit a solution and get
-- flagged "待补" downstream (AI tutoring degrades to pure generation).

ALTER TABLE questions ADD COLUMN solution_json TEXT;
