import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  BookMarked,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { Question, QuestionSummary } from '../../../shared/contracts'
import { deleteQuestion, getQuestion, listQuestions } from '../../lib/api'
import {
  questionTypeLabel,
  subjectLabel
} from '../../lib/labels'
import { QuestionEditor } from './QuestionEditor'
import { QuestionCardGrid } from '../questionCard'

type PanelMode = 'list' | 'create' | 'edit'

/**
 * T03 teacher-private question bank panel.
 *
 * List owned questions + hand-entry (7 types) + edit + T09 solution adopt.
 * Does not require a teaching unit — bank is teacher-scoped, not class-scoped.
 */
export function QuestionBankPanel() {
  const [mode, setMode] = useState<PanelMode>('list')
  const [items, setItems] = useState<QuestionSummary[]>([])
  const [editing, setEditing] = useState<Question>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string>()

  const reload = useCallback(async () => {
    setIsLoading(true)
    setError(undefined)
    try {
      const listed = await listQuestions()
      setItems(listed)
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '题库加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const openEdit = async (id: string) => {
    setBusyId(id)
    setError(undefined)
    try {
      const full = await getQuestion(id)
      setEditing(full)
      setMode('edit')
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '题目加载失败')
    } finally {
      setBusyId(undefined)
    }
  }

  const remove = async (id: string) => {
    setBusyId(id)
    setError(undefined)
    try {
      await deleteQuestion(id)
      await reload()
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error ? deleteError.message : '删除失败'
      )
    } finally {
      setBusyId(undefined)
    }
  }

  if (mode === 'create') {
    return (
      <QuestionEditor
        onSaved={() => {
          setMode('list')
          void reload()
        }}
        onCancel={() => setMode('list')}
      />
    )
  }

  if (mode === 'edit' && editing !== undefined) {
    return (
      <QuestionEditor
        initial={editing}
        onSaved={(saved) => {
          setEditing(saved)
          void reload()
        }}
        onCancel={() => {
          setEditing(undefined)
          setMode('list')
        }}
      />
    )
  }

  return (
    <section className="question-bank-panel" aria-labelledby="question-bank-title">
      <header className="question-bank-header">
        <div>
          <h3 id="question-bank-title">
            <BookMarked size={18} style={{ verticalAlign: 'middle' }} /> 我的题库
          </h3>
          <p className="muted">
            老师私有（共享出界）。手工录入 7 题型；带标准解析的题 AI 辅导质量更高。
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => setMode('create')}
        >
          <Plus size={16} /> 录入新题
        </button>
      </header>

      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {isLoading ? <p className="muted">加载题库…</p> : null}

      {!isLoading && items.length === 0 ? (
        <p className="muted">
          题库还是空的。点「录入新题」添加第一道，或从扫描导入（T04）入库。
        </p>
      ) : null}

      {items.length > 0 ? (
        <QuestionCardGrid
          cards={items.map((item) => ({
            id: item.id,
            title: item.stem,
            kpTags: item.kpIds,
            difficulty: item.difficulty,
            badges: (
              <>
                <code className="muted question-card-id">{item.id}</code>
                <span className="subject-tag">{subjectLabel(item.subject)}</span>
                <span className="subject-tag">
                  {questionTypeLabel(item.questionType)}
                </span>
                {item.hasSolution ? (
                  <span className="mode-badge practice">有解析</span>
                ) : (
                  <span className="mode-badge assessment">待补解析</span>
                )}
              </>
            ),
            footer: (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === item.id}
                  onClick={() => void openEdit(item.id)}
                >
                  <Pencil size={14} /> 编辑
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === item.id}
                  onClick={() => void remove(item.id)}
                >
                  <Trash2 size={14} /> 删除
                </button>
              </>
            )
          }))}
        />
      ) : null}
    </section>
  )
}
