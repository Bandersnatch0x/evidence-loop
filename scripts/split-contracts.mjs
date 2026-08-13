/**
 * One-shot splitter: shared/contracts.ts → shared/contracts/*.ts + barrel.
 * Run from repo root: node scripts/split-contracts.mjs
 *
 * Prefer reading shared/contracts.ts.bak if present (re-run safe).
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const sourcePath = existsSync('shared/contracts.ts.bak')
  ? 'shared/contracts.ts.bak'
  : 'shared/contracts.ts'
const lines = readFileSync(sourcePath, 'utf8').split(/\r?\n/)

/** Each export block = preface comments + body until next export. */
function extractBlocks(srcLines) {
  const exportStarts = []
  for (let i = 0; i < srcLines.length; i++) {
    if (/^export /.test(srcLines[i])) exportStarts.push(i)
  }

  const blocks = []
  for (let e = 0; e < exportStarts.length; e++) {
    const start = exportStarts[e]
    const bodyEnd =
      e + 1 < exportStarts.length ? exportStarts[e + 1] - 1 : srcLines.length - 1

    // Walk back for comment preface (stop at previous export body).
    const prevBodyStart = e > 0 ? exportStarts[e - 1] : -1
    let pre = start - 1
    const preface = []
    while (pre > prevBodyStart) {
      const t = srcLines[pre].trim()
      if (t === '') {
        preface.unshift(srcLines[pre])
        pre--
        continue
      }
      if (
        t.startsWith('//') ||
        t.startsWith('*') ||
        t.startsWith('/*') ||
        t.endsWith('*/')
      ) {
        preface.unshift(srcLines[pre])
        pre--
        continue
      }
      break
    }
    while (preface.length && preface[0].trim() === '') preface.shift()

    // Trim trailing blanks + doc comments (they belong to the next export preface)
    let end = bodyEnd
    while (end > start) {
      const t = srcLines[end].trim()
      if (
        t === '' ||
        t.startsWith('//') ||
        t.startsWith('*') ||
        t.startsWith('/*') ||
        t.endsWith('*/')
      ) {
        end--
        continue
      }
      break
    }

    const first = srcLines[start]
    const nameMatch = first.match(/^export (?:type|interface|const) (\w+)/)
    const name = nameMatch?.[1] ?? `anon_${String(start)}`

    blocks.push({
      name,
      text: [...preface, ...srcLines.slice(start, end + 1)].join('\n')
    })
  }
  return blocks
}

const groups = {
  'evaluation.ts': {
    header:
      '/** Evaluation, evidence, assignment presentation, rubric (ADR-0001/0004/0008). */',
    names: [
      'EvaluationStatus',
      'EvidenceKind',
      'EvidenceVisibility',
      'ResultState',
      'SubjectLanguage',
      'QuestionType',
      'RubricDimension',
      'DemoVariant',
      'AssignmentSummary',
      'DemonstrationReferenceView',
      'Assignment',
      'EvidenceSource',
      'EvidenceItem',
      'DimensionResult',
      'Diagnosis',
      'Intervention',
      'TraceStep',
      'MasterySignal',
      'Provenance',
      'DEFAULT_EVIDENCE_PROVENANCE',
      'EvaluationResult',
      'TeacherAnnotation',
      'EvaluateRequest',
      'EvaluationHistoryItem',
      'ApiError'
    ]
  },
  'mastery.ts': {
    header:
      '/** Mastery profile, review scheduling, intervention suggestion (ADR-0006). */',
    names: [
      'MasteryEvidence',
      'MasterySnapshot',
      'MasteryProfileMap',
      'InterventionSuggestion',
      'MasteryTimelineEntry',
      'SchedulingState',
      'ReviewCard'
    ]
  },
  'org.ts': {
    header: '/** Demo roles, audit log view, cohort snapshot, product identity. */',
    names: [
      'DemoRole',
      'AuditLogItem',
      'CohortLearner',
      'CohortSnapshot',
      'SessionMode',
      'ProductRole',
      'Person',
      'User',
      'Term',
      'Class',
      'Subject',
      'TeachingUnit',
      'Enrollment'
    ]
  },
  'question.ts': {
    header: '/** Question bank, attempt aggregate, standard solution (T01/T03/T09). */',
    names: [
      'Attempt',
      'StandardSolution',
      'Question',
      'QuestionSummary',
      'CreateQuestionInput',
      'UpdateQuestionInput',
      'AdoptSolutionInput',
      'AdoptSolutionResult'
    ]
  },
  'visualization.ts': {
    header: '/** Visualization schemas for 2D/3D demos (ADR-0013/0014/0015). */',
    names: [
      'VisualizationAtom',
      'VisualizationBond',
      'BallStickVisualization',
      'CurveVisualization',
      'VisualizationNode',
      'VisualizationEdge',
      'PrimitivesVisualization',
      'Visualization'
    ]
  },
  'knowledge.ts': {
    header: '/** Knowledge graph + advisory layer contracts. */',
    names: [
      'KnowledgePoint',
      'KpPrerequisite',
      'KnowledgeGraph',
      'AdvisorySuggestion'
    ]
  },
  'import.ts': {
    header: '/** Scan-import draft contracts (T04). */',
    names: [
      'ImportParseMethod',
      'ImportDraftStatus',
      'ImportItemStatus',
      'ImportDraftItem',
      'ImportDraft'
    ]
  },
  'adaptive.ts': {
    header: '/** Next-practice + assign-by-weakness contracts (T06). */',
    names: [
      'PracticePrioritySource',
      'NextPracticeItem',
      'NextPracticePlan',
      'AssignWeaknessRequest',
      'AssignWeaknessResult'
    ]
  },
  'tutoring.ts': {
    header: '/** Three-layer AI tutoring contracts (T05). */',
    names: [
      'TutoringLayer',
      'TutoringMessage',
      'TutoringTurn',
      'TutoringRequestBase',
      'TutoringExplainRequest',
      'TutoringSocraticRequest',
      'TutoringDialogueRequest',
      'TutoringResponse'
    ]
  },
  'practice.ts': {
    header: '/** Practice sessions + mistake book (T07). */',
    names: [
      'PracticeSession',
      'MistakeEntry',
      'MistakeBookView',
      'StartPracticeRequest',
      'StartPracticeResponse'
    ]
  },
  'teacher.ts': {
    header:
      '/** Teacher workflow: units, roster, assignments, grading, tips, templates (T08/T14). */',
    names: [
      'CreateTeachingUnitInput',
      'TeachingUnitView',
      'RosterRow',
      'ImportedRosterEntry',
      'ImportRosterResult',
      'AssignmentKind',
      'CreateAssignmentInput',
      'CreateAssignmentResult',
      'GradingQueueItem',
      'GradeSubjectiveInput',
      'GradeSubjectiveResult',
      'TeacherTip',
      'TeacherTipDelivery',
      'CreateTeacherTipInput',
      'TaskTemplate',
      'TaskTemplateWithKpNames',
      'DeployTaskTemplateInput',
      'DeployTaskTemplateResult',
      'CreateTeacherTipResult',
      'TeacherTipSummary',
      'StudentTipItem'
    ]
  }
}

const deps = {
  'question.ts': [
    "import type { QuestionType, SubjectLanguage, EvaluationResult, EvidenceSource, Provenance } from './evaluation'",
    "import type { SessionMode } from './org'",
    "import type { Visualization } from './visualization'"
  ],
  'knowledge.ts': ["import type { SubjectLanguage } from './evaluation'"],
  'import.ts': [
    "import type { QuestionType, SubjectLanguage } from './evaluation'"
  ],
  'adaptive.ts': ["import type { SubjectLanguage } from './evaluation'"],
  'tutoring.ts': ["import type { Provenance } from './evaluation'"],
  'practice.ts': [
    "import type { SessionMode } from './org'",
    "import type { SubjectLanguage } from './evaluation'"
  ],
  'teacher.ts': [
    "import type { TeachingUnit, SessionMode } from './org'",
    "import type { SubjectLanguage, QuestionType } from './evaluation'"
  ]
}

const blocks = extractBlocks(lines)
const byName = Object.fromEntries(blocks.map((b) => [b.name, b]))

const assigned = new Set(Object.values(groups).flatMap((g) => g.names))
const missing = blocks.filter((b) => !assigned.has(b.name)).map((b) => b.name)
const extra = [...assigned].filter((n) => !byName[n])
if (missing.length || extra.length) {
  console.error('blocks found', blocks.length, blocks.map((b) => b.name).join(','))
  console.error('missing from groups:', missing)
  console.error('extra in groups:', extra)
  process.exit(1)
}

mkdirSync('shared/contracts', { recursive: true })

for (const [file, group] of Object.entries(groups)) {
  const parts = [group.header, '']
  for (const line of deps[file] ?? []) parts.push(line)
  if ((deps[file] ?? []).length) parts.push('')

  for (const name of group.names) {
    parts.push(byName[name].text)
    parts.push('')
  }
  writeFileSync(`shared/contracts/${file}`, parts.join('\n').trimEnd() + '\n')
  console.log('wrote', file, group.names.length)
}

const indexLines = [
  '/**',
  ' * Domain contracts barrel — split by bounded context (architecture deepening C3).',
  ' * Prefer importing from this barrel or a specific submodule.',
  ' */',
  ''
]
for (const [file, group] of Object.entries(groups)) {
  const mod = file.replace('.ts', '')
  const values = group.names.filter((n) => n === 'DEFAULT_EVIDENCE_PROVENANCE')
  const types = group.names.filter((n) => n !== 'DEFAULT_EVIDENCE_PROVENANCE')
  if (types.length) {
    indexLines.push(`export type { ${types.join(', ')} } from './${mod}'`)
  }
  if (values.length) {
    indexLines.push(`export { ${values.join(', ')} } from './${mod}'`)
  }
}
writeFileSync('shared/contracts/index.ts', indexLines.join('\n') + '\n')

writeFileSync(
  'shared/contracts.ts',
  `/**
 * Domain contracts — public barrel.
 *
 * Split by bounded context under shared/contracts/ (architecture deepening C3).
 * Existing importers of \`shared/contracts\` keep working via this re-export.
 */
export * from './contracts/index'
`
)

console.log('ok blocks', blocks.length)
