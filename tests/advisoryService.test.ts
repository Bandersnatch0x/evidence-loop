// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AdvisorySuggestion } from '../shared/contracts'
import type { EssayRunnerSpec, ExecutableAssignment } from '../server/data/assignments'
import { EssayRunner } from '../server/runner/EssayRunner'
import {
  AdvisoryService,
  RuleBasedAdvisoryProvider,
  SUBJECTIVE_DIMENSIONS,
  type AdvisoryProvider,
  type AdvisoryProviderInput
} from '../server/advisory/AdvisoryService'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

interface EssaySampleFile {
  spec: EssayRunnerSpec
  samples: { id: string; text: string }[]
}

const sampleFile = JSON.parse(
  readFileSync(resolve(projectRoot, 'data/samples/essay-samples.json'), 'utf8')
) as EssaySampleFile

function sampleText(id: string): string {
  const found = sampleFile.samples.find((item) => item.id === id)
  if (!found) throw new Error(`Missing essay sample: ${id}`)
  return found.text
}

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
    requirements: ['明确论点'],
    constraints: ['客观维度入分，主观维度仅供教师参考'],
    functionSignature: '',
    rubric: [],
    demoVariants: [],
    criteria: [],
    runner: spec
  }
}

const assignment = createEssayAssignment(sampleFile.spec)

describe('AdvisoryService', () => {
  it('produces one suggestion per subjective dimension', async () => {
    const service = new AdvisoryService()
    const suggestions = await service.suggest({
      assignment,
      submission: sampleText('well-structured')
    })

    expect(suggestions).toHaveLength(SUBJECTIVE_DIMENSIONS.length)
    const labels = suggestions.map((item) => item.dimensionLabel)
    for (const dimension of SUBJECTIVE_DIMENSIONS) {
      expect(labels).toContain(dimension)
    }
  })

  it('stamps every suggestion with llm_inference provenance and a teacher gate', async () => {
    const service = new AdvisoryService()
    const suggestions = await service.suggest({
      assignment,
      submission: sampleText('well-structured')
    })

    for (const suggestion of suggestions) {
      expect(suggestion.provenance.kind).toBe('llm_inference')
      expect(suggestion.provenance.model).toBe('advisory-rules.v1')
      expect(suggestion.provenance.extractedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T/
      )
      expect(suggestion.requiresTeacherConfirmation).toBe(true)
    }
  })

  it('never emits a score/weight field — advice is not a grade (架构铁律)', async () => {
    const service = new AdvisoryService()
    const suggestions = await service.suggest({
      assignment,
      submission: sampleText('well-structured')
    })

    for (const suggestion of suggestions) {
      expect(suggestion).not.toHaveProperty('score')
      expect(suggestion).not.toHaveProperty('weight')
      expect(suggestion).not.toHaveProperty('earnedScore')
      expect(suggestion).not.toHaveProperty('points')
    }
  })

  it('does not influence the objective runner score (client separation)', async () => {
    const runner = new EssayRunner()
    const service = new AdvisoryService()
    const submission = sampleText('well-structured')

    const before = await runner.run({ assignment, submission })
    // Advisory runs on the same submission…
    const suggestions = await service.suggest({ assignment, submission })
    // …and the objective evidence is byte-identical afterwards.
    const after = await runner.run({ assignment, submission })

    expect(suggestions.length).toBeGreaterThan(0)
    expect(after.evidence).toEqual(before.evidence)
  })

  it('adapts advice to the objective metrics (missing structure)', async () => {
    const service = new AdvisoryService()
    const suggestions = await service.suggest({
      assignment,
      submission: sampleText('missing-structure')
    })

    const thesis = suggestions.find((item) => item.dimensionLabel === '立意与观点')
    const conclusion = suggestions.find(
      (item) => item.dimensionLabel === '结构与逻辑'
    )
    expect(thesis?.suggestion).toContain('未检测到')
    expect(conclusion?.suggestion).toContain('结论段')
  })

  it('assigns stable, unique ids across suggestions', async () => {
    const service = new AdvisoryService()
    const first = await service.suggest({
      assignment,
      submission: sampleText('well-structured')
    })
    const second = await service.suggest({
      assignment,
      submission: sampleText('well-structured')
    })

    const ids = first.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(second.map((item) => item.id)).toEqual(ids)
  })

  it('re-stamps a custom provider draft as teacher-gated advice, dropping any injected score', async () => {
    const injected = {
      dimensionLabel: '立意与观点',
      suggestion: '这是一条来自自定义 provider 的建议。',
      confidence: 0.9,
      // A hostile provider tries to smuggle a score in — it must not survive.
      score: 95
    }
    const rogueProvider: AdvisoryProvider = {
      model: 'test-provider.v0',
      compose() {
        return [injected]
      }
    }
    const service = new AdvisoryService(rogueProvider)
    const suggestions = await service.suggest({
      assignment,
      submission: sampleText('well-structured')
    })

    const only = suggestions[0]
    expect(only).toBeDefined()
    const result: AdvisorySuggestion = only as AdvisorySuggestion
    expect(result).not.toHaveProperty('score')
    expect(result.provenance.model).toBe('test-provider.v0')
    expect(result.provenance.confidence).toBe(0.9)
    expect(result.requiresTeacherConfirmation).toBe(true)
  })

  it('RuleBasedAdvisoryProvider is deterministic for identical metrics', () => {
    const provider = new RuleBasedAdvisoryProvider()
    const submission = sampleText('keyword-partial')
    const input: AdvisoryProviderInput = {
      submission,
      assignment,
      metrics: {
        wordCount: 10,
        paragraphCount: 3,
        sentenceCount: 3,
        averageSentenceLength: 20,
        keywordHits: ['坚持'],
        keywordMisses: ['成长'],
        lintIssues: [],
        hasThesis: true,
        hasSupport: true,
        hasConclusion: true
      }
    }
    expect(provider.compose(input)).toEqual(provider.compose(input))
  })
})
