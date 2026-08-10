import type {
  CreateAssignmentResult,
  DeployTaskTemplateInput,
  TaskTemplate,
  TaskTemplateWithKpNames
} from '../../shared/contracts'
import type { KnowledgeStore } from '../knowledge/KnowledgeStore'
import type { QuestionStore } from '../questionbank/QuestionStore'
import { seedQuestionId } from '../questionbank/seedFromAssignments'
import type { AssignmentService } from '../teacher/AssignmentService'
import type { TaskTemplateStore } from './TaskTemplateStore'

export interface TaskTemplateServiceOptions {
  store: TaskTemplateStore
  questions: QuestionStore
  assignments: AssignmentService
  knowledge: KnowledgeStore
}

export class TaskTemplateError extends Error {
  public readonly status: number
  public constructor(message: string, status = 404) {
    super(message)
    this.name = 'TaskTemplateError'
    this.status = status
  }
}

/**
 * 知识点任务模板服务（复赛 item 3）。模板 = 预置题 + 知识点绑定；部署 =
 * 复用 AssignmentService 以 handpick 布置到教学单元。铁律：模板不写分数，
 * 分数只来自题目 runner 的可复现证据（ADR-0001）。
 */
export class TaskTemplateService {
  private readonly store: TaskTemplateStore
  private readonly questions: QuestionStore
  private readonly assignments: AssignmentService
  private readonly knowledge: KnowledgeStore

  public constructor(options: TaskTemplateServiceOptions) {
    this.store = options.store
    this.questions = options.questions
    this.assignments = options.assignments
    this.knowledge = options.knowledge
  }

  public async list(): Promise<TaskTemplateWithKpNames[]> {
    const [templates, graph] = await Promise.all([
      this.store.list(),
      this.knowledge.getGraph()
    ])
    const nameById = new Map(graph.points.map((point) => [point.id, point.name]))
    return templates.map((template) => ({
      ...template,
      kpNames: template.kpIds.map((id) => nameById.get(id) ?? id)
    }))
  }

  public async get(id: string): Promise<TaskTemplateWithKpNames | undefined> {
    const templates = await this.list()
    return templates.find((template) => template.id === id)
  }

  /**
   * 一键部署：把模板对应的预置题以 handpick 布置到教学单元（assessment 模式，
   * 交卷走统一打包报告）。ownership 由 AssignmentService.create 校验
   * （unit.teacherId !== teacherId 抛 403 语义错误）。
   */
  public async deploy(
    id: string,
    input: DeployTaskTemplateInput,
    teacherId: string
  ): Promise<{ template: TaskTemplate; assignment: CreateAssignmentResult }> {
    const template = await this.get(id)
    if (!template) {
      throw new TaskTemplateError(`Task template not found: ${id}`, 404)
    }
    // 预置题在题库里带 seed: 前缀（seedQuestionsFromAssignments 确定性导入）。
    const seededQuestionId = seedQuestionId(template.questionId)
    const question = this.questions.get(seededQuestionId)
    if (!question) {
      throw new TaskTemplateError(
        `Template question missing from bank: ${seededQuestionId}`,
        404
      )
    }
    const assignment = await this.assignments.create(
      {
        teachingUnitId: input.teachingUnitId,
        mode: 'assessment',
        kind: 'handpick',
        questionIds: [question.id],
        ...(input.studentIds !== undefined
          ? { studentIds: input.studentIds }
          : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        title: `${template.name}（模板部署）`
      },
      teacherId
    )
    return { template, assignment }
  }
}
