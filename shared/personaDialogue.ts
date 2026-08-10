/**
 * personaDialogue — 人物对话探究契约（T21，练习态，不入分）。
 *
 * 这是一份**独立的**契约文件（不动 shared/contracts.ts），描述固定的人物目录
 * （3–5 个 demo 人物）、会话/轮次的数据形状，以及「练习探究 · 不计入测评」
 * 的铁律边界。
 *
 * 铁律（ADR-0001 / ADR-0006 / D1 双态模式）：
 *
 *   1. **只开放 practice 模式**。会话的 `mode` 在类型上恒为 `'practice'`，
 *      存储层 `CHECK (mode = 'practice')` 让 assessment 会话在 schema 层面
 *      就构造不出来（D1：assessment 关闭辅导）。
 *   2. **角色目录是代码里的静态常量**（`PERSONA_CATALOG`，对齐 T17
 *      `AGENT_CATALOG` / T20 `ACHIEVEMENT_CATALOG` 的做法）。角色不是 LLM
 *      自由发挥的产物，每个 demo 人物都挂载固定的「史料/教材摘录」，
 *      角色只能据摘录回答、不知则说不知。
 *   3. **DialogueTurn 禁止 evidence 标签**。类型里没有 score / evidence /
 *      weight 字段（对齐 T05 `TutoringMessage` 的隔离模式），对话产出在
 *      类型层面就进不了评分链；由 tests/personaDialogue.test.ts 契约测试守护。
 *   4. **LLM 的每一次回复都带 `llm_inference` provenance**（ADR-0006）。
 *      `source` 区分 `llm`（实时模型）与 `local-policy`（模板降级）——两者
 *      都是模型派生辅导，都不改分。对话记录写进 dialogue_turns 自有表，可
 *      追溯「哪次练习、哪个角色、哪轮提问」。
 *   5. **关闭对话不产生 Attempt**（除非用户另开测评题）。本模块没有任何
 *      Attempt / 评分写句柄。
 */
import type { Provenance, SubjectLanguage } from './contracts'

/** 目录版本号 —— 审计快照用（personas 镜像表记录当时挂载的是哪版目录）。 */
export const PERSONA_CATALOG_VERSION = 'persona-catalog.v1'

/** 轮次上限（用户提问轮数，8–12 之间取 10）。到达后拒绝继续，引导转论述题。 */
export const DIALOGUE_MAX_ROUNDS = 10

/** 连续低努力索取标准答案的拒绝阈值（对齐 T05 苏格拉底防套话）。 */
export const PERSONA_HELP_ABUSE_THRESHOLD = 3

/** UI 顶栏常驻标识文案。 */
export const DIALOGUE_PRACTICE_NOTICE = '练习探究 · 不计入测评'

/**
 * 固定人物集 —— MVP 预置 5 个 demo 人物（历史人物 / 观点角色，
 * 非真人师生仿冒，挂载史料/教材摘录）。顺序即展示顺序。
 */
export type PersonaId =
  | 'quyuan'
  | 'wanganshi'
  | 'zhangqian'
  | 'xuxiake'
  | 'kongzi'

/** 目录条目：身份 + 时代语境 + 史料摘录（回答的唯一依据）。 */
export interface PersonaCatalogEntry {
  /** 稳定标识，供 API / 测试 / UI key 使用。 */
  id: PersonaId
  /** 对外展示名。 */
  name: string
  /** 学科归属（SubjectLanguage）。 */
  subject: SubjectLanguage
  /** 时代 / 语境一句话。 */
  eraOrContext: string
  /**
   * 挂载的史料/教材摘录。角色**只**据此回答；摘录里没有的内容须诚实说
   * 「不知道 / 史料未提及」，绝不编造（TR2 降幻觉，内容来源克制）。
   */
  sourceExcerpts: readonly string[]
  /** 免责声明：练习探究，不计入测评。 */
  disclaimer: string
  /** 会话开场白（静态目录文案，非 LLM 生成）。 */
  openingLine: string
}

/**
 * 固定目录。`as const` 保证 id 与 PersonaId 联合一一对应。
 */
export const PERSONA_CATALOG: readonly PersonaCatalogEntry[] = [
  {
    id: 'quyuan',
    name: '屈原',
    subject: 'chinese',
    eraOrContext: '战国时期楚国（约公元前 4 世纪）',
    sourceExcerpts: [
      '屈原是战国时期楚国大臣与诗人，代表作《离骚》，开创「楚辞」体。',
      '「路漫漫其修远兮，吾将上下而求索」出自《离骚》，表达对理想的不懈追求。',
      '相传屈原于五月初五投汨罗江，后人以划龙舟、包粽子纪念，逐渐形成端午节。'
    ],
    disclaimer: '本对话为练习探究，不计入测评；回答仅依据挂载的史料摘录。',
    openingLine: '我是屈原，楚国秭归人。你有什么想问我的？我愿据我所知与你探讨。'
  },
  {
    id: 'wanganshi',
    name: '王安石',
    subject: 'history',
    eraOrContext: '北宋（公元 11 世纪）',
    sourceExcerpts: [
      '王安石（1021–1086），北宋政治家、文学家，主持「熙宁变法」。',
      '变法主要内容包括青苗法、农田水利法、募役法与方田均税法，旨在富国强兵、整顿财政。',
      '《答司马谏议书》是王安石回应司马光反对变法的书信，主张「度义而后动，是而不见可悔故也」。'
    ],
    disclaimer: '本对话为练习探究，不计入测评；回答仅依据挂载的史料摘录。',
    openingLine: '吾乃临川王安石。变法之事，愿与汝辨之。'
  },
  {
    id: 'zhangqian',
    name: '张骞',
    subject: 'history',
    eraOrContext: '西汉（公元前 2 世纪）',
    sourceExcerpts: [
      '张骞是西汉使者，两次出使西域，开辟了丝绸之路东段。',
      '丝绸之路连接长安与中亚、西亚乃至欧洲，促进了东西方商贸与文化往来。',
      '张骞出使带回西域物产与地理见闻，为汉代经营西域奠定了基础。'
    ],
    disclaimer: '本对话为练习探究，不计入测评；回答仅依据挂载的史料摘录。',
    openingLine: '我张骞受命出使西域。一路风沙，你想知道丝路上的见闻吗？'
  },
  {
    id: 'xuxiake',
    name: '徐霞客',
    subject: 'geography',
    eraOrContext: '明代晚期（17 世纪）',
    sourceExcerpts: [
      '徐霞客（1587–1641），明代地理学家、旅行家，著有《徐霞客游记》。',
      '他历时三十余年考察中国西南岩溶地貌，对喀斯特地形的记载早于欧洲学者。',
      '《徐霞客游记》兼具地理学价值与文学价值，被誉为「古今游记之最」。'
    ],
    disclaimer: '本对话为练习探究，不计入测评；回答仅依据挂载的史料摘录。',
    openingLine: '我是江阴徐弘祖，号霞客。山川地理，愿与君同游共探。'
  },
  {
    id: 'kongzi',
    name: '孔子',
    subject: 'history',
    eraOrContext: '春秋末期（公元前 6 世纪）',
    sourceExcerpts: [
      '孔子（前 551–前 479），春秋末期鲁国人，儒家学派创始人。',
      '《论语》记录孔子及其弟子的言行，主张「有教无类」「因材施教」。',
      '「学而不思则罔，思而不学则殆」出自《论语·为政》，讲学习与思考并重。'
    ],
    disclaimer: '本对话为练习探究，不计入测评；回答仅依据挂载的史料摘录。',
    openingLine: '学而时习之，不亦说乎？你有何疑问，愿与你说。'
  }
] as const

/** 目录查表。未知 id 返回 undefined（角色只能是固定集）。 */
export function findPersonaEntry(id: string): PersonaCatalogEntry | undefined {
  return PERSONA_CATALOG.find((entry) => entry.id === id)
}

export function isPersonaId(value: string): value is PersonaId {
  return PERSONA_CATALOG.some((entry) => entry.id === value)
}

/**
 * 对话轮次（写进 dialogue_turns 的审计单元）。
 *
 * 刻意**没有** score / evidence / weight 字段（对齐 T05 TutoringMessage 的
 * 隔离模式）——对话产出在类型层面就进不了评分链。assistant 轮次携带
 * `provenance`（恒 llm_inference）+ `source`；user 轮次为纯提问。
 */
export interface DialogueTurn {
  id: string
  sessionId: string
  /** 0 起连续编号（0 = 开场白）。 */
  turnIndex: number
  role: 'user' | 'assistant'
  content: string
  /** assistant 轮次：'local-policy'（模板降级）| 'llm'（实时模型）。 */
  source?: 'local-policy' | 'llm'
  /** 产出该轮的模型标签（provenance.model 同源）。 */
  model?: string
  /** ADR-0006 必填 provenance —— 只收 llm_inference，evidence 标签装不进来。 */
  provenance?: Extract<Provenance, { kind: 'llm_inference' }>
  /** 无标准解析 / 纯生成时的免责声明。 */
  disclaimer?: string
  createdAt: string
}

/** 会话视图（HTTP 响应 + 前端状态共用）。 */
export interface DialogueSessionView {
  id: string
  studentId: string
  personaId: PersonaId
  /** 挂载的知识点（可选）。 */
  kpId?: string
  /** 挂载的题目（可选）。 */
  questionId?: string
  /** 恒为 practice —— D1 双态模式在类型上封闭。 */
  mode: 'practice'
  status: 'open' | 'closed'
  /** 完整对话记录（开场白 + 用户轮 + 角色轮），审计可追溯。 */
  turns: DialogueTurn[]
  /** 用户提问轮数（不含开场白）。 */
  userTurnCount: number
  /** 轮次上限（8–12）。 */
  roundLimit: number
  createdAt: string
  closedAt?: string
}

/** 角色一方的单条回复（HTTP 响应载体）。 */
export interface PersonaDialogueMessage {
  id: string
  sessionId: string
  role: 'assistant'
  content: string
  /** 'local-policy'（模板降级）| 'llm'（实时模型）。 */
  source: 'local-policy' | 'llm'
  model: string
  /** ADR-0006 必填 —— 回复永远自证为 AI 推断。 */
  provenance: Extract<Provenance, { kind: 'llm_inference' }>
  createdAt: string
  disclaimer?: string
}

/** POST /api/practice/dialogue —— 开会话（仅 practice 态）。 */
export interface OpenDialogueRequest {
  /** 固定目录里的人物 id。 */
  personaId: string
  /** D1 双态门：恒为 practice；assessment 一律 403。 */
  mode: 'practice' | 'assessment'
  kpId?: string
  questionId?: string
}

export interface OpenDialogueResponse {
  session: DialogueSessionView
  persona: PersonaCatalogEntry
  /** 顶栏常驻标识：「练习探究 · 不计入测评」。 */
  notice: typeof DIALOGUE_PRACTICE_NOTICE
}

/** POST /api/practice/dialogue/:id/turn —— 多轮（轮次上限 DIALOGUE_MAX_ROUNDS）。 */
export interface DialogueTurnResult {
  message: PersonaDialogueMessage
  session: DialogueSessionView
  /** 本轮回合是否已用满（到达上限，前端引导转论述题）。 */
  roundLimitReached: boolean
}

/** POST /api/practice/dialogue/:id/close —— 结束探究。 */
export interface CloseDialogueResponse {
  session: DialogueSessionView
  /** 结束后的引导动作：去做论述题（正式评价走 EssayRunner，本会话不入分）。 */
  suggestedNext: 'essay'
}
