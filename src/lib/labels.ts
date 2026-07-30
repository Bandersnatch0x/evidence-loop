import type {
  EvidenceKind,
  QuestionType,
  SubjectLanguage
} from '../../shared/contracts'

/**
 * Display labels for the multi-discipline UI (工单 030).
 *
 * Subject (`language`) is only a knowledge-graph ownership dimension; the
 * question type is what drives scoring (ADR-0008). Both are surfaced to the
 * learner separately so the grouping and the form dispatch stay legible.
 */
export const SUBJECT_LABELS: Record<SubjectLanguage, string> = {
  python: '编程',
  math: '数学',
  physics: '物理',
  chemistry: '化学',
  chinese: '语文',
  english: '英语',
  biology: '生物',
  politics: '政治',
  history: '历史',
  geography: '地理'
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  choice: '选择题',
  fill_blank: '填空题',
  numeric: '数值题',
  expression: '表达式题',
  chem_equation: '方程式题',
  code: '代码题',
  essay: '作文题',
  geometry: '立体几何题'
}

/** Evidence-kind labels shown next to each evidence atom (ADR-0004 / 0008 / 0010). */
export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  test: '运行测试',
  static: '静态检查',
  cas_check: 'CAS 校验',
  answer_match: '答案比对',
  lint_result: '书写检查',
  structural_metric: '结构度量',
  render_artifact: '渲染取证'
}

export function subjectLabel(language: SubjectLanguage): string {
  return SUBJECT_LABELS[language]
}

export function questionTypeLabel(type: QuestionType): string {
  return QUESTION_TYPE_LABELS[type]
}

export function evidenceKindLabel(kind: EvidenceKind): string {
  return EVIDENCE_KIND_LABELS[kind]
}
