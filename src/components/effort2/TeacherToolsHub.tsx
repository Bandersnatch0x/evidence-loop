/**
 * TeacherToolsHub — 教师「循证工具」聚合页（Effort 2 教师侧入口）。
 *
 * 聚合 T15 材料→草稿题、T16 跨学科模拟考、T18 教师只读计划、T19 教师周报、
 * T20 教师成就计数、T22 闪卡草稿、T23 作品集导出。全部遵守铁律：
 * LLM 只产出建议层，教师校对/确认后才有权威答案入库，任何路径不写分数。
 *
 * demo 常量：tu-demo（教学单元）、bank-demo（题库标签）。
 */
import {
  BookOpenCheck,
  ClipboardList,
  FileArchive,
  FileText,
  Layers,
  Sparkles,
  Trophy,
  Wand2
} from 'lucide-react'
import { DEMO_STUDENT_ID } from '../../lib/demoRole'
import { FlashcardDraftReviewPanel } from '../flashcardDraft'
import { MaterialDraftReviewPanel } from '../materialImport'
import { TaskTemplatePanel } from '../taskTemplate'
import { TeacherMockExamWizard } from '../mockExam'
import { PortfolioExportPanel } from '../portfolio'
import { TeacherWeeklyReportPanel } from '../reports'
import { TeacherAchievementPanel } from '../achievements'
import { TeacherStudyPlanPanel } from '../studyPlan'

const DEMO_UNIT = 'tu-demo'
const DEMO_BANK = 'bank-demo'

export function TeacherToolsHub() {
  return (
    <div className="effort2-hub" data-view="teacher-tools">
      <header className="effort2-hub-head">
        <h2>
          <Layers size={20} /> 循证工具
        </h2>
        <p className="muted">
          材料进题、模拟考、学习计划、周报、成就计数、闪卡草稿、作品集导出——
          LLM 产物一律先过教师校对闸门，永不直接写分。
        </p>
      </header>

      <nav className="effort2-subnav" aria-label="工具楼层快捷导航">
        <a href="#t-templates">任务模板</a>
        <a href="#t-material">材料出题</a>
        <a href="#t-flashcard">闪卡草稿</a>
        <a href="#t-mockexam">模拟考向导</a>
        <a href="#t-studyplan">学习计划</a>
        <a href="#t-weeklyreport">学情周报</a>
        <a href="#t-achievements">成就计数</a>
        <a href="#t-portfolio">作品集导出</a>
      </nav>

      <section id="t-templates" className="effort2-section">
        <h3>
          <BookOpenCheck size={16} /> 知识点任务模板（复赛 item 3）
        </h3>
        <TaskTemplatePanel />
      </section>

      <section id="t-material" className="effort2-section">
        <h3>
          <FileText size={16} /> 材料 → 草稿题（T15）
        </h3>
        <MaterialDraftReviewPanel questionBankId={DEMO_BANK} subject="math" />
      </section>

      <section id="t-flashcard" className="effort2-section">
        <h3>
          <Wand2 size={16} /> 媒体/转写 → 闪卡草稿（T22）
        </h3>
        <FlashcardDraftReviewPanel questionBankId={DEMO_BANK} subject="math" />
      </section>

      <section id="t-mockexam" className="effort2-section">
        <h3>
          <Sparkles size={16} /> 跨学科模拟考（T16）
        </h3>
        <TeacherMockExamWizard teachingUnitIds={[DEMO_UNIT]} classId="class-demo" />
      </section>

      <section id="t-studyplan" className="effort2-section">
        <h3>
          <ClipboardList size={16} /> 学习计划（T18 · 只读）
        </h3>
        <TeacherStudyPlanPanel
          studentId={DEMO_STUDENT_ID}
          teachingUnitId={DEMO_UNIT}
        />
      </section>

      <section id="t-weeklyreport" className="effort2-section">
        <h3>
          <FileArchive size={16} /> 学情周报（T19）
        </h3>
        <TeacherWeeklyReportPanel
          studentId={DEMO_STUDENT_ID}
          teachingUnitId={DEMO_UNIT}
        />
      </section>

      <section id="t-achievements" className="effort2-section">
        <h3>
          <Trophy size={16} /> 班级成就计数（T20）
        </h3>
        <TeacherAchievementPanel teachingUnitId={DEMO_UNIT} />
      </section>

      <section id="t-portfolio" className="effort2-section">
        <h3>循证作品集导出（T23）</h3>
        <PortfolioExportPanel
          mode="teacher"
          studentId={DEMO_STUDENT_ID}
          teachingUnitId={DEMO_UNIT}
          displayName="演示学生"
        />
      </section>
    </div>
  )
}
