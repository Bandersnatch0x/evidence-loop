import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TaskTemplate } from '../../shared/contracts'

export interface TaskTemplateStoreOptions {
  seedPath?: string
  seed?: unknown
}

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export const defaultTaskTemplateSeedPath = resolve(
  projectRoot,
  'data',
  'task-templates.seed.json'
)

/**
 * JSON-backed task template registry (复赛 item 3). Follows the
 * JsonKnowledgeStore pattern: a seed file is the single source of truth and a
 * `seed` override supports tests without touching disk.
 */
export class TaskTemplateStore {
  private readonly seedPath: string | null
  private readonly seed: TaskTemplate[] | null

  public constructor(options: TaskTemplateStoreOptions = {}) {
    if (options.seed !== undefined) {
      this.seed = parseTaskTemplateSeed(options.seed)
      this.seedPath = null
      return
    }
    this.seed = null
    this.seedPath = options.seedPath ?? defaultTaskTemplateSeedPath
  }

  public async list(): Promise<TaskTemplate[]> {
    if (this.seed) return this.seed.map((item) => ({ ...item }))
    const raw = await readFile(this.seedPath!, 'utf8')
    return parseTaskTemplateSeed(raw)
  }
}

export function parseTaskTemplateSeed(raw: unknown): TaskTemplate[] {
  const parsed =
    typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  if (!Array.isArray(parsed)) {
    throw new TaskTemplateSeedError(
      'Task template seed must be an array of TaskTemplate'
    )
  }
  return parsed.map((item) => {
    const template = item as Partial<TaskTemplate>
    if (
      typeof template.id !== 'string' ||
      typeof template.name !== 'string' ||
      typeof template.subject !== 'string' ||
      !Array.isArray(template.kpIds) ||
      !template.kpIds.every((kp) => typeof kp === 'string') ||
      typeof template.questionId !== 'string' ||
      typeof template.description !== 'string' ||
      typeof template.estimatedMinutes !== 'number' ||
      template.difficulty !== 1 &&
        template.difficulty !== 2 &&
        template.difficulty !== 3
    ) {
      throw new TaskTemplateSeedError(
        `Invalid task template seed entry: ${JSON.stringify(item)}`
      )
    }
    return {
      id: template.id,
      name: template.name,
      subject: template.subject,
      kpIds: template.kpIds,
      questionId: template.questionId,
      description: template.description,
      estimatedMinutes: template.estimatedMinutes,
      difficulty: template.difficulty
    }
  })
}

export class TaskTemplateSeedError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'TaskTemplateSeedError'
  }
}
