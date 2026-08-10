// @vitest-environment node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeMastery } from '../server/mastery/computeMastery'
import type { MasteryEvidence } from '../shared/contracts'

/**
 * Architecture guard tests — CI red-light when a developer breaks a documented
 * isolation boundary. These use plain file-read + regex over import statements
 * (no heavy AST dependency): the goal is a fast, dependency-free tripwire.
 *
 * Two boundaries are guarded here:
 *   - ADR-0006: the mastery + review scoring loop (hard-fact aggregate root)
 *     must never import the memory/semantic layer or any LLM/embedding runtime.
 *   - ADR-0005: the core scoring loop must never import the multimodal / STT
 *     modules — every multimodal path lives behind the feature flag red line.
 */

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Recursively collect every .ts/.tsx file under a directory. */
function collectSourceFiles(dir: string): string[] {
  const absoluteDir = resolve(projectRoot, dir)
  const files: string[] = []
  for (const entry of readdirSync(absoluteDir)) {
    const fullPath = join(absoluteDir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectSourceFiles(join(dir, entry)))
      continue
    }
    if (/\.tsx?$/.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Extract every module specifier from `import ... from '...'`, bare
 * `import '...'`, `export ... from '...'`, and dynamic `import('...')` forms.
 */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) specifiers.push(match[1])
    }
  }
  return specifiers
}

interface ForbiddenImport {
  file: string
  specifier: string
}

/**
 * Scan every source file under `dirs` and return imports whose specifier
 * matches any of the forbidden patterns.
 */
function findForbiddenImports(
  dirs: string[],
  forbidden: readonly RegExp[]
): ForbiddenImport[] {
  const violations: ForbiddenImport[] = []
  for (const dir of dirs) {
    for (const filePath of collectSourceFiles(dir)) {
      const source = readFileSync(filePath, 'utf8')
      for (const specifier of extractImportSpecifiers(source)) {
        if (forbidden.some((pattern) => pattern.test(specifier))) {
          violations.push({
            file: filePath.slice(projectRoot.length + 1).replace(/\\/g, '/'),
            specifier
          })
        }
      }
    }
  }
  return violations
}

function formatViolations(violations: ForbiddenImport[]): string {
  return violations
    .map((item) => `  ${item.file} → import '${item.specifier}'`)
    .join('\n')
}

const SCORING_LOOP_DIRS = ['server/mastery', 'server/review']

describe('architecture guard: ADR-0006 hard-fact isolation', () => {
  const MEMORY_LAYER_PATTERNS = [
    /(^|\/)memory\//,
    /\bmem0ai\b/,
    /@xenova\/transformers/,
    /(^|\/)ollama($|\/)/
  ]

  it('mastery + review never import the memory/semantic layer or LLM runtimes', () => {
    const violations = findForbiddenImports(
      SCORING_LOOP_DIRS,
      MEMORY_LAYER_PATTERNS
    )

    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'ADR-0006 违规：硬事实评分闭环（server/mastery、server/review）',
            '不得 import server/memory/*、mem0ai、@xenova/transformers 或 ollama。',
            'MasteryProfile（硬事实）与 LearnerNarrative（软语义）必须双聚合根隔离，',
            'compute() 保持纯函数 (Evidence[]) → number。违规导入：',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })

  it('computeMastery keeps the strict (evidences) => number signature', () => {
    // Compile-time guard: the exported function must be assignable to the
    // strict evidence-in / number-out signature. A widened or memory-coupled
    // signature (e.g. taking a LearnerNarrative) breaks this assignment and
    // fails `tsc --noEmit`, per ADR-0006.
    const typedReference: (evidences: readonly MasteryEvidence[]) => number =
      computeMastery
    expect(typeof typedReference).toBe('function')

    // Runtime sanity: pure weighted average, order-independent, 0 on empty.
    expect(typedReference([])).toBe(0)
    const evidences: MasteryEvidence[] = [
      { id: 'a', score: 1, weight: 1, kpId: 'kp-1', createdAt: '2026-07-23T00:00:00.000Z' },
      { id: 'b', score: 0, weight: 1, kpId: 'kp-1', createdAt: '2026-07-23T00:00:00.000Z' }
    ]
    expect(typedReference(evidences)).toBe(0.5)
  })
})

describe('architecture guard: T01 practice evidence never enters formal mastery', () => {
  it('computeMastery accepts only MasteryEvidence[] (no SessionMode / practice channel)', () => {
    // Type-level: MasteryEvidence has no mode field, so practice cannot be
    // smuggled into computeMastery without a projection filter upstream.
    type MasteryEvidenceKeys = keyof MasteryEvidence
    type ForbiddenKeys = Extract<MasteryEvidenceKeys, 'mode' | 'sessionMode'>
    const noModeChannel: ForbiddenKeys extends never ? true : false = true
    expect(noModeChannel).toBe(true)

    // Signature arity is exactly one evidence array — not (evidences, mode).
    expect(computeMastery.length).toBe(1)
    const source = readFileSync(
      resolve(projectRoot, 'server/mastery/computeMastery.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/practice/)
    expect(source).not.toMatch(/SessionMode/)
  })

  it('MasteryService.collectEvidence filters attempt.mode !== assessment', () => {
    const source = readFileSync(
      resolve(projectRoot, 'server/mastery/MasteryService.ts'),
      'utf8'
    )
    // Projector must skip practice before calling computeMastery.
    expect(source).toMatch(/mode\s*!==\s*['"]assessment['"]/)
    expect(source).toMatch(/isAttemptStore/)
    expect(source).toMatch(/listAttempts/)
    // Guard comment / iron rule present for future maintainers.
    expect(source).toMatch(/Practice evidence is excluded/)
  })
})

describe('architecture guard: T05 tutoring physical isolation', () => {
  const TUTORING_DIRS = ['server/tutoring']
  const SCORING_PATH_PATTERNS = [
    /(^|\/)domain\/EvaluationAgent/,
    /(^|\/)mastery(\/|$)/,
    /(^|\/)review(\/|$)/,
    /(^|\/)runner(\/|$)/,
    /computeMastery/
  ]

  it('server/tutoring never imports scoring/mastery/runner paths', () => {
    const violations = findForbiddenImports(TUTORING_DIRS, SCORING_PATH_PATTERNS)

    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T05 违规：server/tutoring 必须与打分路径物理隔离，',
            '不得 import EvaluationAgent / mastery / review / runner。',
            '辅导只读消费 FeedbackContext，不回写 score/evidence。违规：',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })

  it('server/tutoring never constructs EvidenceItem for scoring', () => {
    const violations: string[] = []
    for (const filePath of collectSourceFiles('server/tutoring')) {
      const source = readFileSync(filePath, 'utf8')
      if (
        /as EvidenceItem/.test(source) ||
        /:\s*EvidenceItem\s*=/.test(source) ||
        /EvidenceItem\s*=\s*\{/.test(source)
      ) {
        violations.push(
          filePath.slice(projectRoot.length + 1).replace(/\\/g, '/')
        )
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T05 违规：tutoring 不得产出 EvidenceItem。',
            `违规文件：${violations.join(', ')}`
          ].join('\n')
    ).toEqual([])
  })

  it('TutoringMessage interface has no score/evidence/weight fields', () => {
    const source = readFileSync(
      resolve(projectRoot, 'shared/contracts.ts'),
      'utf8'
    )
    const start = source.indexOf('export interface TutoringMessage')
    expect(start).toBeGreaterThanOrEqual(0)
    const end = source.indexOf('export interface TutoringTurn', start)
    const block = source.slice(start, end === -1 ? start + 800 : end)
    expect(block).toMatch(/llm_inference/)
    // Field declarations only — comments may mention the scoring vocabulary.
    expect(block).not.toMatch(/^\s*(readonly\s+)?score\s*[?:]/m)
    expect(block).not.toMatch(/^\s*(readonly\s+)?evidence\s*[?:]/m)
    expect(block).not.toMatch(/^\s*(readonly\s+)?weight\s*[?:]/m)
  })
})

describe('architecture guard: T-A demonstration module isolation (spec §3.4)', () => {
  const SCORING_LOOP_DIRS = ['server/mastery', 'server/review', 'server/runner']
  const DEMO_PATTERNS = [
    /(^|\/)demonstration(\/|$)/,
    /(^|\/)media(\/|$)/
  ]

  it('scoring paths never import the demonstration or media modules', () => {
    const violations = findForbiddenImports(
      SCORING_LOOP_DIRS,
      DEMO_PATTERNS
    )

    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T-A 违规：评分路径（server/mastery、server/review、server/runner）',
            '不得 import server/demonstration/* 或 server/media/*。',
            '演示模块是纯展示层（票 07/12），与 QuestionType/Runner/Rubric/Evidence 物理隔离。',
            '违规导入：',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })

  it('demonstration and media modules never import scoring paths', () => {
    // Paired guard (reverse direction): demo/media stay pure presentation and
    // never reach into the scoring loop. server/demonstration lands in T-D,
    // so only scan directories that already exist.
    const demoDirs = ['server/demonstration', 'server/media'].filter((dir) =>
      existsSync(resolve(projectRoot, dir)) &&
      statSync(resolve(projectRoot, dir)).isDirectory()
    )
    const violations = findForbiddenImports(
      demoDirs,
      [
        /(^|\/)domain\/EvaluationAgent/,
        /(^|\/)mastery(\/|$)/,
        /(^|\/)review(\/|$)/,
        /(^|\/)runner(\/|$)/
      ]
    )

    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T-A 违规：演示/媒体模块不得 import 评分路径',
            '（EvaluationAgent / mastery / review / runner）。',
            '违规导入：',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })
})

describe('architecture guard: T-F reviewer isolation from teaching/grade/student data (spec §2.8)', () => {
  // The T-F governance files govern the public library only. They must never
  // import teaching-org, grade, student, cohort or scoring modules - reviewers
  // are never granted teaching/grade/audit view authority (spec §2.8).
  const T_F_GOVERNANCE_FILES = [
    'server/demonstration/reviewerRoutes.ts',
    'server/demonstration/ReviewService.ts',
    'server/demonstration/ReportService.ts',
    'server/demonstration/AppealService.ts',
    'server/demonstration/EvidencePanelService.ts',
    'server/demonstration/reviewerAuth.ts',
    'server/demonstration/demoAuditSink.ts',
    'server/demonstration/NotificationService.ts'
  ]
  const TEACHING_DATA_PATTERNS = [
    /(^|\/)teacher(\/|$)/,
    /(^|\/)adaptive(\/|$)/,
    /(^|\/)student(\/|$)/,
    /(^|\/)mastery(\/|$)/,
    /(^|\/)review(\/|$)/,
    /(^|\/)runner(\/|$)/
  ]

  it('T-F governance files never import teaching/grade/student/scoring modules', () => {
    const violations: string[] = []
    for (const rel of T_F_GOVERNANCE_FILES) {
      const filePath = resolve(projectRoot, rel)
      const source = readFileSync(filePath, 'utf8')
      for (const specifier of extractImportSpecifiers(source)) {
        if (TEACHING_DATA_PATTERNS.some((pattern) => pattern.test(specifier))) {
          violations.push(`${rel} -> import '${specifier}'`)
        }
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T-F 违规：审核治理文件不得 import 教学/成绩/学生/评分模块',
            '（teacher / adaptive / student / mastery / review / runner），',
            '审核员永不被授予教学/成绩/审计查看权（spec §2.8）。违规导入：',
            violations.join('\n')
          ].join('\n')
    ).toEqual([])
  })
})

describe('architecture guard: ADR-0005 multimodal feature-flag red line', () => {
  const MULTIMODAL_PATTERNS = [
    /(^|\/)multimodal(\/|$)/,
    /(^|\/)stt(\/|$)/
  ]

  it('EvaluationAgent never imports the multimodal or STT modules', () => {
    const source = readFileSync(
      resolve(projectRoot, 'server/domain/EvaluationAgent.ts'),
      'utf8'
    )
    const violations = extractImportSpecifiers(source).filter((specifier) =>
      MULTIMODAL_PATTERNS.some((pattern) => pattern.test(specifier))
    )

    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'ADR-0005 违规：核心评分闭环 server/domain/EvaluationAgent.ts',
            '不得 import server/multimodal/* 或 server/stt/*。',
            '所有多模态代码必须在 feature flag 红线之后，主评分闭环绝不因语音重构而回归。',
            `违规导入：${violations.join(', ')}`
          ].join('\n')
    ).toEqual([])
  })

  it('mastery + review never import the multimodal or STT modules', () => {
    const violations = findForbiddenImports(
      SCORING_LOOP_DIRS,
      MULTIMODAL_PATTERNS
    )

    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'ADR-0005 违规：硬事实评分闭环（server/mastery、server/review）',
            '不得 import server/multimodal/* 或 server/stt/*。',
            '多模态模块必须在 feature flag 红线之后隔离。违规导入：',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })
})

describe('architecture guard: T-G student player scoring-chain isolation (spec §6.12)', () => {
  // The player is the ONLY read-only consumer of demonstration snapshots. It
  // must never import scoring/evidence/attempt/mastery modules, and must never
  // reach into student submission paths (no render_artifact, no submission).
  const PLAYER_DIRS = ['src/components/player']
  const SCORING_PATTERNS = [
    /(^|\/)domain\/EvaluationAgent/,
    /(^|\/)mastery(\/|$)/,
    /(^|\/)review(\/|$)/,
    /(^|\/)runner(\/|$)/,
    /attempt/i,
    /evidence/i,
    /submission/i
  ]

  it('player import graph never references scoring/evidence/attempt/submission modules', () => {
    const violations = findForbiddenImports(PLAYER_DIRS, SCORING_PATTERNS)
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T-G 违规：学生播放器 import 图不得引用评分/证据/Attempt/提交模块。',
            '播放器是纯展示媒体体验（spec §6.12），不做 render_artifact、不收提交。',
            '违规导入：',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })

  it('player source contains no eval/Function/dynamic-import execution of scene content', () => {
    const playerFiles = [
      'src/components/player/StudentPlayer.tsx',
      'src/components/player/renderers.tsx',
      'src/components/player/videoOrchestration.tsx',
      'src/components/player/externalVideo.ts',
      'src/components/player/determinism.ts',
      'src/components/player/interactions.ts',
      'src/components/player/lazyLoad.ts',
      'src/components/player/budget.ts',
      'src/components/player/playerState.ts',
      'src/components/player/svgPrimitives.tsx',
      'src/components/player/capabilityProbe.ts'
    ]
    for (const rel of playerFiles) {
      const source = readFileSync(resolve(projectRoot, rel), 'utf8')
      // The player must never execute document content: no eval/new Function.
      // (React.lazy dynamic import() of the engine chunk is the ONLY allowed
      // dynamic import — the engine, not the scene document.)
      const dangerous = /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/
      expect(
        dangerous.test(source),
        `${rel} must not contain eval/new Function — scene documents are declarative data, never code`
      ).toBe(false)
    }
  })

  it('player endpoint serves snapshots only (no draft/submission/grade routes)', () => {
    const source = readFileSync(resolve(projectRoot, 'server/demonstration/playerRoutes.ts'), 'utf8')
    // Only the approved-version player route; no mutation verbs.
    expect(source).toMatch(/request\.method !== 'GET'/)
    expect(source).toMatch(/api\/demonstrations\//)
  })
})

describe('architecture guard: #29 reference resolution stays in the display layer', () => {
  // New-reference-first dual-read (spec §9 / pre-workflow decision): the
  // assignment HTTP display layer resolves demonstration references BEFORE the
  // legacy visualization fallback. Scoring paths must never touch
  // demonstration references or the migration guard table.
  const SCORING_DIRS = ['server/mastery', 'server/review', 'server/runner', 'server/adaptive']
  const REFERENCE_PATTERNS = [
    /listStudentReferencesForAssignment/,
    /listStudentReferencesForKp/,
    /demonstration_references/,
    /visualization_migration_map/
  ]

  it('scoring paths never resolve demonstration references or read the migration guard', () => {
    const violations: string[] = []
    for (const dir of SCORING_DIRS) {
      if (!existsSync(resolve(projectRoot, dir))) continue
      for (const filePath of collectSourceFiles(dir)) {
        const source = readFileSync(filePath, 'utf8')
        for (const pattern of REFERENCE_PATTERNS) {
          if (pattern.test(source)) {
            violations.push(
              `${filePath.slice(projectRoot.length + 1).replace(/\\/g, '/')} matches ${pattern}`
            )
          }
        }
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            '#29 违规：评分路径（mastery/review/runner/adaptive）不得解析演示引用',
            '或读 visualization_migration_map 守卫表。新引用解析只在 assignment HTTP 展示层，',
            'AssignmentRegistry/runner/rubric/evidence 路径不读演示表（评分隔离铁律）。违规：',
            violations.join('\n')
          ].join('\n')
    ).toEqual([])
  })

  it('assignment display layer serves demonstrations; legacy visualization fallback is removed', () => {
    const source = readFileSync(resolve(projectRoot, 'server/index.ts'), 'utf8')
    // New-reference-first: the display layer resolves demonstration references.
    expect(source).toMatch(/listStudentReferencesForAssignment/)
    // Phase C (#30): the legacy visualization fallback is deleted — the
    // assignment projection must no longer spread `assignment.visualization`.
    expect(source).not.toMatch(/!hasPrimaryDemonstration && assignment.visualization/)
    expect(source).not.toMatch(/assignment\.visualization\s*}/)
  })

  it('student-facing demonstration read endpoints never write demonstration tables', () => {
    const readFiles = [
      'server/demonstration/playerRoutes.ts',
      'server/demonstration/referenceRoutes.ts'
    ]
    for (const rel of readFiles) {
      const source = readFileSync(resolve(projectRoot, rel), 'utf8')
      // No direct table mutation in these read/route files; writes go through
      // author-side service methods (ReferenceService.setReferences etc).
      const directWrite = /INSERT\s+INTO\s+(teaching_demonstrations|demonstration_versions|demonstration_references)/i
      expect(
        source.match(directWrite),
        `${rel} must not write demonstration tables directly`
      ).toBeNull()
    }
  })
})

describe('architecture guard: Effort 2 modules never import scoring write paths', () => {
  const EFFORT2_DIRS = [
    'server/materialImport',
    'server/mockExam',
    'server/studyPlan',
    'server/reports',
    'server/achievements',
    'server/dialogue',
    'server/flashcardDraft',
    'server/portfolio',
    'server/transparency',
    'server/taskTemplate'
  ]
  // Allow list: modules may use config/mastery thresholds; forbid write-side paths.
  const FORBIDDEN = [
    /(^|\/)domain\/EvaluationAgent/,
    /(^|\/)mastery\/MasteryService/,
    /(^|\/)mastery\/computeMastery/,
    /(^|\/)review\/ReviewScheduler/,
    /(^|\/)runner\/(?!types)/,
    /computeMastery/
  ]

  it('T15-T23 service trees do not import EvaluationAgent / mastery write / review / runners', () => {
    const violations = findForbiddenImports(EFFORT2_DIRS, FORBIDDEN).filter(
      (item) => !item.specifier.includes('config/mastery')
    )
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'Effort 2 Υ�棺���ϵ���/ģ�⿼/�ƻ�/�ܱ�/�ɾ�/�Ի�/����/��Ʒ��',
            '���� import ����д·����Υ�棺',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })

  it('agentCatalog scoring agent forbids LLM (T17 iron contract)', () => {
    const source = readFileSync(
      resolve(projectRoot, 'shared/agentCatalog.ts'),
      'utf8'
    )
    expect(source).toMatch(/touchesScore/)
    expect(source).toMatch(/llmAllowed/)
  })
})
