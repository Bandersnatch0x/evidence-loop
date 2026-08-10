// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { CreateAssignmentResult } from '../shared/contracts'
import { JsonKnowledgeStore } from '../server/knowledge/KnowledgeStore'
import { TaskTemplateService } from '../server/taskTemplate'
import {
  TaskTemplateStore,
  TaskTemplateSeedError,
  parseTaskTemplateSeed
} from '../server/taskTemplate'
import type { QuestionStore } from '../server/questionbank/QuestionStore'
import type { AssignmentService } from '../server/teacher/AssignmentService'

const SEED = [
  {
    id: 'tpl.a',
    name: '模板 A',
    subject: 'math',
    kpIds: ['kp.math.algebra.simplify'],
    questionId: 'expression-perfect-square',
    description: '展开完全平方',
    estimatedMinutes: 8,
    difficulty: 2
  }
]

function sampleAssignmentResult(): CreateAssignmentResult {
  return {
    teachingUnitId: 'tu-1',
    kind: 'handpick',
    paperId: 'paper-1',
    attemptIds: ['att-1'],
    studentIds: ['student-1'],
    questionIds: ['expression-perfect-square'],
    mode: 'assessment',
    createdAt: '2026-08-10T00:00:00.000Z'
  }
}

function buildService(overrides: {
  templates?: unknown[]
  questionExists?: boolean
} = {}) {
  const store = new TaskTemplateStore({
    seed: overrides.templates ?? SEED
  })
  const questions = {
    get: vi.fn((id: string) =>
      overrides.questionExists === false ? undefined : { id }
    )
  }
  const assignments = {
    create: vi.fn(
      (): Promise<CreateAssignmentResult> => Promise.resolve(sampleAssignmentResult())
    )
  }
  const knowledge = new JsonKnowledgeStore()
  const service = new TaskTemplateService({
    store,
    questions: questions as unknown as QuestionStore,
    assignments: assignments as unknown as AssignmentService,
    knowledge
  })
  return { service, questions, assignments }
}

describe('TaskTemplateStore', () => {
  it('parses the built-in seed file into 3 templates', async () => {
    const store = new TaskTemplateStore()
    const templates = await store.list()
    expect(templates.map((item) => item.id)).toEqual([
      'tpl.math.simplify',
      'tpl.physics.ohm_law',
      'tpl.chemistry.equation_balance'
    ])
    expect(templates[0]!).toMatchObject({
      subject: 'math',
      kpIds: ['kp.math.algebra.simplify'],
      questionId: 'expression-perfect-square'
    })
  })

  it('rejects a malformed seed entry', () => {
    expect(() =>
      parseTaskTemplateSeed([{ id: 'broken' }])
    ).toThrow(TaskTemplateSeedError)
  })
})

describe('TaskTemplateService', () => {
  it('lists templates enriched with kp names from the knowledge graph', async () => {
    const { service } = buildService()
    const templates = await service.list()
    expect(templates).toHaveLength(1)
    expect(templates[0]!.kpNames).toEqual(['代数式化简'])
    expect(templates[0]!.name).toBe('模板 A')
  })

  it('falls back to the kp id when the graph has no name', async () => {
    const { service } = buildService({
      templates: [
        { ...SEED[0], id: 'tpl.unknown', kpIds: ['kp.no.such.point'] }
      ]
    })
    const [template] = await service.list();
    expect(template).toBeDefined()
    expect(template!.kpNames).toEqual(['kp.no.such.point'])
  })

  it('get returns undefined for an unknown template', async () => {
    const { service } = buildService()
    expect(await service.get('tpl.nope')).toBeUndefined()
  })

  it('deploy hands a handpick assessment assignment to AssignmentService', async () => {
    const { service, questions, assignments } = buildService()
    const result = await service.deploy(
      'tpl.a',
      { teachingUnitId: 'tu-1' },
      'teacher-1'
    )
    expect(questions.get).toHaveBeenCalledWith('seed:expression-perfect-square')
    expect(assignments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        teachingUnitId: 'tu-1',
        mode: 'assessment',
        kind: 'handpick',
        questionIds: ['seed:expression-perfect-square'],
        title: '模板 A（模板部署）'
      }),
      'teacher-1'
    )
    expect(result.template.id).toBe('tpl.a')
    expect(result.assignment.paperId).toBe('paper-1')
  })

  it('deploy forwards studentIds and dueAt when present', async () => {
    const { service, assignments } = buildService()
    await service.deploy(
      'tpl.a',
      { teachingUnitId: 'tu-1', studentIds: ['s1'], dueAt: '2026-08-30T00:00:00.000Z' },
      'teacher-1'
    )
    expect(assignments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        studentIds: ['s1'],
        dueAt: '2026-08-30T00:00:00.000Z'
      }),
      'teacher-1'
    )
  })

  it('deploy rejects an unknown template', async () => {
    const { service } = buildService()
    await expect(
      service.deploy('tpl.nope', { teachingUnitId: 'tu-1' }, 'teacher-1')
    ).rejects.toThrow('Task template not found')
  })

  it('deploy rejects a template whose question is missing from the bank', async () => {
    const { service } = buildService({ questionExists: false })
    await expect(
      service.deploy('tpl.a', { teachingUnitId: 'tu-1' }, 'teacher-1')
    ).rejects.toThrow('Template question missing from bank')
  })
})
