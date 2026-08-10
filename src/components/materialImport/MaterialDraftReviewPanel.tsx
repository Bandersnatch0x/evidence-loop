/**
 * MaterialDraftReviewPanel — 材料 → 草稿题 · 教师并排校对（T15）。
 *
 * 左：原文片段；右：可编辑草稿。每条草稿显式标注 `llm_inference`，
 * 未确认前一律显示「不可作答 / 不可计分 / 不在选题器」——闸门文案来自
 * 服务端 gateNotice，前端不自行放行。
 *
 * 自包含：只 fetch 自己的 `/api/teacher/material-import/*` 端点，
 * 不改任何既有文件、不注册路由。主控挂载见实现报告的粘合清单。
 */
import { useCallback, useMemo, useState } from 'react'
import {
  DRAFT_LOW_CONFIDENCE_THRESHOLD,
  MATERIAL_IMPORT_LOW_CONFIDENCE_NOTICE,
  isAnswerReady,
  type DraftQuestion,
  type MaterialImportJobView
} from '../../../shared/materialImport'
import type { SubjectLanguage } from '../../../shared/contracts'
import './materialImport.css'

const API_BASE = '/api/teacher/material-import'

export interface MaterialDraftReviewPanelProps {
  questionBankId: string
  subject: SubjectLanguage
  /** 可选：直接打开既有任务；不传则展示投料表单。 */
  initialJobId?: string
}

interface AnswerEdit {
  /** choice：勾选的选项 id；fill_blank：换行分隔的可接受答案。 */
  correctOptionIds: string[]
  acceptedAnswers: string
}

export function MaterialDraftReviewPanel({
  questionBankId,
  subject,
  initialJobId
}: MaterialDraftReviewPanelProps) {
  const [rawText, setRawText] = useState('')
  const [sourceKind, setSourceKind] = useState<'paste' | 'text_file'>('paste')
  const [view, setView] = useState<MaterialImportJobView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, AnswerEdit>>({})

  const request = useCallback(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      const response = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
        ...init
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message =
          typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `请求失败（${String(response.status)}）`
        throw new Error(message)
      }
      return body
    },
    []
  )

  const loadJob = useCallback(
    async (jobId: string) => {
      const body = await request(`/${encodeURIComponent(jobId)}`)
      setView(body as MaterialImportJobView)
    },
    [request]
  )

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const generate = () => {
    void run(async () => {
      const body = await request('', {
        method: 'POST',
        body: JSON.stringify({
          questionBankId,
          subject,
          rawText,
          sourceKind
        })
      })
      setView(body as MaterialImportJobView)
    })
  }

  const onPickTextFile = (file: File | null) => {
    if (!file) return
    void run(async () => {
      const text = await file.text()
      setRawText(text)
      setSourceKind('text_file')
    })
  }

  const openInitial = () => {
    if (!initialJobId) return
    void run(() => loadJob(initialJobId))
  }

  const confirmDraft = (draft: DraftQuestion) => {
    void run(async () => {
      const edit = edits[draft.id]
      const payload = buildPayload(draft, edit)
      await request(`/drafts/${encodeURIComponent(draft.id)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ payload })
      })
      if (view) await loadJob(view.job.id)
    })
  }

  const discardDraft = (draft: DraftQuestion) => {
    void run(async () => {
      await request(`/drafts/${encodeURIComponent(draft.id)}/discard`, {
        method: 'POST'
      })
      if (view) await loadJob(view.job.id)
    })
  }

  const pendingCount = useMemo(
    () => view?.drafts.filter((draft) => draft.status === 'draft').length ?? 0,
    [view]
  )

  return (
    <section className="material-import-panel">
      <header className="material-import-head">
        <div>
          <h2>材料 → 草稿题</h2>
          <p>LLM 只出草稿，教师逐题校对确认后才入题库。</p>
        </div>
        {view ? (
          <span className="material-import-model">
            {view.job.degraded ? '模板降级' : 'LLM 生成'} ·{' '}
            <code>{view.job.generatorModel}</code>
          </span>
        ) : null}
      </header>

      {view ? (
        <p className="material-import-gate" role="note">
          {view.gateNotice}
        </p>
      ) : null}

      {view === null ? (
        <div className="material-import-intake">
          <label htmlFor="material-import-raw">粘贴讲义 / 教材段落</label>
          <textarea
            id="material-import-raw"
            value={rawText}
            rows={8}
            placeholder="至少 20 字。原文只存哈希，不落全文。"
            onChange={(event) => {
              setSourceKind('paste')
              setRawText(event.target.value)
            }}
          />
          <label htmlFor="material-import-file" className="material-import-file">
            或上传 .txt 文本文件
            <input
              id="material-import-file"
              type="file"
              accept=".txt,text/plain"
              disabled={busy}
              onChange={(event) => {
                onPickTextFile(event.target.files?.[0] ?? null)
                event.target.value = ''
              }}
            />
          </label>
          <div className="material-import-actions">
            <button type="button" disabled={busy} onClick={generate}>
              生成候选草稿
            </button>
            {initialJobId ? (
              <button
                type="button"
                className="is-ghost"
                disabled={busy}
                onClick={openInitial}
              >
                打开已有任务
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="material-import-progress">
            <span>
              共 {view.drafts.length} 条草稿 · 待校对 {pendingCount} 条
            </span>
            {view.quota?.exceeded ? (
              <span className="material-import-quota">
                今日生成 {view.quota.used}/{view.quota.limit} 次，已超建议额度
              </span>
            ) : null}
          </div>
          <ol className="material-draft-list">
            {view.drafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                busy={busy}
                edit={edits[draft.id]}
                onEdit={(next) => {
                  setEdits((prev) => ({ ...prev, [draft.id]: next }))
                }}
                onConfirm={() => {
                  confirmDraft(draft)
                }}
                onDiscard={() => {
                  discardDraft(draft)
                }}
              />
            ))}
          </ol>
        </>
      )}

      {error ? (
        <p className="material-import-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

interface DraftRowProps {
  draft: DraftQuestion
  busy: boolean
  edit: AnswerEdit | undefined
  onEdit: (next: AnswerEdit) => void
  onConfirm: () => void
  onDiscard: () => void
}

function DraftRow({
  draft,
  busy,
  edit,
  onEdit,
  onConfirm,
  onDiscard
}: DraftRowProps) {
  const current: AnswerEdit = edit ?? readAnswer(draft)
  const ready = isAnswerReady(buildDraftShape(draft, current))
  const lowConfidence = draft.confidence < DRAFT_LOW_CONFIDENCE_THRESHOLD
  const editable = draft.status === 'draft'

  return (
    <li className={`material-draft-row is-${draft.status}`}>
      <div className="material-draft-source">
        <span className="material-draft-label">原文片段</span>
        <p>{draft.sourceExcerpt}</p>
      </div>

      <div className="material-draft-body">
        <div className="material-draft-flags">
          <span className="material-flag is-provenance">
            {draft.provenance.kind === 'llm_inference'
              ? 'llm_inference · 未经教师背书'
              : 'teacher_annotation · 教师已背书'}
          </span>
          <span className="material-flag">
            {draft.status === 'confirmed'
              ? `已入库 · ${draft.confirmedQuestionId ?? ''}`
              : '不可作答 / 不可计分 / 不在选题器'}
          </span>
          {lowConfidence ? (
            <span className="material-flag is-low">
              置信度 {draft.confidence.toFixed(2)}
            </span>
          ) : null}
        </div>

        <p className="material-draft-stem">{draft.payload.stem}</p>

        {draft.payload.questionType === 'choice' ? (
          <ul className="material-draft-options">
            {(draft.payload.options ?? []).map((option) => (
              <li key={option.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!editable || busy}
                    checked={current.correctOptionIds.includes(option.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...current.correctOptionIds, option.id]
                        : current.correctOptionIds.filter(
                            (id) => id !== option.id
                          )
                      onEdit({ ...current, correctOptionIds: next })
                    }}
                  />
                  <b>{option.id}</b> {option.text}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <textarea
            className="material-draft-answer"
            rows={2}
            disabled={!editable || busy}
            value={current.acceptedAnswers}
            placeholder="每行一个可接受答案"
            onChange={(event) => {
              onEdit({ ...current, acceptedAnswers: event.target.value })
            }}
          />
        )}

        {lowConfidence && editable ? (
          <p className="material-draft-hint">
            {MATERIAL_IMPORT_LOW_CONFIDENCE_NOTICE}
          </p>
        ) : null}

        {editable ? (
          <div className="material-import-actions">
            <button type="button" disabled={busy || !ready} onClick={onConfirm}>
              确认入库
            </button>
            <button
              type="button"
              className="is-ghost"
              disabled={busy}
              onClick={onDiscard}
            >
              丢弃
            </button>
            {ready ? null : <span className="material-draft-block">未填答案，闸门关闭</span>}
          </div>
        ) : null}
      </div>
    </li>
  )
}

function readAnswer(draft: DraftQuestion): AnswerEdit {
  const payload = draft.payload.payload
  const record =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {}
  const ids = Array.isArray(record.correctOptionIds)
    ? record.correctOptionIds.filter((id): id is string => typeof id === 'string')
    : []
  const answers = Array.isArray(record.acceptedAnswers)
    ? record.acceptedAnswers.filter(
        (answer): answer is string => typeof answer === 'string'
      )
    : []
  return { correctOptionIds: ids, acceptedAnswers: answers.join('\n') }
}

function buildPayload(
  draft: DraftQuestion,
  edit: AnswerEdit | undefined
): Record<string, unknown> {
  const current = edit ?? readAnswer(draft)
  const base =
    typeof draft.payload.payload === 'object' && draft.payload.payload !== null
      ? { ...(draft.payload.payload as Record<string, unknown>) }
      : {}
  if (draft.payload.questionType === 'choice') {
    base.correctOptionIds = current.correctOptionIds
    base.options = draft.payload.options ?? []
    return base
  }
  base.acceptedAnswers = current.acceptedAnswers
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return base
}

/** 与服务端共用 isAnswerReady 判定，避免前端自造一套闸门口径。 */
function buildDraftShape(draft: DraftQuestion, edit: AnswerEdit) {
  return { ...draft.payload, payload: buildPayload(draft, edit) }
}
