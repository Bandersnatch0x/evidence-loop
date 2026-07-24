# T07 学生刷题体验（场次/错题本/练习态）— 实现报告

## 完成内容

### 1. 后端（`server/student/`）

| 模块 | 职责 |
|------|------|
| `PracticeSessionService` | 开练占位 Attempt；D1 mode 继承；session 从 Attempt 元数据派生（含 paper 成套） |
| `MistakeBookService` | 错题自动归集；过滤 placeholder；测评态连续 N 次通过销号 |
| `studentRoutes` | `GET /sessions`、`GET /mistakes`、`POST /practice` |
| `seedDemoProduct` | 补 T03 未挂 seed 的尾巴：冷启动灌预置题库 + `tu-demo` + 演示学员 enrollment |

### 2. 前端（学生侧核心体验）

| 模块 | 职责 |
|------|------|
| `PracticeView` | 双模入口卡片（练习态·辅导开启 / 测评态·独立完成） |
| `TodayPractice` | **今日该练**（`GET /api/adaptive/next`）→ 一键开始练 |
| `MistakeBook` | 活跃/已掌握列表 + **重练**按钮（practice-only） |
| `StudentWorkbench` | 今日该练 + 双模 + 场次历史 + 错题本编排 |
| `App` workspace | 模式徽章、attemptId 评价路径、跨题开练切 assignment |
| `ResultsPanel` | 透传 sessionMode/attemptId；**练习态提交前中途求助**（苏格拉底面板） |

### 3. 铁律守护

- D1：练习态证据不进正式 MasteryProfile；测评态关辅导
- 重练固定 practice，不因练习通过销号
- 辅导物理隔离（T05），不回写 score

### 4. 测试

- `tests/studentExperience.test.ts` — session 派生、D1、错题本销号/placeholder
- `tests/MistakeBook.test.tsx` — 重练按钮仅活跃行、回调 questionId

## 本轮补齐的 Demo 缺口（2026-07-24）

1. 错题本注释承诺的 **「重练」按钮** 此前缺失 → 已接通 `startPractice` + App 切题
2. 练习态 **提交前求助** 此前仅在有 evaluation 后可见 → Empty 结果区挂载 TutoringPanel
3. **今日该练** 此前 T06 报告写明留给 T07 → `TodayPractice` + adaptive API 客户端
4. T03 seed 未挂主进程 → `seedDemoProduct` 冷启动灌库，否则今日队列永远空
5. 补本实现报告（此前 reports 目录缺 T07）

## 验收

| 检查项 | 结果 |
|--------|------|
| 双模入口可见 | **DONE** |
| attemptId 评价贯通 | **DONE** |
| 错题本归集 + 销号 | **DONE（后端+列表）** |
| 错题重练 | **DONE（本轮 UI）** |
| 练习态中途求助 | **DONE（本轮 UI）** |
| 今日该练 | **DONE（本轮 UI + demo seed）** |
| 成套测评计时+统一交卷 UI | **部分**：后端 paper 分组有；学生侧计时交卷壳未做 |
| 移动端原生 App | Out of scope（响应式 Web 已加强列表/按钮） |

## 未做（有意后置 / 非阻塞单题 Demo）

- 成套卷计时器 + 统一交卷向导（paper shape 已在 session 列表展示）
- 更丰满的场次回放详情页
- `SESSION_WINDOW_MS` 时间窗合并自由练（现单题即一场，可演示）

## 验证记录（2026-07-24）

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/MistakeBook.test.tsx tests/studentExperience.test.ts tests/questionBank.test.ts tests/questionSolution.test.ts` | **57/57 passed** |
| `node node_modules/typescript/lib/tsc.js --noEmit` | **EXIT=0** |
| `tests/MistakeBook.test.tsx` TS2345（`buttons[0]` 可能 undefined） | **已修** |

T03/T09 配套：题库 + 标准解析后端测试均绿；实现报告已补齐。

## 结论

**T07 学生单题闭环（今日该练 → 双模 → 作答前求助 → 提交 → 错题 → 重练）已可 Demo。**  
成套计时测评 UI 仍为增强项，不挡主演示路径。
