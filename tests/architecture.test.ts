// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs'
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
