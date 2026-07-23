import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type {
  Assignment,
  CohortSnapshot,
  EvaluationHistoryItem,
  EvaluationResult
} from '../shared/contracts'
import { AssignmentPanel } from './components/AssignmentPanel'
import { CohortView } from './components/CohortView'
import { EditorPanel } from './components/EditorPanel'
import { PipelineBar } from './components/PipelineBar'
import { ResultsPanel } from './components/ResultsPanel'
import { MobileHeader, Sidebar, type AppView } from './components/Sidebar'
import { TransparencyView } from './components/TransparencyView'
import {
  evaluateCode,
  getAssignment,
  getCohort,
  listAssignments,
  listEvaluations
} from './lib/api'

interface LoadedData {
  assignment: Assignment
  history: EvaluationHistoryItem[]
  cohort: CohortSnapshot
}

function toHistoryItem(result: EvaluationResult): EvaluationHistoryItem {
  return {
    id: result.id,
    assignmentId: result.assignmentId,
    attempt: result.attempt,
    createdAt: result.createdAt,
    score: result.score,
    scoreDelta: result.scoreDelta,
    status: result.status
  }
}

async function loadInitialData(): Promise<LoadedData> {
  const assignments = await listAssignments()
  const firstReady = assignments.find((item) => item.status === 'ready')
  if (!firstReady) throw new Error('当前没有可运行的训练任务')

  const [assignment, history, cohort] = await Promise.all([
    getAssignment(firstReady.id),
    listEvaluations(firstReady.id),
    getCohort()
  ])
  return { assignment, history, cohort }
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="fatal-state">
      <div><AlertTriangle size={26} /></div>
      <h1>工作台暂时无法加载</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={onRetry}>
        <RefreshCw size={16} />重新加载
      </button>
    </main>
  )
}

export function App() {
  const [activeView, setActiveView] = useState<AppView>('workspace')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [assignment, setAssignment] = useState<Assignment>()
  const [history, setHistory] = useState<EvaluationHistoryItem[]>([])
  const [cohort, setCohort] = useState<CohortSnapshot>()
  const [evaluation, setEvaluation] = useState<EvaluationResult>()
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [error, setError] = useState<string>()

  const load = () => {
    setIsLoading(true)
    setError(undefined)
    void loadInitialData()
      .then((data) => {
        const defaultVariant = data.assignment.demoVariants[0]
        setAssignment(data.assignment)
        setHistory(data.history)
        setCohort(data.cohort)
        setSelectedVariantId(defaultVariant?.id ?? '')
        setCode(defaultVariant?.code ?? '')
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '未知加载错误')
      })
      .finally(() => setIsLoading(false))
  }

  useEffect(load, [])

  const handleVariantChange = (variantId: string) => {
    if (!assignment) return
    const variant = assignment.demoVariants.find((item) => item.id === variantId)
    setSelectedVariantId(variantId)
    if (variant) setCode(variant.code)
  }

  const handleEvaluate = async () => {
    if (!assignment || isEvaluating) return
    setIsEvaluating(true)
    setError(undefined)

    try {
      const result = await evaluateCode({
        assignmentId: assignment.id,
        code,
        previousEvaluationId: evaluation?.id ?? history[0]?.id
      })
      setEvaluation(result)
      setHistory((current) => [
        toHistoryItem(result),
        ...current.filter((item) => item.id !== result.id)
      ])

      const [historyRefresh, cohortRefresh] = await Promise.allSettled([
        listEvaluations(assignment.id),
        getCohort()
      ])

      if (historyRefresh.status === 'fulfilled' && historyRefresh.value.length > 0) {
        setHistory(historyRefresh.value)
      }
      if (cohortRefresh.status === 'fulfilled') {
        setCohort(cohortRefresh.value)
      }

      const failedRefreshes = [
        historyRefresh.status === 'rejected' ? '历史记录' : undefined,
        cohortRefresh.status === 'rejected' ? '班级学情' : undefined
      ].filter((label): label is string => label !== undefined)
      if (failedRefreshes.length > 0) {
        setError(
          `本轮评估已完成，但${failedRefreshes.join('和')}暂未同步；评分结果已保留。`
        )
      }
    } catch (evaluationError) {
      setError(
        evaluationError instanceof Error
          ? evaluationError.message
          : '评估未能完成，请重试'
      )
    } finally {
      setIsEvaluating(false)
    }
  }

  const handleApplyRepair = () => {
    if (!assignment) return
    const repair = assignment.demoVariants.find((item) => item.id === 'fixed')
      ?? assignment.demoVariants.find((item) => item.id !== selectedVariantId)
    if (!repair) return
    setSelectedVariantId(repair.id)
    setCode(repair.code)
  }

  if (error && !assignment && !isLoading) {
    return <ErrorState message={error} onRetry={load} />
  }

  return (
    <div className="app-shell">
      <MobileHeader onOpen={() => setIsSidebarOpen(true)} />
      <Sidebar
        activeView={activeView}
        isOpen={isSidebarOpen}
        onNavigate={setActiveView}
        onClose={() => setIsSidebarOpen(false)}
      />

      <main className="main-content">
        {isLoading || !assignment ? (
          <div className="view-loading"><span className="loading-bar" />正在读取任务与量规...</div>
        ) : activeView === 'workspace' ? (
          <div className="workspace-view">
            <PipelineBar isEvaluating={isEvaluating} trace={evaluation?.trace} />
            {error && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={16} />{error}
              </div>
            )}
            <div className="workspace-grid">
              <AssignmentPanel assignment={assignment} />
              <EditorPanel
                assignment={assignment}
                code={code}
                selectedVariantId={selectedVariantId}
                isEvaluating={isEvaluating}
                onCodeChange={setCode}
                onVariantChange={handleVariantChange}
                onEvaluate={() => void handleEvaluate()}
              />
              <ResultsPanel
                evaluation={evaluation}
                history={history}
                onApplyRepair={handleApplyRepair}
              />
            </div>
          </div>
        ) : activeView === 'cohort' ? (
          <CohortView cohort={cohort} isLoading={false} />
        ) : (
          <TransparencyView />
        )}
      </main>
    </div>
  )
}
