-- Migration 0017: 人物对话探究（练习态，不入分）(T21)
--
-- 两张自有表 + 一张轮次明细表，只服务「练习态人物对话探究」：
--   * personas           —— 静态目录 `PERSONA_CATALOG`（shared/personaDialogue.ts）
--                           的**镜像快照**。目录仍是代码里的唯一事实源（固定人物
--                           集，非 LLM 自由发挥）；本表按 catalog_version 记录
--                           「当时挂载的是哪一版目录」，供审计与将来教师挂载用。
--   * dialogue_sessions  —— 一次探究会话。`mode` 列带 `CHECK (mode = 'practice')`，
--                           在 schema 层面就把 assessment 会话堵死（D1：assessment
--                           关闭辅导）。
--   * dialogue_turns     —— 轮次明细（开场白 + 用户轮 + 角色轮）。每条 assistant
--                           轮携带 provenance_json（恒 llm_inference），可追溯
--                           「哪次练习、哪个角色、哪轮提问」。
--
-- 铁律边界（ADR-0001 / ADR-0006）：
--   * 本组表与 mastery_scores / review_cards / evaluations / attempts 无任何
--     外键或写关系；DialogueStore 只读写这三张自有表，整条对话探究路径在物理
--     上不可能写 score / evidence / MasteryProfile（ADR-0001）；
--   * 关闭对话不产生 Attempt（除非用户另开测评题）——本组表里根本没有 attempts
--     的关联列；
--   * 克制边界：personas 表不存音色/仿声素材，不模仿在世教师声线
--     （PRD Out of Scope）。

CREATE TABLE IF NOT EXISTS personas (
  persona_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  era_or_context TEXT NOT NULL,
  -- PersonaCatalogEntry.sourceExcerpts 的 JSON（角色回答的唯一依据）。
  source_excerpts_json TEXT NOT NULL,
  disclaimer TEXT NOT NULL,
  -- 目录版本（persona-catalog.v1），审计快照用。
  catalog_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dialogue_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  -- D1 双态门：练习探究只属于 practice。CHECK 让 assessment 会话构造不出来。
  mode TEXT NOT NULL DEFAULT 'practice' CHECK (mode = 'practice'),
  kp_id TEXT,
  question_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- 轮次总数（含开场白）。
  turn_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_turn_at TEXT,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dialogue_sessions_student
  ON dialogue_sessions (student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dialogue_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  -- 0 起连续编号（0 = 开场白）。
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  -- 'local-policy'（模板降级）| 'llm'（实时模型）。
  source TEXT,
  model TEXT,
  -- Extract<Provenance, {kind:'llm_inference'}> 的 JSON。assistant 轮非空。
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_dialogue_turns_session
  ON dialogue_turns (session_id, turn_index);
