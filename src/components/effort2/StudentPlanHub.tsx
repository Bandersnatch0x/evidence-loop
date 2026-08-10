/**
 * StudentPlanHub — 学生「循证计划」聚合页（Effort 2 学生侧入口）。
 *
 * 把 T18 硬事实学习计划、T20 成就墙、T19 学生周报、T21 人物对话探究、
 * T23 作品集导出聚合到一页，全部是**建议层 / 只读投影**——学生看到的每个
 * 数字都挂着证据锚点，没有排行榜、没有积分。
 *
 * demo 常量与 StudentWorkbench 同源：learner-demo / tu-demo / term-demo。
 */
import { useEffect, useState } from 'react'
import {
  BookOpenCheck,
  CalendarRange,
  ClipboardList,
  MessageSquareQuote,
  Trophy
} from 'lucide-react'
import { DEMO_STUDENT_ID } from '../../lib/demoRole'
import { AchievementWall } from '../achievements'
import { PersonaDialoguePanel } from '../dialogue'
import {
  listStudentMockExams,
  MockExamReport,
  StudentMockExamEntry
} from '../mockExam'
import { PortfolioExportPanel } from '../portfolio'
import { StudentWeeklyReportView } from '../reports'
import { StudyPlanTimeline } from '../studyPlan'
import type { MockExamPlan } from '../../../shared/mockExam'

const DEMO_UNIT = 'tu-demo'

export interface StudentPlanHubProps {
  onStartMockExam: (paperId: string) => void
}

export function StudentPlanHub({ onStartMockExam }: StudentPlanHubProps) {
  const [reportPaperId, setReportPaperId] = useState<string | null>(null)
  const [mockExamPlans, setMockExamPlans] = useState<MockExamPlan[]>([])
  const [mockExamError, setMockExamError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void listStudentMockExams()
      .then(({ plans }) => {
        if (!cancelled) setMockExamPlans(plans)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMockExamError(
            error instanceof Error ? error.message : '模拟考加载失败'
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="effort2-hub" data-view="student-plan">
      <header className="effort2-hub-head">
        <h2>
          <CalendarRange size={20} /> 我的循证计划
        </h2>
        <p className="muted">
          计划由硬事实生成（FSRS 到期 / 依赖链 / 掌握度），每条建议可追溯到证据；
          成就只由确定性规则判定，不参与评分。
        </p>
      </header>

      <nav className="effort2-subnav" aria-label="楼层快捷导航">
        <a href="#sec-study-plan">7日计划</a>
        <a href="#sec-mock-exam">模拟考</a>
        <a href="#sec-weekly-report">本周学情</a>
        <a href="#sec-achievements">循证成就</a>
        <a href="#sec-dialogue">人物对话</a>
        <a href="#sec-portfolio">作品集导出</a>
      </nav>

      <section id="sec-study-plan" className="effort2-section">
        <h3>
          <CalendarRange size={16} /> 7 日学习计划
        </h3>
        <StudyPlanTimeline studentId={DEMO_STUDENT_ID} teachingUnitId={DEMO_UNIT} />
      </section>

      <section id="sec-mock-exam" className="effort2-section">
        <h3>
          <ClipboardList size={16} /> 模拟考（测评态 · 分科报告）
        </h3>
        {reportPaperId ? (
          <div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setReportPaperId(null)}
            >
              返回模拟考卡片
            </button>
            <MockExamReport
              paperId={reportPaperId}
              studentId={DEMO_STUDENT_ID}
            />
          </div>
        ) : (
          <div className="effort2-mock-actions">
            {mockExamError ? <div className="error-banner">{mockExamError}</div> : null}
            {mockExamPlans.map((plan) => (
              <div key={plan.id}>
                <StudentMockExamEntry plan={plan} onStart={onStartMockExam} />
                {plan.paperId ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setReportPaperId(plan.paperId!)}
                  >
                    查看交卷报告
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="sec-weekly-report" className="effort2-section">
        <h3>
          <BookOpenCheck size={16} /> 本周学情
        </h3>
        <StudentWeeklyReportView
          studentId={DEMO_STUDENT_ID}
          teachingUnitId={DEMO_UNIT}
        />
      </section>

      <section id="sec-achievements" className="effort2-section">
        <h3>
          <Trophy size={16} /> 循证成就
        </h3>
        <AchievementWall
          studentId={DEMO_STUDENT_ID}
          teachingUnitId={DEMO_UNIT}
          syncOnLoad
        />
      </section>

      <section id="sec-dialogue" className="effort2-section">
        <h3>
          <MessageSquareQuote size={16} /> 人物对话探究（练习态 · 不入分）
        </h3>
        <PersonaDialoguePanel
          kpId="kp-A1"
          notice="练习探究 · 不计入测评"
        />
      </section>

      <section id="sec-portfolio" className="effort2-section">
        <h3>循证作品集</h3>
        <PortfolioExportPanel
          mode="student"
          studentId={DEMO_STUDENT_ID}
          teachingUnitId={DEMO_UNIT}
        />
      </section>
    </div>
  )
}
