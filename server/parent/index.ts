/**
 * parent — 家长端模块出口（决赛加码）。
 *
 * 分层：
 *   ParentChildBindingStore  家长-子女绑定表（迁移 0021，幂等增删查）
 *   seedDemoParentBinding    demo 种子：parent-demo → learner-demo
 *   handleParentApi          HTTP 面：GET /api/parent/children（只读）
 *
 * 家长读周报仍走 reports 模块的 /api/parent/reports/weekly（绑定校验经
 * ParentChildBindingReader 端口注入，不反向依赖本模块）。
 */
export { ParentChildBindingStore, seedDemoParentBinding } from './ParentChildBindingStore'
export type { ParentChildBindingReader } from './ParentChildBindingStore'
export { handleParentApi } from './parentRoutes'
export type { ParentRouteContext } from './parentRoutes'
