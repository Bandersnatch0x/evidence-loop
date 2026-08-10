/**
 * StudyPlanService — T18 硬事实学习计划的编排层。
 *
 * 职责严格限定为两步：
 *   1. 通过**只读端口**收集硬事实快照（StudyPlanHardFacts）；
 *   2. 交给纯函数 `buildStudyPlan` 生成计划。
 *
 * 本类不做任何裁剪/加权/排序决策 —— 那些全在纯函数里，才能被快照测试锁死。
 * 本类也不持有任何写句柄（除可选的自有快照表），所以「生成计划」这条路径
 * 在物理上不可能写 score / evidence / MasteryProfile（ADR-0001）。
 *
 * 建议层（presentationHint）是**事后外挂**：`attachPresentationHint` 只往
 * 计划对象上贴一个字段，days/tasks 逐字节不变；provenance 不是
 * `llm_inference` 的一律拒绝。无 LLM 时整条链路照常工作。
 */
import { MASTERY_THRESHOLD } from '../config/mastery'
import type { MasteryProfileMap } from '../../shared/contracts'
import {
  STUDY_PLAN_HORIZON_DAYS,
  type StudyPlan,
  type StudyPlanDependencyGap,
  type StudyPlanHardFacts,
  type StudyPlanPresentationHint
} from '../../shared/studyPlan'
import { buildStudyPlan, type BuildStudyPlanOptions } from './buildStudyPlan'
import {
  TeachingUnitMissingError,
  type DependencyGapReader,
  type DueCardReader,
  type StudyPlanMasteryReader,
  type StudyPlanOrgReader,
  type StudyPlanQuestionReader,
  type StudyPlanSnapshotWriter
} from './ports'

export interface StudyPlanServiceOptions {
  review: DueCardReader
  mastery: StudyPlanMasteryReader
  org: StudyPlanOrgReader
  questions: StudyPlanQuestionReader
  /** 可选：无依赖链诊断时退化为 fsrs + mastery 两路输入。 */
  interventions?: DependencyGapReader
  /** 可选：最近一次计划快照持久化（自有表）。 */
  snapshots?: StudyPlanSnapshotWriter
  now?: () => Date
  horizonDays?: number
}

export interface GenerateStudyPlanOptions extends BuildStudyPlanOptions {
  /** 题库作者，默认取教学单元 owner（T03 教师私有题库）。 */
  authorId?: string
  now?: Date
  /** 每个 KP 从题库取多少候选题。默认 5。 */
  questionsPerKp?: number
}

/** FSRS 单次拉取上限，与 T06 NextPracticeService 保持一致。 */
const DUE_CARD_SCAN_LIMIT = 100

export class StudyPlanService {
  private readonly review: DueCardReader
  private readonly mastery: StudyPlanMasteryReader
  private readonly org: StudyPlanOrgReader
  private readonly questions: StudyPlanQuestionReader
  private readonly interventions: DependencyGapReader | undefined
  private readonly snapshots: StudyPlanSnapshotWriter | undefined
  private readonly now: () => Date
  private readonly horizonDays: number

  public constructor(options: StudyPlanServiceOptions) {
    this.review = options.review
    this.mastery = options.mastery
    this.org = options.org
    this.questions = options.questions
    this.interventions = options.interventions
    this.snapshots = options.snapshots
    this.now = options.now ?? (() => new Date())
    this.horizonDays = options.horizonDays ?? STUDY_PLAN_HORIZON_DAYS
  }

  /**
   * 生成（重算）滚动 7 日计划。每次调用都是全量重算 —— 同一硬输入必得
   * 同一结果，所以「每次打开重算」与「每日 0 点重算」是同一条代码路径。
   */
  public async generate(
    studentId: string,
    teachingUnitId: string,
    options: GenerateStudyPlanOptions = {}
  ): Promise<StudyPlan> {
    const facts = await this.collectHardFacts(
      studentId,
      teachingUnitId,
      options
    )
    const plan = buildStudyPlan(facts, {
      horizonDays: options.horizonDays ?? this.horizonDays,
      ...(options.maxTargetCount !== undefined
        ? { maxTargetCount: options.maxTargetCount }
        : {}),
      ...(options.maxTasks !== undefined ? { maxTasks: options.maxTasks } : {})
    })
    this.snapshots?.save(plan)
    return plan
  }

  /**
   * 收集硬事实快照。**唯一**的数据入口 —— 想审计「计划凭什么这么排」，
   * 读这个方法的返回值即可完整重放。
   */
  public async collectHardFacts(
    studentId: string,
    teachingUnitId: string,
    options: GenerateStudyPlanOptions = {}
  ): Promise<StudyPlanHardFacts> {
    const unit = this.org.getTeachingUnit(teachingUnitId)
    if (!unit) throw new TeachingUnitMissingError(teachingUnitId)

    const now = options.now ?? this.now()
    const taughtKpIds = [...unit.taughtKpIds]
    const taughtSet = new Set(taughtKpIds)
    const authorId = options.authorId ?? unit.teacherId
    const questionsPerKp = Math.min(Math.max(options.questionsPerKp ?? 5, 1), 20)

    const masteryProfile = this.mastery.getProfile(studentId)
    const dueCards = taughtSet.size
      ? this.review
          .listDue(studentId, now, DUE_CARD_SCAN_LIMIT)
          .filter((card) => taughtSet.has(card.kpId))
      : []
    const dependencyGaps = await this.collectDependencyGaps(
      studentId,
      taughtSet,
      masteryProfile
    )

    // 只为**可能进入计划**的 KP 拉题，避免整库扫描。
    const interestingKpIds = new Set<string>()
    for (const card of dueCards) interestingKpIds.add(card.kpId)
    for (const gap of dependencyGaps) interestingKpIds.add(gap.targetKp)
    for (const kpId of weakSnapshotKpIds(masteryProfile, taughtSet)) {
      interestingKpIds.add(kpId)
    }

    const questionsByKp: Record<string, string[]> = {}
    for (const kpId of [...interestingKpIds].sort()) {
      questionsByKp[kpId] = this.questions
        .list({ authorId, kpIds: [kpId], limit: questionsPerKp })
        .map((question) => question.id)
    }

    return {
      studentId,
      teachingUnitId: unit.id,
      termId: unit.termId,
      taughtKpIds,
      dueCards,
      masteryProfile,
      dependencyGaps,
      questionsByKp,
      now: now.toISOString()
    }
  }

  /**
   * 依赖链诊断。只对「**真实存在**且低于阈值」的掌握度快照发起 —— 没有快照
   * 就没有证据，绝不凭空诊断。`targetKp === weakKp` 的自指结果不算依赖链
   * 缺口（那是纯掌握度低，由 reason `mastery` 覆盖）。
   */
  private async collectDependencyGaps(
    studentId: string,
    taughtSet: ReadonlySet<string>,
    profile: MasteryProfileMap
  ): Promise<StudyPlanDependencyGap[]> {
    if (!this.interventions) return []
    const gaps: StudyPlanDependencyGap[] = []
    for (const weakKp of weakSnapshotKpIds(profile, taughtSet)) {
      const suggestion = await this.interventions.suggestNextIntervention(
        studentId,
        weakKp
      )
      if (suggestion.targetKp === weakKp) continue
      if (!taughtSet.has(suggestion.targetKp)) continue
      gaps.push({
        weakKp,
        targetKp: suggestion.targetKp,
        chain: [...suggestion.chain]
      })
    }
    return gaps
  }
}

/**
 * 已教 ∩ 有真实快照 ∩ 低于阈值的 KP，字典序（确定性）。
 *
 * 注意这里与 T06 NextPracticeService 的关键差异：T06 把「没有快照」当作
 * score 0 的薄弱点；T18 不会 —— 没有证据就没有任务（不编造铁律）。
 */
function weakSnapshotKpIds(
  profile: MasteryProfileMap,
  taughtSet: ReadonlySet<string>
): string[] {
  return Object.entries(profile)
    .filter(([kpId, snapshot]) => taughtSet.has(kpId) && snapshot.score < MASTERY_THRESHOLD)
    .map(([kpId]) => kpId)
    .sort()
}

/**
 * 把建议层文案贴到计划上。**纯函数**：返回新对象，`days` 引用原样透传，
 * 所以 tasks 不可能被 hint 改写。provenance 非 llm_inference 一律拒绝
 * （ADR-0006：LLM 产物必须自证来源）。
 */
export function attachPresentationHint(
  plan: StudyPlan,
  hint: StudyPlanPresentationHint | undefined
): StudyPlan {
  if (!hint || hint.provenance.kind !== 'llm_inference') return plan
  if (hint.text.trim() === '') return plan
  return { ...plan, presentationHint: hint }
}
