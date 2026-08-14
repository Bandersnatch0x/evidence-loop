import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type {
  Assignment,
  AssignmentSummary,
  CohortSnapshot,
  DemoRole,
  EvaluationHistoryItem,
  EvaluationResult,
  KnowledgePoint,
  SessionMode
} from '../shared/contracts'
import { AssignmentPicker } from './components/AssignmentPicker'
import { CohortMasteryView } from './components/CohortMasteryView'
import { CohortShell } from './components/CohortShell'
import { MathProblem } from './components/MathProblem'
import { MasteryView } from './components/MasteryView'
import { OverlayLayer } from './components/OverlayLayer'
import { PipelineBar } from './components/PipelineBar'
import { ReviewView } from './components/ReviewView'
import { RoleGate } from './components/RoleGate'
import { isStudentRole, isTeacherRole, isParentRole } from './components/rolePredicates'
import { MobileHeader, Sidebar, type AppView } from './components/Sidebar'
import { StudentWorkbench } from './components/student'
import { StudentPlanHub, TeacherToolsHub } from './components/effort2'
import { ParentOverviewView } from './components/parent/ParentOverviewView'
import { ReviewerQueueView } from './components/reviewer/ReviewerQueueView'
import { TeacherWorkbench } from './components/teacher'
import { TransparencyView } from './components/TransparencyView'
import { VoiceCompanion } from './components/VoiceCompanion'
import { WorkspaceTabs, type ScaffoldUsage } from './components/WorkspaceTabs'
import { isMultimodalEnabled } from './config/features'
import {
  assignmentIdToQuestionId,
  evaluateCode,
  getActiveDemoRole,
  getAssignment,
  getCohort,
  getKnowledgeGraph,
  listAssignments,
  listEvaluations,
  questionIdToAssignmentId,
  setActiveDemoRole,
  startPractice
} from './lib/api'
import {
  DEMO_STUDENT_ID,
  readStoredDemoRole,
  writeStoredDemoRole
} from './lib/demoRole'
import { useHashRoute, useHashWriter } from './lib/useHashRoute'

interface LoadedData {
  assignments: AssignmentSummary[]
  assignment: Assignment
  history: EvaluationHistoryItem[]
  cohort?: CohortSnapshot
}

function toHistoryItem(result: EvaluationResult): EvaluationHistoryItem {
  return {
    id: result.id,
    assignmentId: result.assignmentId,
    attempt: result.attempt,
    createdAt: result.createdAt,
    score: result.score,
    scoreDelta: result.scoreDelta,
    status: result.status,
    studentId: result.studentId,
    scaffoldUsed: result.scaffoldUsed
  }
}

async function loadInitialData(role: DemoRole): Promise<LoadedData> {
  setActiveDemoRole(role)
  const assignments = await listAssignments()
  const firstReady = assignments.find((item) => item.status === 'ready')
  if (!firstReady) throw new Error('当前没有可运行的训练任务')

  const [assignment, history] = await Promise.all([
    getAssignment(firstReady.id),
    listEvaluations(firstReady.id)
  ])

  if (role === 'student') {
    return { assignments, assignment, history }
  }

  try {
    const cohort = await getCohort()
    return { assignments, assignment, history, cohort }
  } catch {
    return { assignments, assignment, history }
  }
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

const TEACHER_ONLY_VIEWS: readonly AppView[] = [
  'cohort',
  'cohort-mastery',
  'teaching',
  'teacher-tools',
  'reviewer'
]

const STUDENT_ONLY_VIEWS: readonly AppView[] = [
  'mastery',
  'review',
  'practice',
  'student-plan'
]

const PARENT_ONLY_VIEWS: readonly AppView[] = ['parent']

function isTeacherOnlyView(view: AppView): boolean {
  return TEACHER_ONLY_VIEWS.includes(view)
}

function isStudentOnlyView(view: AppView): boolean {
  return STUDENT_ONLY_VIEWS.includes(view)
}

function isParentOnlyView(view: AppView): boolean {
  return PARENT_ONLY_VIEWS.includes(view)
}

export function App() {
  const multimodalEnabled = isMultimodalEnabled()
  const hashRoute = useHashRoute()
  const writeHash = useHashWriter()
  const [activeView, setActiveView] = useState<AppView>(
    () => hashRoute.view ?? 'workspace'
  )
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [demoRole, setDemoRole] = useState<DemoRole>(() => {
    const role = hashRoute.role ?? readStoredDemoRole()
    setActiveDemoRole(role)
    return role
  })
  // P0: keep hash in sync when view/role change (idempotent).
  useEffect(() => {
    writeHash({ view: activeView, role: demoRole })
  }, [activeView, demoRole, writeHash])
  // P0: respond to back/forward (hashchange from buttons / popstate).
  useEffect(() => {
    if (hashRoute.view && hashRoute.view !== activeView) {
      setActiveView(hashRoute.view)
    }
    if (hashRoute.role && hashRoute.role !== demoRole) {
      const role = hashRoute.role
      writeStoredDemoRole(role)
      setActiveDemoRole(role)
      setDemoRole(role)
    }
    // hashRoute is read on each hashchange; we intentionally do not depend on
    // activeView/demoRole here to avoid write loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashRoute])
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([])
  const [assignment, setAssignment] = useState<Assignment>()
  const [history, setHistory] = useState<EvaluationHistoryItem[]>([])
  const [cohort, setCohort] = useState<CohortSnapshot>()
  const [knowledgePoints, setKnowledgePoints] = useState<KnowledgePoint[]>([])
  const [evaluation, setEvaluation] = useState<EvaluationResult>()
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [submission, setSubmission] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSwitching, setIsSwitching] = useState(false)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [error, setError] = useState<string>()
  // T07 active product Attempt (mode + attemptId). When set, evaluate
  // updates this Attempt in place and preserves D1 dual-mode projection.
  // Cleared on assignment switch / role change.
  const [activeAttempt, setActiveAttempt] = useState<{
    attemptId: string
    mode: SessionMode
  }>()
  // P2-1 支架留痕：记录本次作答前是否/多久查看演示支架（呈现层，不入分）。
  const scaffoldUsageRef = useRef<ScaffoldUsage>({
    scaffoldUsed: false,
    scaffoldDurationMs: 0
  })

  const applyAssignment = useCallback((nextAssignment: Assignment) => {
    const defaultVariant = nextAssignment.demoVariants[0]
    setAssignment(nextAssignment)
    setSelectedVariantId(defaultVariant?.id ?? '')
    setSubmission(defaultVariant?.code ?? '')
    setEvaluation(undefined)
    setActiveAttempt(undefined)
    scaffoldUsageRef.current = { scaffoldUsed: false, scaffoldDurationMs: 0 }
  }, [])

  const load = useCallback(
    (role: DemoRole = getActiveDemoRole()) => {
      setIsLoading(true)
      setError(undefined)
      void loadInitialData(role)
        .then((data) => {
          setAssignments(data.assignments)
          setHistory(data.history)
          setCohort(data.cohort)
          applyAssignment(data.assignment)
        })
        .catch((loadError: unknown) => {
          setError(loadError instanceof Error ? loadError.message : '未知加载错误')
        })
        .finally(() => setIsLoading(false))
    },
    [applyAssignment]
  )

  useEffect(() => {
    load(demoRole)
  }, [demoRole, load])

  useEffect(() => {
    let cancelled = false
    void getKnowledgeGraph()
      .then((graph) => {
        if (!cancelled) setKnowledgePoints(graph.points)
      })
      .catch(() => {
        // Mastery/review pages show their own empty/error states.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleNavigate = (view: AppView) => {
    setActiveView(view)
  }

  const handleDemoRoleChange = (role: DemoRole) => {
    writeStoredDemoRole(role)
    setActiveDemoRole(role)
    setEvaluation(undefined)
    setActiveAttempt(undefined)
    setError(undefined)
    if (isStudentRole(role) && isTeacherOnlyView(activeView)) {
      setActiveView('workspace')
    }
    if (isTeacherRole(role) && isStudentOnlyView(activeView)) {
      setActiveView('workspace')
    }
    if (isParentRole(role) && !isParentOnlyView(activeView)) {
      setActiveView('parent')
    }
    if (role !== 'parent' && isParentOnlyView(activeView)) {
      setActiveView('workspace')
    }
    setDemoRole(role)
  }

  const handleSelectAssignment = (assignmentId: string) => {
    if (assignmentId === assignment?.id || isSwitching || isEvaluating) return
    setIsSwitching(true)
    setError(undefined)
    void Promise.all([getAssignment(assignmentId), listEvaluations(assignmentId)])
      .then(([nextAssignment, nextHistory]) => {
        applyAssignment(nextAssignment)
        setHistory(nextHistory)
      })
      .catch((switchError: unknown) => {
        setError(
          switchError instanceof Error ? switchError.message : '任务切换失败，请重试'
        )
      })
      .finally(() => setIsSwitching(false))
  }

  const handleVariantChange = (variantId: string) => {
    if (!assignment) return
    const variant = assignment.demoVariants.find((item) => item.id === variantId)
    setSelectedVariantId(variantId)
    if (variant) setSubmission(variant.code)
  }

  const handleEvaluate = async () => {
    if (!assignment || isEvaluating) return
    setIsEvaluating(true)
    setError(undefined)

    try {
      // Product path: if no active Attempt yet (legacy workspace submit),
      // open a practice Attempt so D1 dual-mode is always explicit for
      // student sessions. Teachers keep the legacy assessment-default path.
      let attemptId = activeAttempt?.attemptId
      if (attemptId === undefined && demoRole === 'student') {
        const started = await startPractice({
          questionId: assignmentIdToQuestionId(assignment.id),
          teachingUnitId: 'tu-demo',
          termId: 'term-demo',
          mode: 'practice'
        })
        attemptId = started.attemptId
        setActiveAttempt({ attemptId, mode: started.mode })
      }

      const result = await evaluateCode({
        assignmentId: assignment.id,
        code: submission,
        previousEvaluationId: evaluation?.id ?? history[0]?.id,
        attemptId,
        scaffoldUsed: scaffoldUsageRef.current.scaffoldUsed,
        scaffoldDurationMs: scaffoldUsageRef.current.scaffoldDurationMs
      })
      setEvaluation(result)
      setHistory((current) => [
        toHistoryItem(result),
        ...current.filter((item) => item.id !== result.id)
      ])

      const historyRefresh = await Promise.allSettled([
        listEvaluations(assignment.id)
      ]).then((results) => results[0])

      if (historyRefresh?.status === 'fulfilled' && historyRefresh.value.length > 0) {
        setHistory(historyRefresh.value)
      }

      let cohortFailed = false
      if (demoRole !== 'student') {
        const cohortRefresh = await Promise.allSettled([getCohort()]).then(
          (results) => results[0]
        )
        if (cohortRefresh?.status === 'fulfilled') {
          setCohort(cohortRefresh.value)
        } else {
          cohortFailed = true
        }
      }

      const failedRefreshes = [
        historyRefresh?.status === 'rejected' ? '历史记录' : undefined,
        cohortFailed ? '班级学情' : undefined
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
      ?? assignment.demoVariants.find((item) => item.id === 'correct')
      ?? assignment.demoVariants.find((item) => item.id !== selectedVariantId)
    if (!repair) return
    setSelectedVariantId(repair.id)
    setSubmission(repair.code)
  }

  /**
   * T07: open a practice/assessment attempt for a bank question id, switch the
   * workspace to the matching demo assignment (seed:xxx → assignment id), and
   * land on the submission surface with the D1 mode badge visible.
   */
  const handleStartQuestion = async (
    questionId: string,
    mode: SessionMode = 'practice'
  ) => {
    const assignmentId = questionIdToAssignmentId(questionId)
    const nextAssignment = await getAssignment(assignmentId)
    const nextHistory = await listEvaluations(assignmentId)
    applyAssignment(nextAssignment)
    setHistory(nextHistory)
    const started = await startPractice({
      questionId,
      teachingUnitId: 'tu-demo',
      termId: 'term-demo',
      mode
    })
    setActiveAttempt({ attemptId: started.attemptId, mode: started.mode })
    setEvaluation(undefined)
    setActiveView('workspace')
  }

  if (error && !assignment && !isLoading) {
    return <ErrorState message={error} onRetry={load} />
  }

  const shellClass = [
    'app-shell',
    multimodalEnabled && voiceOpen ? 'voice-drawer-open' : ''
  ]
    .filter((part) => part.length > 0)
    .join(' ')

  let mainBody: ReactNode
  if (isLoading || !assignment) {
    mainBody = (
      <div className="view-loading">
        <span className="loading-bar" />
        正在读取任务与量规...
      </div>
    )
  } else if (activeView === 'workspace') {
    mainBody = (
      <div className="workspace-view" data-evidence-id="demo-1">
        <PipelineBar isEvaluating={isEvaluating} trace={evaluation?.trace} />
        {error && (
          <div className="inline-error" role="alert">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
        {activeAttempt !== undefined ? (
          <div
            className={
              activeAttempt.mode === 'practice'
                ? 'mode-badge practice'
                : 'mode-badge assessment'
            }
            role="status"
            style={{ marginBottom: 8, display: 'inline-block' }}
          >
            {activeAttempt.mode === 'practice'
              ? '练习态 · 辅导开启 · 不计入正式掌握度'
              : '测评态 · 独立完成 · 计入正式掌握度'}
          </div>
        ) : null}
        {assignments.length > 1 && (
          <AssignmentPicker
            assignments={assignments}
            activeId={assignment.id}
            disabled={isSwitching || isEvaluating}
            onSelect={handleSelectAssignment}
          />
        )}
        <WorkspaceTabs
          assignment={assignment}
          evaluation={evaluation}
          history={history}
          submission={submission}
          selectedVariantId={selectedVariantId}
          isEvaluating={isEvaluating}
          isSwitching={isSwitching}
          activeAttempt={activeAttempt}
          onSubmissionChange={setSubmission}
          onVariantChange={handleVariantChange}
          onEvaluate={() => void handleEvaluate()}
          onApplyRepair={handleApplyRepair}
          scaffoldUsageRef={scaffoldUsageRef}
        />
        {/* T-L Phase C: StudentVizPreview (student-side generation entry) removed
            per ticket 07 player contract — students never author/bind demos.
            File retained (baseline user work) but unmounted. */}
        {multimodalEnabled && (
          <div className="math-problem-slot">
            <MathProblem problemId="math-1" />
          </div>
        )}
      </div>
    )
  } else if (activeView === 'mastery') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['student']}
        deniedMessage="掌握度画像仅对学生角色开放。请切换到学生。"
      >
        <MasteryView
          studentId={DEMO_STUDENT_ID}
          points={knowledgePoints}
          onStartQuestion={(questionId, mode) => {
            void handleStartQuestion(questionId, mode)
          }}
        />
      </RoleGate>
    )
  } else if (activeView === 'review') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['student']}
        deniedMessage="今日复习仅对学生角色开放。请切换到学生。"
      >
        <ReviewView studentId={DEMO_STUDENT_ID} points={knowledgePoints} />
      </RoleGate>
    )
  } else if (activeView === 'practice') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['student']}
        deniedMessage="我的练习仅对学生角色开放。请切换到学生。"
      >
        <StudentWorkbench
          questionId={assignmentIdToQuestionId(assignment.id)}
          teachingUnitId="tu-demo"
          termId="term-demo"
          studentId={DEMO_STUDENT_ID}
          onAttemptStarted={(attemptId, mode) => {
            setActiveAttempt({ attemptId, mode })
            setEvaluation(undefined)
            setActiveView('workspace')
          }}
          onStartQuestion={handleStartQuestion}
        />
      </RoleGate>
    )
  } else if (activeView === 'teaching') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['teacher', 'admin']}
        deniedMessage="教师工作台仅对教师/管理员开放。"
      >
        <TeacherWorkbench />
      </RoleGate>
    )
  } else if (activeView === 'cohort') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['teacher', 'admin']}
        deniedMessage="学生角色无法访问班级学情。请切换到教师或管理员。"
      >
        <CohortShell
          cohort={cohort}
          renderMastery={() => (
            <CohortMasteryView
              learners={(cohort?.learners ?? []).map((learner) => ({
                id: learner.id,
                displayName: learner.displayName
              }))}
            />
          )}
        />
      </RoleGate>
    )
  } else if (activeView === 'cohort-mastery') {
    // P1: merged into cohort entry; legacy hash lands on the mastery tab.
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['teacher', 'admin']}
        deniedMessage="班级掌握度矩阵仅对教师/管理员开放。"
      >
        <CohortShell
          cohort={cohort}
          initialTab="mastery"
          renderMastery={() => (
            <CohortMasteryView
              learners={(cohort?.learners ?? []).map((learner) => ({
                id: learner.id,
                displayName: learner.displayName
              }))}
            />
          )}
        />
      </RoleGate>
    )
  } else if (activeView === 'student-plan') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['student']}
        deniedMessage="我的循证计划仅对学生角色开放。请切换到学生。"
      >
        <StudentPlanHub
          onStartMockExam={(paperId) => {
            // P0: persist paperId + land on practice so the paper session shows.
            writeHash({ view: 'practice', paperId })
            setActiveView('practice')
          }}
        />
      </RoleGate>
    )
  } else if (activeView === 'teacher-tools') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['teacher', 'admin']}
        deniedMessage="循证工具仅对教师/管理员开放。"
      >
        <TeacherToolsHub />
      </RoleGate>
    )
  } else if (activeView === 'reviewer') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['teacher', 'admin']}
        deniedMessage="公共库审核仅对教师/管理员开放。"
      >
        <ReviewerQueueView />
      </RoleGate>
    )
  } else if (activeView === 'parent') {
    mainBody = (
      <RoleGate
        role={demoRole}
        allow={['parent']}
        deniedMessage="家长视图仅对家长演示角色开放。"
      >
        <ParentOverviewView teachingUnitId="tu-demo" />
      </RoleGate>
    )
  } else {
    mainBody = <TransparencyView />
  }

  return (
    <div className={shellClass}>
      <a href="#main-content" className="skip-link">
        跳至主要内容
      </a>
      <MobileHeader onOpen={() => setIsSidebarOpen(true)} />
      <Sidebar
        activeView={activeView}
        isOpen={isSidebarOpen}
        demoRole={demoRole}
        onNavigate={handleNavigate}
        onDemoRoleChange={handleDemoRoleChange}
        onClose={() => setIsSidebarOpen(false)}
      />

      <main id="main-content" tabIndex={-1} className="main-content">
        {mainBody}
      </main>

      {multimodalEnabled && (
        <>
          <VoiceCompanion open={voiceOpen} onOpenChange={setVoiceOpen} />
          <OverlayLayer />
        </>
      )}
    </div>
  )
}
