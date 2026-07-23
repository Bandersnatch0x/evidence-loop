// @vitest-environment node

/**
 * Ticket 031: multi-subject end-to-end integration.
 * Proves every question type closes the EvaluationAgent scoring loop, all 9
 * academic subjects have a scorable objective demo, essay objective evidence
 * scores while AdvisoryLayer stays teacher-gated, and history/politics
 * discourse never lets advisory contribute formal points (ADR-0008).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdvisoryService } from '../server/advisory/AdvisoryService'
import { createAssignmentRegistry } from '../server/data/assignments'
import { createKnowledgeBase } from '../server/data/knowledge'
import { EvaluationAgent } from '../server/domain/EvaluationAgent'
import { LocalFeedbackGenerator } from '../server/domain/feedback'
import { createRunnerRegistry } from '../server/runner/RunnerRegistry'
import type { CodeRunner, RunnerResult } from '../server/runner/types'
import type { SubjectLanguage } from '../shared/contracts'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

interface SeedFile {
  points: { id: string }[]
}

const seed: SeedFile = JSON.parse(
  readFileSync(resolve(projectRoot, 'data/knowledge-points.seed.json'), 'utf8')
) as SeedFile
const seedIds = new Set(seed.points.map((point) => point.id))

/** Code path must stay wired; other types use real validators. */
class StubCodeRunner implements CodeRunner {
  public readonly name = 'stub-code'

  public run(): Promise<RunnerResult> {
    return Promise.resolve({
      status: 'completed',
      durationMs: 1,
      evidence: [
        { id: 'basic-average', state: 'passed', actual: '90', message: 'ok' },
        { id: 'decimal-average', state: 'passed', actual: '80', message: 'ok' },
        { id: 'negative-average', state: 'passed', actual: '0', message: 'ok' },
        { id: 'empty-input', state: 'passed', actual: '0', message: 'ok' },
        { id: 'single-score', state: 'passed', actual: '86', message: 'ok' },
        { id: 'required-function', state: 'passed', message: 'ok' },
        { id: 'no-side-effects', state: 'passed', message: 'ok' },
        { id: 'focused-function', state: 'passed', message: 'ok' }
      ]
    })
  }
}

function createAgent(): EvaluationAgent {
  return new EvaluationAgent({
    assignments: createAssignmentRegistry(),
    knowledge: createKnowledgeBase(),
    runners: createRunnerRegistry(new StubCodeRunner()),
    feedback: new LocalFeedbackGenerator(),
    advisory: new AdvisoryService()
  })
}

function formalScoreFromEvidence(
  evidence: { state: string; weight: number }[]
): number {
  return evidence.reduce(
    (total, item) => total + (item.state === 'passed' ? item.weight : 0),
    0
  )
}

const ACADEMIC_SUBJECTS: readonly SubjectLanguage[] = [
  'math',
  'physics',
  'chemistry',
  'chinese',
  'english',
  'biology',
  'politics',
  'history',
  'geography'
]

/** One objective (non-essay) demo per subject that uses pure objective validators. */
const OBJECTIVE_BY_SUBJECT: ReadonlyArray<{
  subject: Exclude<SubjectLanguage, 'python' | 'chinese'>
  id: string
  correct: string
  wrong: string
}> = [
  { subject: 'math', id: 'choice-algebra-simplify', correct: 'B', wrong: 'A' },
  { subject: 'physics', id: 'numeric-ohm-law', correct: '24', wrong: '12' },
  {
    subject: 'chemistry',
    id: 'fill-blank-water-formula',
    correct: 'H2O',
    wrong: 'H2O2'
  },
  {
    subject: 'english',
    id: 'choice-english-present-perfect',
    correct: 'C',
    wrong: 'A'
  },
  {
    subject: 'biology',
    id: 'fill-blank-biology-mitochondria',
    correct: '线粒体',
    wrong: '叶绿体'
  },
  {
    subject: 'politics',
    id: 'choice-politics-basic-rights',
    correct: 'B',
    wrong: 'A'
  },
  {
    subject: 'history',
    id: 'choice-history-opium-war',
    correct: 'A',
    wrong: 'C'
  },
  {
    subject: 'geography',
    id: 'numeric-geography-tropic',
    correct: '23.5',
    wrong: '0'
  }
]

describe('multi-subject integration (ticket 031)', () => {
  const registry = createAssignmentRegistry()

  it('covers all 9 academic subjects with at least one ready objective assignment', () => {
    const bySubject = new Map<string, string[]>()
    for (const summary of registry.list()) {
      if (summary.status !== 'ready') continue
      if (summary.questionType === 'essay') continue
      const list = bySubject.get(summary.language) ?? []
      list.push(summary.id)
      bySubject.set(summary.language, list)
    }

    for (const subject of ACADEMIC_SUBJECTS) {
      if (subject === 'chinese') {
        // Chinese demo is essay (objective structural dims + advisory).
        // Still require a ready assignment for the subject.
        const essays = registry
          .list()
          .filter(
            (item) =>
              item.language === 'chinese' && item.status === 'ready'
          )
        expect(essays.length, `subject ${subject}`).toBeGreaterThanOrEqual(1)
        continue
      }
      const ids = bySubject.get(subject) ?? []
      expect(ids.length, `objective demo missing for ${subject}`).toBeGreaterThanOrEqual(
        1
      )
    }
  })

  it('every criterion conceptId resolves in knowledge-points.seed.json', () => {
    for (const summary of registry.list()) {
      const assignment = registry.get(summary.id)
      expect(assignment).toBeDefined()
      for (const criterion of assignment?.criteria ?? []) {
        // Legacy code-task concepts are not in the kp.* seed.
        if (!criterion.conceptId.startsWith('kp.')) continue
        expect(
          seedIds.has(criterion.conceptId),
          `${summary.id} → ${criterion.conceptId}`
        ).toBe(true)
      }
    }
  })

  describe('each question type: full evaluate loop', () => {
    const cases: {
      type: string
      assignmentId: string
      correct: string
      wrong: string
      expectedPassScore: number
    }[] = [
      {
        type: 'choice',
        assignmentId: 'choice-algebra-simplify',
        correct: 'B',
        wrong: 'A',
        expectedPassScore: 100
      },
      {
        type: 'fill_blank',
        assignmentId: 'fill-blank-water-formula',
        correct: 'H2O',
        wrong: 'H2O2',
        expectedPassScore: 100
      },
      {
        type: 'numeric',
        assignmentId: 'numeric-ohm-law',
        correct: '24',
        wrong: '12',
        expectedPassScore: 100
      },
      {
        type: 'expression',
        assignmentId: 'expression-perfect-square',
        correct: 'x^2+2*x+1',
        wrong: 'x^2+1',
        expectedPassScore: 100
      },
      {
        type: 'chem_equation',
        assignmentId: 'chem-water-formation',
        correct: '2H2+O2=2H2O',
        wrong: 'H2+O2=H2O',
        expectedPassScore: 100
      },
      {
        type: 'code',
        assignmentId: 'python-average',
        correct:
          'def calculate_average(scores):\n    return 0 if not scores else sum(scores)/len(scores)',
        wrong: 'def calculate_average(scores):\n    return sum(scores)/len(scores)',
        expectedPassScore: 100
      }
    ]

    for (const item of cases) {
      it(`${item.type}: completed + non-empty evidence; correct full / wrong lower`, async () => {
        const agent = createAgent()
        const pass = await agent.evaluate({
          assignmentId: item.assignmentId,
          code: item.correct
        })
        expect(pass.status).toBe('completed')
        expect(pass.evidence.length).toBeGreaterThan(0)
        expect(pass.score).toBe(item.expectedPassScore)
        expect(pass.score).toBe(formalScoreFromEvidence(pass.evidence))

        // Wrong path: stub code always passes, so skip wrong for code.
        if (item.type === 'code') return

        const fail = await agent.evaluate({
          assignmentId: item.assignmentId,
          code: item.wrong
        })
        expect(fail.status).toBe('completed')
        expect(fail.evidence.length).toBeGreaterThan(0)
        expect(fail.score).toBeLessThan(pass.score)
        expect(fail.evidence.some((row) => row.state === 'failed')).toBe(true)
      })
    }
  })

  it('essay (chinese): objective evidence scores + advisory with teacher gate', async () => {
    const agent = createAgent()
    const assignment = registry.get('essay-perseverance-growth')
    expect(assignment).toBeDefined()
    const good =
      assignment?.demoVariants.find((item) => item.id === 'well-structured')
        ?.code ?? ''
    const weak =
      assignment?.demoVariants.find((item) => item.id === 'missing-structure')
        ?.code ?? ''

    const pass = await agent.evaluate({
      assignmentId: 'essay-perseverance-growth',
      code: good
    })
    expect(pass.status).toBe('completed')
    expect(pass.evidence.length).toBeGreaterThan(0)
    expect(pass.evidence.every((item) => item.state === 'passed' || item.state === 'failed' || item.state === 'blocked')).toBe(
      true
    )
    expect(pass.score).toBe(formalScoreFromEvidence(pass.evidence))
    expect(pass.score).toBeGreaterThan(0)
    expect(pass.advisory).toBeDefined()
    expect(pass.advisory?.length).toBeGreaterThan(0)
    for (const suggestion of pass.advisory ?? []) {
      expect(suggestion.requiresTeacherConfirmation).toBe(true)
      expect(suggestion.provenance.kind).toBe('llm_inference')
      expect('score' in suggestion).toBe(false)
      expect('weight' in suggestion).toBe(false)
    }
    expect(pass.trace.some((step) => step.tool === 'advisory.suggest')).toBe(
      true
    )

    const fail = await agent.evaluate({
      assignmentId: 'essay-perseverance-growth',
      code: weak
    })
    expect(fail.status).toBe('completed')
    expect(fail.score).toBeLessThan(pass.score)
    expect(fail.advisory?.length).toBeGreaterThan(0)
  })

  it('subjective history/politics discourse: AdvisoryLayer never produces formal score', async () => {
    const agent = createAgent()
    for (const id of [
      'essay-history-source-analysis',
      'essay-politics-social-rules'
    ]) {
      const assignment = registry.get(id)
      expect(assignment, id).toBeDefined()
      expect(assignment?.questionType).toBe('essay')
      const good =
        assignment?.demoVariants.find((item) => item.id === 'well-structured')
          ?.code ?? ''

      const result = await agent.evaluate({ assignmentId: id, code: good })
      expect(result.status).toBe('completed')
      // Formal score is exclusively the sum of passed evidence weights.
      expect(result.score).toBe(formalScoreFromEvidence(result.evidence))
      // Advisory is present, teacher-gated, and structurally non-scoring.
      expect(result.advisory?.length).toBeGreaterThan(0)
      for (const suggestion of result.advisory ?? []) {
        expect(suggestion.requiresTeacherConfirmation).toBe(true)
        expect(suggestion.provenance.kind).toBe('llm_inference')
        expect('score' in suggestion).toBe(false)
        expect('weight' in suggestion).toBe(false)
      }
      // Advisory path is traced; advisory does not appear in evidence ids used for score.
      expect(result.trace.some((step) => step.tool === 'advisory.suggest')).toBe(
        true
      )
      expect(result.provenance.kind).toBe('evidence')
      if (result.provenance.kind === 'evidence') {
        const evidenceIds = new Set(result.evidence.map((item) => item.id))
        for (const evidenceId of result.provenance.evidenceIds) {
          expect(evidenceIds.has(evidenceId)).toBe(true)
          expect(evidenceId.startsWith('advisory-')).toBe(false)
        }
      }
    }
  })

  it('new subject objective demos score correctly (pass / fail)', async () => {
    const agent = createAgent()
    for (const fixture of OBJECTIVE_BY_SUBJECT) {
      const pass = await agent.evaluate({
        assignmentId: fixture.id,
        code: fixture.correct
      })
      expect(pass.status, fixture.subject).toBe('completed')
      expect(pass.score, fixture.subject).toBe(100)
      expect(pass.evidence.length, fixture.subject).toBeGreaterThan(0)

      const fail = await agent.evaluate({
        assignmentId: fixture.id,
        code: fixture.wrong
      })
      expect(fail.status, fixture.subject).toBe('completed')
      expect(fail.score, fixture.subject).toBe(0)
    }
  })
})
