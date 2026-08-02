-- Migration 0008: demonstration module table family (T-A).
-- Spec §3 (ticket 14 shape + ticket 03 media family + ticket 12 references).
-- Presentation/library module only — NEVER touches QuestionType/Runner/Rubric/Evidence.

-- 作品族 --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teaching_demonstrations (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  meta_json   TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_demonstrations_owner ON teaching_demonstrations (owner_id);
CREATE INDEX IF NOT EXISTS idx_demonstrations_deleted ON teaching_demonstrations (deleted_at);

CREATE TABLE IF NOT EXISTS demonstration_drafts (
  id               TEXT PRIMARY KEY,
  demonstration_id TEXT NOT NULL UNIQUE,
  document_json    TEXT NOT NULL,
  checkpoint_json  TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demonstration_versions (
  id                     TEXT PRIMARY KEY,
  demonstration_id       TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('submitted','approved','rejected','withdrawn')),
  snapshot_document_json TEXT NOT NULL,
  classification         TEXT NOT NULL,
  license                TEXT NOT NULL,
  ai_disclosure          TEXT NOT NULL,
  source_chain_json      TEXT,
  media_manifest_json    TEXT NOT NULL,
  reviewer_note          TEXT,
  frozen_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demo_versions_demo_status
  ON demonstration_versions (demonstration_id, status);
CREATE INDEX IF NOT EXISTS idx_demo_versions_status_frozen
  ON demonstration_versions (status, frozen_at);
-- 同一作品最多一个待审版本（DB 层兜底，服务层前置校验）
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_versions_pending_unique
  ON demonstration_versions (demonstration_id) WHERE status = 'submitted';

-- 媒体族（票 03 / 调研 §3.1）--------------------------------------------------

CREATE TABLE IF NOT EXISTS media_assets (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('image','audio','model3d','video','subtitle')),
  original_blob_hash TEXT NOT NULL,
  status             TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  deleted_at         TEXT
);

CREATE TABLE IF NOT EXISTS media_blobs (
  hash                TEXT PRIMARY KEY,
  canonical_extension TEXT NOT NULL,
  media_type          TEXT NOT NULL,
  byte_size           INTEGER NOT NULL,
  storage_key         TEXT NOT NULL,
  scan_status         TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_derivatives (
  id                TEXT PRIMARY KEY,
  asset_id          TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('display','thumbnail','poster','playback','caption')),
  blob_hash         TEXT NOT NULL,
  source_blob_hash  TEXT NOT NULL,
  recipe_name       TEXT NOT NULL,
  recipe_version    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_derivatives_idempotent
  ON media_derivatives (source_blob_hash, recipe_name, recipe_version);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id                       TEXT PRIMARY KEY,
  owner_id                 TEXT NOT NULL,
  intended_kind            TEXT NOT NULL,
  declared_bytes           INTEGER NOT NULL,
  received_bytes           INTEGER NOT NULL,
  temp_key                 TEXT NOT NULL,
  state                    TEXT NOT NULL CHECK (state IN ('uploading','quarantined','inspecting','processing','ready','rejected','failed')),
  quota_reservation_bytes  INTEGER NOT NULL,
  expires_at               TEXT NOT NULL,
  created_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner_state
  ON upload_sessions (owner_id, state);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires
  ON upload_sessions (expires_at);

CREATE TABLE IF NOT EXISTS media_jobs (
  id               TEXT PRIMARY KEY,
  asset_id         TEXT NOT NULL,
  job_type         TEXT NOT NULL,
  state            TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  available_at     TEXT NOT NULL,
  lease_owner      TEXT,
  lease_expires_at TEXT,
  last_error_code  TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_jobs_state_available
  ON media_jobs (state, available_at);
CREATE INDEX IF NOT EXISTS idx_media_jobs_lease
  ON media_jobs (lease_expires_at);

CREATE TABLE IF NOT EXISTS external_video_refs (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL,
  provider             TEXT NOT NULL CHECK (provider IN ('youtube','vimeo')),
  provider_video_id    TEXT NOT NULL,
  canonical_url        TEXT NOT NULL,
  health               TEXT NOT NULL CHECK (health IN ('unknown','healthy','degraded','unavailable','private','embed_forbidden')),
  checked_at           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_code    TEXT
);
CREATE INDEX IF NOT EXISTS idx_external_video_provider_health
  ON external_video_refs (provider, health);

-- 引用表（票 12）-------------------------------------------------------------

CREATE TABLE IF NOT EXISTS demonstration_references (
  id              TEXT PRIMARY KEY,
  question_id     TEXT,
  kp_id           TEXT,
  demo_version_id TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('primary','supplementary')),
  ord             INTEGER NOT NULL,
  CHECK ((question_id IS NULL) != (kp_id IS NULL))
);
-- 排序唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_refs_question_ord
  ON demonstration_references (question_id, ord) WHERE question_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_refs_kp_ord
  ON demonstration_references (kp_id, ord) WHERE kp_id IS NOT NULL;
-- primary 至多 1（DB 层 + 服务层双保险）
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_refs_question_primary
  ON demonstration_references (question_id, role) WHERE question_id IS NOT NULL AND role = 'primary';
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_refs_kp_primary
  ON demonstration_references (kp_id, role) WHERE kp_id IS NOT NULL AND role = 'primary';
-- 被引用计数 / 失效通知热路径
CREATE INDEX IF NOT EXISTS idx_demo_refs_version
  ON demonstration_references (demo_version_id);

-- 审核员标志列（票 14：不扩 role 枚举）----------------------------------------
ALTER TABLE users ADD COLUMN public_library_reviewer INTEGER NOT NULL DEFAULT 0;
