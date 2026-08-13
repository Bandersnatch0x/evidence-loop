import { lazy, Suspense, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Link2, Save, Sparkles } from 'lucide-react'
import type {
  Question,
  QuestionType,
  SubjectLanguage
} from '../../../shared/contracts'
import {
  adoptSolution,
  createQuestion,
  updateQuestion
} from '../../lib/api'
import {
  QUESTION_TYPE_LABELS,
  SUBJECT_LABELS
} from '../../lib/labels'
import {
  buildPayload,
  emptyPayloadFields,
  payloadToFields,
  type PayloadFormFields
} from './payloadDefaults'
import { VisualizationGenerator } from './VisualizationGenerator'
// Lazy-load the reference drawer: it transitively imports StudentPlayer, so a
// static import would pull the entire player renderer into the teacher bundle.
const ReferenceDrawer = lazy(async () => ({
  default: (await import('../demonstration/ReferenceDrawer')).ReferenceDrawer
}))

const SUBJECTS = Object.keys(SUBJECT_LABELS) as SubjectLanguage[]
const QUESTION_TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]

const DEFAULT_BANK_ID = 'teacher-private-bank'

interface QuestionEditorProps {
  /** When set, editor is in edit mode for this owned question. */
  initial?: Question
  onSaved: (question: Question) => void
  onCancel?: () => void
}

/**
 * T03 hand-entry form — QuestionEditor shell + per-questionType payload fields.
 * Mirrors student submission forms: teacher fills stem + answer key + KP +
 * difficulty + optional T09 standard solution.
 */
export function QuestionEditor({
  initial,
  onSaved,
  onCancel
}: QuestionEditorProps) {
  const isEdit = initial !== undefined
  const [subject, setSubject] = useState<SubjectLanguage>(
    initial?.subject ?? 'math'
  )
  const [questionType, setQuestionType] = useState<QuestionType>(
    initial?.questionType ?? 'choice'
  )
  const [stem, setStem] = useState(initial?.stem ?? '')
  const [kpIds, setKpIds] = useState((initial?.kpIds ?? []).join(', '))
  const [difficulty, setDifficulty] = useState(String(initial?.difficulty ?? 2))
  const [payloadFields, setPayloadFields] = useState<PayloadFormFields>(() =>
    initial ? payloadToFields(initial.payload) : emptyPayloadFields()
  )

  // T09 solution fields
  const [solutionContent, setSolutionContent] = useState(
    initial?.solution?.content ?? ''
  )
  const [solutionLatex, setSolutionLatex] = useState(
    initial?.solution?.latex ?? ''
  )
  const [solutionKeyPoints, setSolutionKeyPoints] = useState(
    (initial?.solution?.keyPoints ?? []).join('\n')
  )
  const [adoptDraft, setAdoptDraft] = useState('')

  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [showReferences, setShowReferences] = useState(false)

  const hasAuthoredSolution = useMemo(
    () => (initial?.solution?.content ?? solutionContent).trim() !== '',
    [initial?.solution?.content, solutionContent]
  )

  const setField = <K extends keyof PayloadFormFields>(
    key: K,
    value: PayloadFormFields[K]
  ) => {
    setPayloadFields((prev) => ({ ...prev, [key]: value }))
  }

  const onTypeChange = (next: QuestionType) => {
    setQuestionType(next)
    // Reset type-specific fields to defaults for the new type.
    setPayloadFields(emptyPayloadFields())
  }

  const save = async () => {
    setBusy(true)
    setError(undefined)
    setSuccess(undefined)
    try {
      const payload = buildPayload(questionType, payloadFields)
      const kpList = kpIds
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const solutionBody =
        solutionContent.trim() === ''
          ? undefined
          : {
              content: solutionContent.trim(),
              latex:
                solutionLatex.trim() === '' ? undefined : solutionLatex.trim(),
              keyPoints:
                solutionKeyPoints.trim() === ''
                  ? undefined
                  : solutionKeyPoints
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean),
              // Server overwrites authorId from session; source forced authored.
              authorId: 'pending',
              source: 'authored' as const
            }

      let saved: Question
      if (isEdit && initial) {
        saved = await updateQuestion(initial.id, {
          subject,
          questionType,
          stem,
          payload,
          kpIds: kpList,
          difficulty: Number(difficulty),
          // null clears an existing solution back to 待补.
          solution: solutionBody ?? null
        })
      } else {
        saved = await createQuestion({
          questionBankId: DEFAULT_BANK_ID,
          subject,
          questionType,
          stem,
          payload,
          kpIds: kpList,
          difficulty: Number(difficulty),
          ...(solutionBody !== undefined ? { solution: solutionBody } : {})
        })
      }
      setSuccess(isEdit ? '题目已更新' : `题目已创建：${saved.id}`)
      if (saved.solution) {
        setSolutionContent(saved.solution.content)
        setSolutionLatex(saved.solution.latex ?? '')
        setSolutionKeyPoints((saved.solution.keyPoints ?? []).join('\n'))
      }
      onSaved(saved)
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const handleAdopt = async () => {
    if (!initial) {
      setError('请先保存题目，再采纳 AI 讲解为标准解析')
      return
    }
    if (adoptDraft.trim() === '') {
      setError('请粘贴要采纳的 AI 讲解正文')
      return
    }
    setBusy(true)
    setError(undefined)
    setSuccess(undefined)
    try {
      const result = await adoptSolution(initial.id, {
        content: adoptDraft.trim(),
        keyPoints:
          solutionKeyPoints.trim() === ''
            ? undefined
            : solutionKeyPoints
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
      })
      if (result.solution) {
        setSolutionContent(result.solution.content)
        setSolutionLatex(result.solution.latex ?? '')
        setSolutionKeyPoints((result.solution.keyPoints ?? []).join('\n'))
        setAdoptDraft('')
      }
      setSuccess(
        result.tutoring.mode === 'rag_restate'
          ? '已采纳为标准解析；AI 辅导将走 RAG 复述（低幻觉）'
          : '已写入解析'
      )
      onSaved(result.question)
    } catch (adoptError: unknown) {
      setError(adoptError instanceof Error ? adoptError.message : '采纳失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="question-editor" aria-labelledby="question-editor-title">
      <header>
        <h3 id="question-editor-title">
          {isEdit ? '编辑题目' : '手工录入题目'}
        </h3>
        <p className="muted">
          7 题型共用外壳；答案规格对齐 RunnerSpec（D2 默认 authored_key）。标准解析可选但强烈推荐（T09）。
        </p>
      </header>

      <div className="form-grid">
        <label>
          学科
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value as SubjectLanguage)}
          >
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {SUBJECT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          题型
          <select
            value={questionType}
            onChange={(e) => onTypeChange(e.target.value as QuestionType)}
            disabled={isEdit}
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          难度 (1–5)
          <input
            type="number"
            min={1}
            max={5}
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          />
        </label>
        <label className="span-2">
          知识点 KP（逗号分隔）
          <input
            value={kpIds}
            onChange={(e) => setKpIds(e.target.value)}
            placeholder="kp.math.algebra.simplify"
          />
        </label>
        <label className="span-full">
          题干
          <textarea
            rows={3}
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            placeholder="支持 LaTeX，例如：化简 (x+1)^2"
          />
        </label>
      </div>

      <fieldset className="payload-fieldset">
        <legend>答案规格（{QUESTION_TYPE_LABELS[questionType]}）</legend>
        <PayloadFields
          questionType={questionType}
          fields={payloadFields}
          onChange={setField}
        />
      </fieldset>

      <fieldset className="solution-fieldset">
        <legend>
          标准解析（T09，可选）
          {hasAuthoredSolution ? (
            <span className="mode-badge practice" style={{ marginLeft: 8 }}>
              已填 · RAG 复述
            </span>
          ) : (
            <span className="mode-badge assessment" style={{ marginLeft: 8 }}>
              待补 · AI 生成需免责
            </span>
          )}
        </legend>
        <label className="span-full">
          解析正文
          <textarea
            rows={4}
            value={solutionContent}
            onChange={(e) => setSolutionContent(e.target.value)}
            placeholder="标准解法步骤（有解析时 AI 只复述，不自己算）"
          />
        </label>
        <div className="form-grid">
          <label>
            LaTeX（可选）
            <input
              value={solutionLatex}
              onChange={(e) => setSolutionLatex(e.target.value)}
            />
          </label>
          <label>
            关键步骤（每行一点）
            <textarea
              rows={3}
              value={solutionKeyPoints}
              onChange={(e) => setSolutionKeyPoints(e.target.value)}
            />
          </label>
        </div>

        {isEdit ? (
          <div className="adopt-panel">
            <h4>
              <Sparkles size={16} style={{ verticalAlign: 'middle' }} /> 采纳 AI
              讲解为标准解析
            </h4>
            <p className="muted">
              把 AI 生成的讲解粘贴到下方，一键权威化（source→authored，辅导改走
              RAG）。不改分、不写 evidence。
            </p>
            <textarea
              rows={3}
              value={adoptDraft}
              onChange={(e) => setAdoptDraft(e.target.value)}
              placeholder="粘贴 AI 讲解正文…"
            />
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void handleAdopt()}
            >
              <Sparkles size={14} /> 采纳为标准解析
            </button>
          </div>
        ) : (
          <p className="muted">
            新建题目请直接在上方填写解析；保存后可再使用「采纳 AI」翻转权威来源。
          </p>
        )}
      </fieldset>

      {isEdit && initial ? (
        <>
          <VisualizationGenerator
            questionId={initial.id}
            initial={initial.visualization}
            onAdopted={onSaved}
          />
          <section className="question-demo-references" aria-label="教学演示引用">
            <button
              type="button"
              className="secondary-button"
              aria-expanded={showReferences}
              onClick={() => setShowReferences((open) => !open)}
            >
              <Link2 size={16} /> 管理教学演示引用
            </button>
            {showReferences ? (
              <Suspense fallback={<div className="muted">正在加载引用面板…</div>}>
                <ReferenceDrawer questionId={initial.id} />
              </Suspense>
            ) : null}
          </section>
        </>
      ) : null}

      {error !== undefined ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}
      {success !== undefined ? (
        <div className="success-banner" role="status">
          <CheckCircle2 size={18} /> {success}
        </div>
      ) : null}

      <div className="editor-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || stem.trim() === ''}
          onClick={() => void save()}
        >
          <Save size={16} /> {isEdit ? '保存修改' : '创建题目'}
        </button>
        {onCancel !== undefined ? (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
        ) : null}
      </div>
    </section>
  )
}

function PayloadFields({
  questionType,
  fields,
  onChange
}: {
  questionType: QuestionType
  fields: PayloadFormFields
  onChange: <K extends keyof PayloadFormFields>(
    key: K,
    value: PayloadFormFields[K]
  ) => void
}) {
  switch (questionType) {
    case 'choice':
      return (
        <label>
          正确选项 ID（逗号分隔，如 A, C）
          <input
            value={fields.choiceCorrectIds}
            onChange={(e) => onChange('choiceCorrectIds', e.target.value)}
          />
        </label>
      )
    case 'fill_blank':
      return (
        <label>
          可接受答案（逗号分隔）
          <input
            value={fields.fillAccepted}
            onChange={(e) => onChange('fillAccepted', e.target.value)}
          />
        </label>
      )
    case 'numeric':
      return (
        <div className="form-grid">
          <label>
            期望值
            <input
              type="number"
              value={fields.numericExpected}
              onChange={(e) => onChange('numericExpected', e.target.value)}
            />
          </label>
          <label>
            容差
            <input
              type="number"
              step="any"
              value={fields.numericTolerance}
              onChange={(e) => onChange('numericTolerance', e.target.value)}
            />
          </label>
        </div>
      )
    case 'expression':
      return (
        <label>
          期望 LaTeX
          <input
            value={fields.expressionLatex}
            onChange={(e) => onChange('expressionLatex', e.target.value)}
            placeholder="(x+1)^2"
          />
        </label>
      )
    case 'chem_equation':
      return (
        <label>
          期望方程式
          <input
            value={fields.chemEquation}
            onChange={(e) => onChange('chemEquation', e.target.value)}
            placeholder="2H2 + O2 = 2H2O"
          />
        </label>
      )
    case 'essay':
      return (
        <div className="form-grid">
          <label>
            最少字数
            <input
              type="number"
              value={fields.essayMinWords}
              onChange={(e) => onChange('essayMinWords', e.target.value)}
            />
          </label>
          <label>
            必含关键词（逗号分隔，可选）
            <input
              value={fields.essayKeywords}
              onChange={(e) => onChange('essayKeywords', e.target.value)}
            />
          </label>
        </div>
      )
    case 'code':
      return (
        <div className="form-grid">
          <label>
            函数名
            <input
              value={fields.codeFunctionName}
              onChange={(e) => onChange('codeFunctionName', e.target.value)}
            />
          </label>
          <label>
            最大 AST 节点
            <input
              type="number"
              value={fields.codeMaxAstNodes}
              onChange={(e) => onChange('codeMaxAstNodes', e.target.value)}
            />
          </label>
          <label className="span-full">
            测试用例 JSON
            <textarea
              rows={4}
              value={fields.codeTestCasesJson}
              onChange={(e) => onChange('codeTestCasesJson', e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
      )
    case 'geometry':
      // Geometry questions are authored in assignments.ts, not via this form.
      return (
        <p className="span-full">
          立体几何题暂不支持在此表单录入，请在 assignments.ts 中手动编写。
        </p>
      )
    default: {
      const exhaustive: never = questionType
      return <p>{String(exhaustive)}</p>
    }
  }
}
