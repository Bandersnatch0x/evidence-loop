import type { QuestionType } from '../../../shared/contracts'

/**
 * Default RunnerSpec payloads for the T03 hand-entry form.
 * Shapes must match `questionValidation.validatePayload` so a blank form can
 * submit after the teacher fills only the type-specific answer fields.
 */
export function defaultPayload(questionType: QuestionType): unknown {
  switch (questionType) {
    case 'choice':
      return { kind: 'choice', correctOptionIds: ['A'] }
    case 'fill_blank':
      return { kind: 'fill_blank', acceptedAnswers: [''] }
    case 'numeric':
      return { kind: 'numeric', expected: 0, tolerance: 0.01 }
    case 'expression':
      return { kind: 'expression', expectedLatex: '' }
    case 'chem_equation':
      return { kind: 'chem_equation', expectedEquation: '' }
    case 'essay':
      return { kind: 'essay', minWords: 100 }
    case 'code':
      return {
        functionName: 'solve',
        maxAstNodes: 80,
        testCases: [{ id: 't1', args: [], expected: 0 }]
      }
    case 'geometry':
      // Geometry questions are authored in assignments.ts, not via this form;
      // emit a placeholder so the switch stays exhaustive.
      return { kind: 'geometry', vertices: {}, sectionVertexIds: [] }
    default: {
      const exhaustive: never = questionType
      return exhaustive
    }
  }
}

/** Coerce form-field strings into a type-matched payload object. */
export function buildPayload(
  questionType: QuestionType,
  fields: PayloadFormFields
): unknown {
  switch (questionType) {
    case 'choice':
      return {
        kind: 'choice',
        correctOptionIds: splitCsv(fields.choiceCorrectIds)
      }
    case 'fill_blank':
      return {
        kind: 'fill_blank',
        acceptedAnswers: splitCsv(fields.fillAccepted)
      }
    case 'numeric':
      return {
        kind: 'numeric',
        expected: Number(fields.numericExpected),
        tolerance: Number(fields.numericTolerance)
      }
    case 'expression':
      return {
        kind: 'expression',
        expectedLatex: fields.expressionLatex
      }
    case 'chem_equation':
      return {
        kind: 'chem_equation',
        expectedEquation: fields.chemEquation
      }
    case 'essay':
      return {
        kind: 'essay',
        minWords:
          fields.essayMinWords.trim() === ''
            ? undefined
            : Number(fields.essayMinWords),
        requiredKeywords:
          fields.essayKeywords.trim() === ''
            ? undefined
            : splitCsv(fields.essayKeywords)
      }
    case 'code':
      return {
        functionName: fields.codeFunctionName.trim() || 'solve',
        maxAstNodes: Number(fields.codeMaxAstNodes) || 80,
        testCases: parseCodeTestCases(fields.codeTestCasesJson)
      }
    case 'geometry':
      // Not hand-entered via this form; return the default payload.
      return defaultPayload('geometry')
    default: {
      const exhaustive: never = questionType
      return exhaustive
    }
  }
}

export interface PayloadFormFields {
  choiceCorrectIds: string
  fillAccepted: string
  numericExpected: string
  numericTolerance: string
  expressionLatex: string
  chemEquation: string
  essayMinWords: string
  essayKeywords: string
  codeFunctionName: string
  codeMaxAstNodes: string
  codeTestCasesJson: string
}

export function emptyPayloadFields(): PayloadFormFields {
  return {
    choiceCorrectIds: 'A',
    fillAccepted: '',
    numericExpected: '0',
    numericTolerance: '0.01',
    expressionLatex: '',
    chemEquation: '',
    essayMinWords: '100',
    essayKeywords: '',
    codeFunctionName: 'solve',
    codeMaxAstNodes: '80',
    codeTestCasesJson: '[{"id":"t1","args":[],"expected":0}]'
  }
}

/** Hydrate form fields from a stored payload (edit mode). */
export function payloadToFields(payload: unknown): PayloadFormFields {
  const base = emptyPayloadFields()
  if (typeof payload !== 'object' || payload === null) return base
  const record = payload as Record<string, unknown>

  if (record.kind === 'choice' && Array.isArray(record.correctOptionIds)) {
    base.choiceCorrectIds = (record.correctOptionIds as unknown[])
      .filter((id): id is string => typeof id === 'string')
      .join(', ')
  }
  if (record.kind === 'fill_blank' && Array.isArray(record.acceptedAnswers)) {
    base.fillAccepted = (record.acceptedAnswers as unknown[])
      .filter((a): a is string => typeof a === 'string')
      .join(', ')
  }
  if (record.kind === 'numeric') {
    if (typeof record.expected === 'number') {
      base.numericExpected = String(record.expected)
    }
    if (typeof record.tolerance === 'number') {
      base.numericTolerance = String(record.tolerance)
    }
  }
  if (record.kind === 'expression' && typeof record.expectedLatex === 'string') {
    base.expressionLatex = record.expectedLatex
  }
  if (
    record.kind === 'chem_equation' &&
    typeof record.expectedEquation === 'string'
  ) {
    base.chemEquation = record.expectedEquation
  }
  if (record.kind === 'essay') {
    if (typeof record.minWords === 'number') {
      base.essayMinWords = String(record.minWords)
    }
    if (Array.isArray(record.requiredKeywords)) {
      base.essayKeywords = (record.requiredKeywords as unknown[])
        .filter((k): k is string => typeof k === 'string')
        .join(', ')
    }
  }
  if (!('kind' in record) && typeof record.functionName === 'string') {
    base.codeFunctionName = record.functionName
    if (typeof record.maxAstNodes === 'number') {
      base.codeMaxAstNodes = String(record.maxAstNodes)
    }
    if (Array.isArray(record.testCases)) {
      base.codeTestCasesJson = JSON.stringify(record.testCases)
    }
  }
  return base
}

function splitCsv(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function parseCodeTestCases(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ id: 't1', args: [], expected: 0 }]
    }
    return parsed
  } catch {
    return [{ id: 't1', args: [], expected: 0 }]
  }
}
