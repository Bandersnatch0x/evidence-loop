/**
 * T19 学情周报前端模块出口。
 *
 * 两个入口组件（教师面板 / 学生视图）共用同一套章节渲染与同一个 API 客户端，
 * 保证「教师看到的」与「学生看到的」是同一份报告。
 */
export { TeacherWeeklyReportPanel } from './TeacherWeeklyReportPanel'
export { StudentWeeklyReportView } from './StudentWeeklyReportView'
export {
  WeeklyReportHeader,
  WeeklyReportSections
} from './WeeklyReportSections'
export { describeRefs } from './describeRefs'
export {
  fetchWeeklyReportHtml,
  getStudentWeeklyReport,
  getTeacherWeeklyReport,
  openWeeklyReportPrintView
} from './weeklyReportApi'
export type {
  WeeklyReportQuery,
  WeeklyReportResponse
} from './weeklyReportApi'
