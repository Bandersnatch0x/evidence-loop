// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ExecutableAssignment, EssayRunnerSpec } from '../server/data/assignments'
import {
  analyzeEssay,
  countWords,
  detectLintIssues,
  EssayRunner,
  splitParagraphs,
  splitSentences
} from '../server/runner/EssayRunner'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

interface EssaySampleFile {
  spec: EssayRunnerSpec
  samples: { id: string; label: string; description: string; text: string }[]
}

const sampleFile = JSON.parse(
  readFileSync(resolve(projectRoot, 'data/samples/essay-samples.json'), 'utf8')
) as EssaySampleFile

function sampleText(id: string): string {
  const found = sampleFile.samples.find((item) => item.id === id)
  if (!found) throw new Error(`Missing essay sample: ${id}`)
  return found.text
}

/** Minimal essay assignment; only fields the runner reads matter. */
function createEssayAssignment(spec: EssayRunnerSpec): ExecutableAssignment {
  return {
    id: 'essay-demo',
    title: '议论文：论坚持与成长',
    module: '语文 · 议论文写作',
    language: 'chinese',
    questionType: 'essay',
    estimatedMinutes: 30,
    status: 'ready',
    objective: '围绕坚持与成长写一篇结构完整的议论文。',
    scenario: '演示用作文题。',
    requirements: ['明确论点', '提供论据', '给出结论'],
    constraints: ['客观维度入分，主观维度仅供教师参考'],
    functionSignature: '',
    rubric: [],
    demoVariants: [],
    criteria: [],
    runner: spec
  }
}

describe('EssayRunner objective metrics', () => {
  const spec = sampleFile.spec

  it('produces only objective structural_metric/lint evidence, no scores', async () => {
    const runner = new EssayRunner()
    const result = await runner.run({
      assignment: createEssayAssignment(spec),
      submission: sampleText('well-structured')
    })

    expect(result.status).toBe('completed')
    const ids = result.evidence.map((item) => item.id).sort()
    expect(ids).toEqual(
      [
        'keyword-coverage',
        'paragraph-count',
        'sentence-length',
        'spelling-punctuation',
        'structure-completeness',
        'word-count'
      ].sort()
    )
    // RunnerEvidence carries no numeric score/weight field at all.
    for (const item of result.evidence) {
      expect(item).not.toHaveProperty('score')
      expect(item).not.toHaveProperty('weight')
    }
  })

  it('is deterministic: same input yields identical evidence (同入同出)', async () => {
    const assignment = createEssayAssignment(spec)
    const runner = new EssayRunner()
    const submission = sampleText('well-structured')

    const first = await runner.run({ assignment, submission })
    const second = await runner.run({ assignment, submission })

    // durationMs is timing-dependent; compare the evidence payload only.
    expect(second.evidence).toEqual(first.evidence)
    expect(second.status).toBe(first.status)
  })

  it('passes the well-structured sample on structure and keywords', async () => {
    const runner = new EssayRunner()
    const result = await runner.run({
      assignment: createEssayAssignment(spec),
      submission: sampleText('well-structured')
    })

    const byId = new Map(result.evidence.map((item) => [item.id, item]))
    expect(byId.get('structure-completeness')?.state).toBe('passed')
    expect(byId.get('keyword-coverage')?.state).toBe('passed')
    expect(byId.get('word-count')?.state).toBe('passed')
  })

  it('flags the missing-structure sample on structure, length, and keywords', async () => {
    const runner = new EssayRunner()
    const result = await runner.run({
      assignment: createEssayAssignment(spec),
      submission: sampleText('missing-structure')
    })

    const byId = new Map(result.evidence.map((item) => [item.id, item]))
    expect(byId.get('structure-completeness')?.state).toBe('failed')
    expect(byId.get('word-count')?.state).toBe('failed')
    expect(byId.get('keyword-coverage')?.state).toBe('failed')
  })

  it('reports partial keyword coverage as failed with a miss list', async () => {
    const runner = new EssayRunner()
    const result = await runner.run({
      assignment: createEssayAssignment(spec),
      submission: sampleText('keyword-partial')
    })

    const keyword = result.evidence.find((item) => item.id === 'keyword-coverage')
    expect(keyword?.state).toBe('failed')
    expect(keyword?.message).toContain('成长')
  })

  it('rejects an empty submission', async () => {
    const runner = new EssayRunner()
    const result = await runner.run({
      assignment: createEssayAssignment(spec),
      submission: '   \n  '
    })

    expect(result.status).toBe('rejected')
    expect(result.evidence).toHaveLength(0)
  })

  it('fails cleanly when handed a non-essay spec', async () => {
    const runner = new EssayRunner()
    const assignment = createEssayAssignment(spec)
    const wrong = {
      ...assignment,
      runner: { functionName: 'f', maxAstNodes: 10, testCases: [] }
    } as unknown as ExecutableAssignment

    const result = await runner.run({ assignment: wrong, submission: 'text' })
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('EssayRunnerSpec')
  })
})

describe('EssayRunner pure helpers', () => {
  it('counts CJK ideographs and Latin runs deterministically', () => {
    expect(countWords('你好 world 123')).toBe(4)
    expect(countWords('你好 world 123')).toBe(countWords('你好 world 123'))
  })

  it('splits paragraphs on blank lines', () => {
    expect(splitParagraphs('一段。\n\n二段。\n\n\n三段。')).toHaveLength(3)
  })

  it('splits sentences on CJK/Latin terminators', () => {
    expect(splitSentences('你好。世界！好吗？')).toHaveLength(3)
  })

  it('detects repeated punctuation as a lint issue', () => {
    expect(detectLintIssues('这样对吗，，').length).toBeGreaterThan(0)
  })

  it('analyzeEssay returns identical metrics for identical input', () => {
    const text = sampleText('well-structured')
    expect(analyzeEssay(text, ['坚持'])).toEqual(analyzeEssay(text, ['坚持']))
  })
})
