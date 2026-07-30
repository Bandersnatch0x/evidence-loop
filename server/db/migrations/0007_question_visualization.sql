-- Migration 0007: ADR-0015 teacher-authored visualization column on questions.
-- Nullable JSON: a question has a 3D visualization only after a teacher
-- generates + confirms one. Separate file from 0004 (solution) so the two
-- optional JSON columns never collide. Presentation only — never scored.

ALTER TABLE questions ADD COLUMN visualization_json TEXT;
