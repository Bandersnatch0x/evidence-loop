-- Migration 0002: product org model + Attempt aggregate root (T01)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  role TEXT NOT NULL,
  login_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login ON users (login_id);

CREATE TABLE IF NOT EXISTS terms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teaching_units (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  taught_kp_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_teaching_unit_term_class
  ON teaching_units (term_id, class_id, subject_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  term_id TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_unique
  ON enrollments (student_id, class_id, term_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_class_term
  ON enrollments (class_id, term_id);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  teaching_unit_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_student_created
  ON attempts (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_question
  ON attempts (question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_term_mode
  ON attempts (term_id, mode);
