# T08 教师工作流（建班/导入学生/布置/批改）— 实现报告

## 完成内容

### 1. 后端（`server/teacher/`）

| 模块 | 职责 |
|------|------|
| `TeachingUnitService` | D3 建单元；`listForTeacher` 列出本人单元（工作台选择器） |
| `StudentImportService` | 复用 T02 导入 + 绑定 Enrollment + 激活码清单 |
| `AssignmentService` | 三布置 shape：handpick / assemble_by_kp / by_weakness |
| `SubjectiveGradingService` | 主观题终裁环：`teacherAnnotation` 不进 `result.score` |
| `teacherRoutes` | 单元 CRUD 列表、名单、布置、批改队列/终裁 |

### 2. 前端（`src/components/teacher/`）

| 模块 | 职责 |
|------|------|
| `TeacherWorkbench` | 五标签：建单元 / 题库录入 / 导入名单 / 布置 / 批改 |
| `ClassSetup` | 选择已有单元 + 一键 `tu-demo` + 新建（Demo 默认值） |
| `StudentImport` | 粘贴名单 → 激活码表 |
| `AssignmentComposer` | 三 shape 布置表单（预置题 `seed:…` 可用） |
| `Gradebook` | 三层批改 UI（客观 / AI 推断 / 教师终裁）+ 批后即时翻转 |
| `QuestionBankPanel` | T03 手录入口（挂在本工作台） |

### 3. 铁律守护

- `teacher_annotation` 写 `result.teacherAnnotation`，**永不**折叠进 `result.score`
- `result.provenance.kind` 保持 `evidence`（客观分不翻转）
- 批改 API 单份 `attemptId`，无批量给分端点（结构性禁止）
- AI 建议层灰色「AI 推断」徽章，`requiresTeacherConfirmation`

### 4. 测试

- `tests/teacherWorkflow.test.ts` — 建单元/列表、导入归属、三布置、预置库可布置、终裁不改 score
- `tests/Gradebook.test.tsx` — AI 徽章 + 批后翻转「教师终裁」
- `tests/routeWiring.test.ts` — list units 含 `tu-demo`
- `tests/studentExperience.test.ts` — seed 单元归属 `teacher-demo`

## 本轮补齐的 Demo 缺口（2026-07-24）

| 缺口 | 修复 |
|------|------|
| `tu-demo.teacherId = system-builtin`，演示教师 `teacher-demo` 全被 Forbidden | `seedDemoProduct` 改归属 `teacher-demo` |
| 手选/组卷只能用私有库，冷启动布置永远空 | `getAssignable` + assemble 并入预置库 `system-builtin` |
| 工作台只能新建、不能选已有单元 | `GET /api/teacher/teaching-units` + ClassSetup 选择器 / 一键 tu-demo |
| 批改后提示「重新加载」却不刷新 | Gradebook 本地乐观更新为「教师终裁」层 |
| 无 T08 实现报告 | 本文件 |

## 验收

| 检查项 | 结果 |
|--------|------|
| 建教学单元（D3） | **DONE** |
| 导入名单 + 激活码 | **DONE** |
| 三布置 shape | **DONE**（by_weakness 依赖 T06 薄弱点有数据） |
| 预置库可布置 | **DONE（本轮）** |
| 演示教师可操作 tu-demo | **DONE（本轮）** |
| 主观题三层批改 UI | **DONE** |
| 终裁不进 score | **DONE（测试守护）** |
| 单元选择器 | **DONE（本轮）** |
| 班级学情矩阵 | **已有**独立 `CohortView` / `CohortMasteryMatrix`（非本票工作台内） |

## 未做（有意后置 / 非阻塞 Demo）

- 工作台内嵌学情矩阵（已有侧栏「班级学情」入口，不重复造）
- 布置后成绩导出 Excel/PDF（fog）
- 批量发提示 / 消息（fog）
- 真实试卷扫描后的主观题队列演示数据（需学生先提交作文）

## 验证记录（2026-07-24）

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/teacherWorkflow.test.ts tests/Gradebook.test.tsx tests/studentExperience.test.ts tests/routeWiring.test.ts` | **39/39 passed** |
| `npx vitest run tests/questionBank.test.ts tests/adaptiveLoop.test.ts tests/QuestionBankPanel.test.tsx` | **41/41 passed** |
| `node node_modules/typescript/lib/tsc.js --noEmit` | **EXIT=0** |

## 结论

**T08 教师闭环（选/建单元 → 导入 → 布置含预置库 → 主观题终裁）已可 Demo。**  
演示路径：侧栏切教师 → 教师工作台 →「使用演示单元 tu-demo」→ 布置 handpick `seed:…` 或按 KP 组卷 → 学生提交作文后到「主观题批改」终裁。
