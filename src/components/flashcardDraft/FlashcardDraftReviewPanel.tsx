/**
 * FlashcardDraftReviewPanel — T22 媒体/转写 → 闪卡草稿的教师校对面板。
 *
 * 流程：投料（粘贴转写 / WebVTT 字幕）→ LLM/模板生成草稿 → 逐条校对
 * （front 概念必须原文可溯源、back 解释由教师补全）→ 确认入库。
 *
 * 三条前端红线（与 T15 MaterialDraftReviewPanel 同构）：
 *   1. 未确认草稿不渲染「可作答」状态 —— `usableForAssessment` 由服务端
 *      判定回传，前端不做条件判断；
 *   2. back 为空时「确认」按钮禁用 —— 答案权威只能来自教师，不能拿空解释
 *      入库；
 *   3. 每张草稿都显示 provenance（llm_inference / teacher_annotation）与
 *      正面溯源标记，前端不隐藏生成来源。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  FileText,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wand2
} from 'lucide-react'
import type { SubjectLanguage } from '../../../shared/contracts'
import {
  FLASHCARD_GATE_NOTICE,
  FLASHCARD_LOW_CONFIDENCE_NOTICE,
  FLASHCARD_LOW_CONFIDENCE_THRESHOLD,
  type FlashcardDraft,
  type FlashcardDraftJob
} from '../../../shared/flashcardDraft'
import {
  confirmFlashcard,
  createFlashcardDrafts,
  discardFlashcard,
  getFlashcardJob,
  listFlashcardJobs,
  patchFlashcard
} from './flashcardDraftApi'
import './flashcardDraft.css'

export interface FlashcardDraftReviewPanelProps {
  questionBankId: string
  subject: SubjectLanguage
  /** 可选：直接打开既有任务；不传则展示投料表单。 */
  initialJobId?: string
}

export function FlashcardDraftReviewPanel({
  questionBankId,
  subject,
  initialJobId
}: FlashcardDraftReviewPanelProps) {
  const [rawText, setRawText] = useState('')
  const [noStudentSpeechDeclaration, setNoStudentSpeechDeclaration] = useState(false)
  const [jobs, setJobs] = useState<FlashcardDraftJob[]>([])
  const [activeJobId, setActiveJobId] = useState<string>(initialJobId ?? '')
  const [drafts, setDrafts] = useState<FlashcardDraft[]>([])
  const [gateNotice, setGateNotice] = useState(FLASHCARD_GATE_NOTICE)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const loadJobs = useCallback(() => {
    void listFlashcardJobs()
      .then((view) => {
        setJobs(view.jobs)
        setGateNotice(view.gateNotice)
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '任务列表加载失败')
      })
  }, [])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  const loadJob = useCallback((jobId: string) => {
    setActiveJobId(jobId)
    void getFlashcardJob(jobId)
      .then((view) => {
        setDrafts(view.drafts)
        setGateNotice(view.gateNotice)
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '草稿加载失败')
      })
  }, [])

  useEffect(() => {
    if (initialJobId) loadJob(initialJobId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGenerate = () => {
    if (rawText.trim().length < 20) {
      setError('转写文本太短（至少 20 字），无法生成闪卡草稿。')
      return
    }
    if (!noStudentSpeechDeclaration) {
      setError('请先确认素材中没有学生发言。')
      return
    }
    setIsGenerating(true)
    setError(undefined)
    setNotice(undefined)
    void createFlashcardDrafts({
      questionBankId,
      subject,
      rawText,
      noStudentSpeechDeclaration
    })
      .then((view) => {
        setJobs((current) => [
          view.job,
          ...current.filter((job) => job.id !== view.job.id)
        ])
        setDrafts(view.drafts)
        setActiveJobId(view.job.id)
        setGateNotice(view.gateNotice)
        setNotice(
          view.job.degraded
            ? '未配置 LLM：已用模板抽取原文概念生成草稿（front 可溯源），请补全背面解释后逐条确认。'
            : `已生成 ${view.drafts.length} 张草稿，请逐条校对。`
        )
      })
      .catch((generateError: unknown) => {
        setError(
          generateError instanceof Error ? generateError.message : '生成失败'
        )
      })
      .finally(() => setIsGenerating(false))
  }

  const handlePatch = (draft: FlashcardDraft, patch: { front?: string; back?: string }) => {
    void patchFlashcard(draft.id, patch)
      .then((result) => {
        setDrafts((current) =>
          current.map((item) =>
            item.id === result.flashcard.id ? result.flashcard : item
          )
        )
      })
      .catch((patchError: unknown) => {
        setError(patchError instanceof Error ? patchError.message : '保存失败')
      })
  }

  const handleConfirm = (draft: FlashcardDraft) => {
    void confirmFlashcard(draft.id, {})
      .then((result) => {
        setDrafts((current) =>
          current.map((item) =>
            item.id === result.flashcard.id ? result.flashcard : item
          )
        )
        setNotice(`草稿 ${result.flashcard.front} 已确认入库（题目 ${result.question.id}）。`)
      })
      .catch((confirmError: unknown) => {
        setError(confirmError instanceof Error ? confirmError.message : '确认失败')
      })
  }

  const handleDiscard = (draft: FlashcardDraft) => {
    void discardFlashcard(draft.id)
      .then((result) => {
        setDrafts((current) =>
          current.map((item) =>
            item.id === result.flashcard.id ? result.flashcard : item
          )
        )
      })
      .catch((discardError: unknown) => {
        setError(discardError instanceof Error ? discardError.message : '丢弃失败')
      })
  }

  return (
    <section
      className="flashcard-draft-panel"
      aria-labelledby="flashcard-draft-title"
    >
      <header className="flashcard-draft-header">
        <h3 id="flashcard-draft-title">
          <Wand2 size={18} /> 媒体/转写 → 闪卡草稿
        </h3>
        <span className="flashcard-draft-provenance">
          <ShieldCheck size={13} /> LLM 生成 · 教师校对后入库
        </span>
      </header>

      <p className="flashcard-draft-gate">{gateNotice}</p>

      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}
      {notice !== undefined ? (
        <div className="success-banner">{notice}</div>
      ) : null}

      <div className="flashcard-draft-input">
        <label htmlFor="flashcard-raw-text">转写文本 / WebVTT 字幕</label>
        <textarea
          id="flashcard-raw-text"
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder="粘贴课堂转写文本或 WebVTT 字幕…"
          rows={5}
        />
        <label>
          <input
            type="checkbox"
            checked={noStudentSpeechDeclaration}
            onChange={(event) => setNoStudentSpeechDeclaration(event.target.checked)}
          />
          我确认素材中没有学生发言
        </label>
        <button
          type="button"
          className="primary-button"
          disabled={isGenerating}
          onClick={handleGenerate}
        >
          <Wand2 size={14} /> {isGenerating ? '生成中…' : '生成闪卡草稿'}
        </button>
      </div>

      {jobs.length > 0 ? (
        <div className="flashcard-draft-jobs">
          <label>生成任务</label>
          <ul className="flashcard-draft-job-list">
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  className={job.id === activeJobId ? 'is-active' : ''}
                  onClick={() => loadJob(job.id)}
                >
                  <FileText size={14} />
                  {job.id.slice(0, 12)} · {job.draftCount} 张 ·{' '}
                  {job.degraded ? '模板' : job.generatorModel}
                  {job.status === 'done' ? ' · 已全部处理' : ''}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {drafts.length > 0 ? (
        <div className="flashcard-draft-list">
          {drafts.map((draft) => (
            <FlashcardDraftRow
              key={draft.id}
              draft={draft}
              onPatch={(patch) => handlePatch(draft, patch)}
              onConfirm={() => handleConfirm(draft)}
              onDiscard={() => handleDiscard(draft)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

interface FlashcardDraftRowProps {
  draft: FlashcardDraft
  onPatch: (patch: { front?: string; back?: string }) => void
  onConfirm: () => void
  onDiscard: () => void
}

function FlashcardDraftRow({
  draft,
  onPatch,
  onConfirm,
  onDiscard
}: FlashcardDraftRowProps) {
  const [front, setFront] = useState(draft.front)
  const [back, setBack] = useState(draft.back)

  const isConfirmed = draft.status === 'confirmed'
  const isDiscarded = draft.status === 'discarded'
  const ready = front.trim() !== '' && back.trim() !== ''
  const lowConfidence = draft.confidence < FLASHCARD_LOW_CONFIDENCE_THRESHOLD

  if (isConfirmed || isDiscarded) {
    return (
      <div className={`flashcard-row is-${draft.status}`}>
        <div className="flashcard-row-main">
          <strong>{draft.front}</strong>
          <span className="flashcard-row-status">
            {isConfirmed
              ? `已入库（${draft.confirmedQuestionId ?? ''}）`
              : '已丢弃'}
          </span>
          <span className="flashcard-row-provenance">
            {draft.provenance.kind === 'teacher_annotation'
              ? '教师确认'
              : 'AI 生成'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flashcard-row is-draft">
      <div className="flashcard-row-main">
        <label>
          正面（概念，须原文可溯源）
          <input
            value={front}
            onChange={(event) => {
              setFront(event.target.value)
              onPatch({ front: event.target.value })
            }}
          />
        </label>
        <label>
          背面（解释 = 答案权威，教师补全）
          <input
            value={back}
            onChange={(event) => {
              setBack(event.target.value)
              onPatch({ back: event.target.value })
            }}
          />
        </label>
        <div className="flashcard-row-meta">
          <span className="flashcard-row-provenance">AI 生成（llm_inference）</span>
          {draft.frontGrounded ? (
            <span className="flashcard-row-grounded">正面已原文溯源</span>
          ) : (
            <span className="flashcard-row-ungrounded">正面未通过溯源，请核对</span>
          )}
          {lowConfidence ? (
            <span className="flashcard-row-lowconf">{FLASHCARD_LOW_CONFIDENCE_NOTICE}</span>
          ) : null}
          <span className="flashcard-row-excerpt" title={draft.sourceExcerpt}>
            原文片段：{draft.sourceExcerpt}
          </span>
        </div>
      </div>
      <div className="flashcard-row-actions">
        <button
          type="button"
          className="primary-button"
          disabled={!ready}
          onClick={onConfirm}
        >
          <Check size={14} /> 确认入库
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={isConfirmed}
          onClick={onDiscard}
        >
          <Trash2 size={14} /> 丢弃
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            setFront(draft.front)
            setBack(draft.back)
          }}
        >
          <RefreshCw size={14} /> 还原
        </button>
      </div>
    </div>
  )
}
