// @vitest-environment node

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ExecutableAssignment } from '../server/data/assignments'
import {
  ChemEquationValidator,
  checkBalance,
  compareEquations,
  parseEquation,
  parseFormula,
  parseSpecies,
  reducedCoefficientVector
} from '../server/runner/ChemEquationValidator'

const samplesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../data/samples/chem-samples.json'
)

interface ChemSamplesFile {
  samples: Array<{
    id: string
    expectedEquation: string
    balanced?: string[]
    nonSimplestEquivalent?: string[]
    unbalanced?: string[]
    invalid?: string[]
  }>
}

const samplesFile = JSON.parse(readFileSync(samplesPath, 'utf8')) as ChemSamplesFile

function makeAssignment(expectedEquation: string): ExecutableAssignment {
  return {
    id: 'chem-equation-demo',
    title: '化学方程式配平',
    module: '化学 · 配平',
    language: 'chemistry',
    questionType: 'chem_equation',
    estimatedMinutes: 8,
    status: 'ready',
    objective: '配平化学方程式并保持原子与电荷守恒',
    scenario: '单元测试用 assignment',
    requirements: ['写出配平的化学方程式'],
    constraints: ['系数应为正整数'],
    functionSignature: expectedEquation,
    rubric: [
      {
        id: 'balance',
        label: '配平正确性',
        description: '原子守恒与电荷守恒',
        maxScore: 100
      }
    ],
    demoVariants: [],
    criteria: [
      {
        id: 'cas_check',
        kind: 'cas_check',
        label: '方程式配平',
        dimensionId: 'balance',
        visibility: 'public',
        weight: 100,
        expected: expectedEquation,
        conceptId: 'chem-balancing',
        passedMessage: '配平正确',
        failedMessage: '配平不正确'
      }
    ],
    runner: {
      kind: 'chem_equation',
      expectedEquation
    }
  }
}

describe('parseFormula', () => {
  it('parses simple formulas', () => {
    expect(Object.fromEntries(parseFormula('H2O'))).toEqual({ H: 2, O: 1 })
    expect(Object.fromEntries(parseFormula('CO2'))).toEqual({ C: 1, O: 2 })
    expect(Object.fromEntries(parseFormula('NaCl'))).toEqual({ Na: 1, Cl: 1 })
  })

  it('parses formulas with parentheses', () => {
    expect(Object.fromEntries(parseFormula('Ca(OH)2'))).toEqual({
      Ca: 1,
      O: 2,
      H: 2
    })
    expect(Object.fromEntries(parseFormula('Fe2(SO4)3'))).toEqual({
      Fe: 2,
      S: 3,
      O: 12
    })
    expect(Object.fromEntries(parseFormula('Al2(SO4)3'))).toEqual({
      Al: 2,
      S: 3,
      O: 12
    })
  })

  it('parses nested parentheses', () => {
    expect(Object.fromEntries(parseFormula('Mg3(Fe(CN)6)2'))).toEqual({
      Mg: 3,
      Fe: 2,
      C: 12,
      N: 12
    })
  })
})

describe('parseSpecies / parseEquation', () => {
  it('parses coefficients and formulas', () => {
    const sp = parseSpecies('2H2O')
    expect(sp.coefficient).toBe(2)
    expect(sp.formula).toBe('H2O')
    expect(sp.charge).toBe(0)
    expect(Object.fromEntries(sp.atoms)).toEqual({ H: 2, O: 1 })
  })

  it('parses ionic charges', () => {
    expect(parseSpecies('Fe2+').charge).toBe(2)
    expect(parseSpecies('Fe2+').formula).toBe('Fe')
    expect(parseSpecies('OH-').charge).toBe(-1)
    expect(parseSpecies('2OH-').coefficient).toBe(2)
    expect(parseSpecies('SO4^2-').charge).toBe(-2)
    expect(parseSpecies('Fe^{3+}').charge).toBe(3)
  })

  it('parses equations with = or ->', () => {
    const a = parseEquation('2H2+O2=2H2O')
    expect(a.reactants).toHaveLength(2)
    expect(a.products).toHaveLength(1)
    expect(a.reactants[0]?.coefficient).toBe(2)

    const b = parseEquation('2H2 + O2 -> 2H2O')
    expect(b.reactants).toHaveLength(2)
    expect(b.products[0]?.formula).toBe('H2O')
  })
})

describe('checkBalance', () => {
  it('accepts a balanced equation', () => {
    const eq = parseEquation('2H2+O2=2H2O')
    const report = checkBalance(eq)
    expect(report.balanced).toBe(true)
    expect(report.messages).toHaveLength(0)
  })

  it('rejects an unbalanced equation', () => {
    const eq = parseEquation('H2+O2=H2O')
    const report = checkBalance(eq)
    expect(report.balanced).toBe(false)
    expect(report.messages.some((m) => m.includes('H') || m.includes('O'))).toBe(true)
  })

  it('checks charge conservation for ionic equations', () => {
    const balanced = checkBalance(parseEquation('Fe2++2OH-=Fe(OH)2'))
    expect(balanced.balanced).toBe(true)

    const unbalanced = checkBalance(parseEquation('Fe2++OH-=Fe(OH)2'))
    expect(unbalanced.balanced).toBe(false)
    expect(unbalanced.messages.some((m) => m.includes('电荷'))).toBe(true)
  })
})

describe('compareEquations / coefficient ratio', () => {
  it('treats overall multiples as equivalent (non-simplest allowed)', () => {
    const expected = parseEquation('2H2+O2=2H2O')
    const multiple = parseEquation('4H2+2O2=4H2O')
    expect(compareEquations(multiple, expected).match).toBe(true)

    const rs = reducedCoefficientVector(multiple)
    const re = reducedCoefficientVector(expected)
    expect(rs).toEqual(re)
  })

  it('rejects different stoichiometric ratios', () => {
    const expected = parseEquation('2H2+O2=2H2O')
    // Balanced but different chemistry / wrong coeffs that still balance? 
    // H2+O2=H2O2 is balanced with different products
    const other = parseEquation('H2+O2=H2O2')
    expect(checkBalance(other).balanced).toBe(true)
    expect(compareEquations(other, expected).match).toBe(false)
  })
})

describe('ChemEquationValidator', () => {
  const runner = new ChemEquationValidator()

  it('passes a correctly balanced equation (2H2+O2=2H2O)', async () => {
    const assignment = makeAssignment('2H2+O2=2H2O')
    const result = await runner.run({
      assignment,
      submission: '2H2+O2=2H2O'
    })

    expect(result.status).toBe('completed')
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]).toMatchObject({
      id: 'cas_check',
      state: 'passed'
    })
  })

  it('fails an unbalanced equation', async () => {
    const assignment = makeAssignment('2H2+O2=2H2O')
    const result = await runner.run({
      assignment,
      submission: 'H2+O2=H2O'
    })

    expect(result.status).toBe('completed')
    expect(result.evidence[0]?.state).toBe('failed')
    expect(result.evidence[0]?.message).toMatch(/未配平|不守恒/)
  })

  it('accepts non-simplest coefficients that share the same ratio', async () => {
    const assignment = makeAssignment('2H2+O2=2H2O')
    const result = await runner.run({
      assignment,
      submission: '4H2+2O2=4H2O'
    })

    expect(result.status).toBe('completed')
    expect(result.evidence[0]?.state).toBe('passed')
  })

  it('handles formulas with parentheses', async () => {
    const assignment = makeAssignment('Ca(OH)2+2HCl=CaCl2+2H2O')
    const pass = await runner.run({
      assignment,
      submission: 'Ca(OH)2+2HCl=CaCl2+2H2O'
    })
    expect(pass.evidence[0]?.state).toBe('passed')

    const fail = await runner.run({
      assignment,
      submission: 'Ca(OH)2+HCl=CaCl2+H2O'
    })
    expect(fail.evidence[0]?.state).toBe('failed')
  })

  it('blocks illegal equations without throwing', async () => {
    const assignment = makeAssignment('2H2+O2=2H2O')
    const cases = ['???', '2H2+O2', '2H2+O2=2H2O=', '']

    for (const submission of cases) {
      const result = await runner.run({ assignment, submission })
      expect(result.status).toBe('completed')
      expect(result.evidence[0]?.state).toBe('blocked')
    }
  })

  it('accepts arrow forms and whitespace', async () => {
    const assignment = makeAssignment('2H2+O2=2H2O')
    const result = await runner.run({
      assignment,
      submission: '2H2 + O2 -> 2H2O'
    })
    expect(result.evidence[0]?.state).toBe('passed')
  })

  it('validates ionic charge conservation', async () => {
    const assignment = makeAssignment('Fe2++2OH-=Fe(OH)2')
    const pass = await runner.run({
      assignment,
      submission: 'Fe2++2OH-=Fe(OH)2'
    })
    expect(pass.evidence[0]?.state).toBe('passed')

    const fail = await runner.run({
      assignment,
      submission: 'Fe2++OH-=Fe(OH)2'
    })
    expect(fail.evidence[0]?.state).toBe('failed')
  })

  it('fails when species differ from the standard answer', async () => {
    const assignment = makeAssignment('2H2+O2=2H2O')
    const result = await runner.run({
      assignment,
      submission: 'H2+O2=H2O2'
    })
    expect(result.evidence[0]?.state).toBe('failed')
    expect(result.evidence[0]?.message).toMatch(/物种|系数/)
  })
})

describe('chem-samples.json fixtures', () => {
  const runner = new ChemEquationValidator()

  it('loads sample fixtures and exercises them through the validator', async () => {
    expect(samplesFile.samples.length).toBeGreaterThanOrEqual(3)

    for (const sample of samplesFile.samples) {
      const assignment = makeAssignment(sample.expectedEquation)

      for (const submission of sample.balanced ?? []) {
        const result = await runner.run({ assignment, submission })
        expect(result.evidence[0]?.state, `${sample.id} balanced: ${submission}`).toBe(
          'passed'
        )
      }

      for (const submission of sample.nonSimplestEquivalent ?? []) {
        const result = await runner.run({ assignment, submission })
        expect(
          result.evidence[0]?.state,
          `${sample.id} non-simplest: ${submission}`
        ).toBe('passed')
      }

      for (const submission of sample.unbalanced ?? []) {
        const result = await runner.run({ assignment, submission })
        expect(result.evidence[0]?.state, `${sample.id} unbalanced: ${submission}`).toBe(
          'failed'
        )
      }

      for (const submission of sample.invalid ?? []) {
        const result = await runner.run({ assignment, submission })
        expect(result.evidence[0]?.state, `${sample.id} invalid: ${submission}`).toBe(
          'blocked'
        )
      }
    }
  })
})
