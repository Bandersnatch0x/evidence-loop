/**
 * agentCatalog — 产品叙事层的 Agent 编队目录（T17）。
 *
 * 这是**叙事包装**，不是运行时：这里的五个「Agent」是对**已有**服务切分的
 * 对外命名（RunnerRegistry / 知识匹配 / Tutoring / NextPractice / Advisory），
 * 不引入任何新框架、新进程或新消息总线。目录是单一事实源，被透明度页、
 * 只读 API `GET /api/transparency/agents`、口播脚本和契约测试同时消费。
 *
 * 铁律（ADR-0001 / CONTEXT「评分事实只来自 Runner 产出的 Evidence」）：
 *   touchesScore === true 的 Agent，llmAllowed 必须为 false。
 * 只有评分 Agent 碰分数，且它是确定性的、零 LLM。
 * 该不变量由 tests/agentCatalog.test.ts 契约测试守护。
 */

export type AgentId =
  | 'scoring'
  | 'diagnosis'
  | 'tutoring'
  | 'assignment'
  | 'advisory'

export interface AgentCatalogEntry {
  /** 稳定标识，供 API / 测试 / UI key 使用。 */
  id: AgentId
  /** 对外中文展示名。 */
  name: string
  /** 对内模块切分描述（现有代码，不新建）。 */
  internalModule: string
  /** 是否写 score / 正式掌握度。 */
  touchesScore: boolean
  /** 是否允许调用 LLM。碰分即禁止。 */
  llmAllowed: boolean
  /** 输入描述。 */
  inputs: string[]
  /** 输出描述。 */
  outputs: string[]
  /** 禁止事项（边界声明）。 */
  prohibitions: string[]
}

export const AGENT_CATALOG: AgentCatalogEntry[] = [
  {
    id: 'scoring',
    name: '评分 Agent',
    internalModule: 'RunnerRegistry + Rubric',
    touchesScore: true,
    llmAllowed: false,
    inputs: ['学习者提交（代码 / 表达式 / 作文）', '题目测试规范与隐藏用例', '版本化量规 Rubric'],
    outputs: ['可复现 Evidence[]（test / static / cas_check 等）', '确定性总分与各维度得分', '五步执行 trace'],
    prohibitions: [
      '不调用任何 LLM——分数只来自 Runner 证据',
      '不读记忆层 / 软语义（步 3、4 仅本次证据）',
      '不接受辅导会话或教师建议作为输入'
    ]
  },
  {
    id: 'diagnosis',
    name: '诊断 Agent',
    internalModule: '知识匹配 / Intervention',
    touchesScore: false,
    llmAllowed: false,
    inputs: ['本次失败 Evidence[]', '知识点 DAG 与前置依赖', 'D4 已教知识点集合'],
    outputs: ['薄弱知识点映射', '最短修复干预任务', 'evidenceRefs 可溯源引用'],
    prohibitions: [
      '不改分、不写 score / MasteryProfile',
      '不对未教知识点报警（D4）',
      '不做超出证据的能力或个人属性推断'
    ]
  },
  {
    id: 'tutoring',
    name: '辅导 Agent',
    internalModule: 'Tutoring / Socratic',
    touchesScore: false,
    llmAllowed: true,
    inputs: ['只读 FeedbackContext（已定分数 / 证据 / 诊断）', '题目标准解析（RAG 降幻觉）', '练习态会话消息'],
    outputs: ['讲解 / 苏格拉底追问 / 对话回复', 'provenance: llm_inference 标注', '无解析时的免责徽章'],
    prohibitions: [
      '永不回写 score / evidence / MasteryProfile（T05 物理隔离）',
      '不产出 EvidenceItem',
      '测评态不可用（mode gate 403）'
    ]
  },
  {
    id: 'assignment',
    name: '组卷/推题 Agent',
    internalModule: 'NextPractice / 薄弱布置 / T16',
    touchesScore: false,
    llmAllowed: false,
    inputs: ['FSRS 到期复习卡', '依赖链薄弱知识点', 'D4 已教进度与班级聚合薄弱面'],
    outputs: ['今日该练候选题', '按薄弱点组卷结果', '批量布置的占位 Attempt'],
    prohibitions: [
      '不写 score——未提交的占位 Attempt 不进掌握度',
      '候选题只由硬输入决定，软语义只影响 presentationHint',
      '不越出 enrollment 名单布置'
    ]
  },
  {
    id: 'advisory',
    name: '教师建议 Agent',
    internalModule: 'Advisory + 关注队列 + Tips',
    touchesScore: false,
    llmAllowed: true,
    inputs: ['班级学情快照与关注队列', '主观维度文本（作文立意 / 论述）', '教师发起的提示范围'],
    outputs: ['AdvisoryLayer 主观建议（待教师确认）', '关注学员队列', '站内提示消息'],
    prohibitions: [
      '不入正式分——需教师确认后才计入 Cohort 指标',
      '站内消息永不写 score / evidence / MasteryProfile',
      '不代替教师终裁，不批量给分'
    ]
  }
]
