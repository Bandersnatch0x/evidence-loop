# T23 实现报告 —— 能力证据包 / 作品集导出

**状态**: 已实现（垂直切片，待主控接线）
**范围**: 只新建文件；未修改任何既有文件。红线全部遵守：作品集每条目挂证据、导出只读投影、PII 收敛、导出可审计、学生/教师权限分离、LLM 辅导对话默认不打入包。

---

## 1. 新建文件清单及职责

| 文件 | 职责 |
| --- | --- |
| `shared/portfolio.ts` | 独立契约：`PortfolioPackage` / `PortfolioAttempt` / `PortfolioEvidence` / `PortfolioTeacherAnnotation` / `PortfolioQuestionMeta`；常量 `PORTFOLIO_ALGORITHM`（`portfolio.hard.v1`）、`PORTFOLIO_RUBRIC_VERSION`（`rubric.v1`）、`PORTFOLIO_DEFAULT_QUESTION_TYPES`（`code`+`essay`）；可执行断言 `findUnbackedPortfolioAttempts`（空=合规）；辅助 `listPortfolioEvidence` / `hasCompletePortfolioCover`。 |
| `server/db/migrations/0019_portfolio_exports.sql` | 导出台账表 `portfolio_exports`，只存标识与元数据（id/学生/单元/操作者/条目数/算法/量规/时间），无外键、无自由文本（ADR-0003 不做 PII 二次落库）。 |
| `server/portfolio/ports.ts` | 只读端口：`PortfolioAttemptReader` / `PortfolioQuestionReader` / `PortfolioOrgReader` / `PortfolioAliasReader`；自有写端口 `PortfolioExportRecorder`；审计 `PortfolioAuditSink`；错误 `PortfolioUnitMissingError` / `UnbackedPortfolioAttemptError`。不 import 任何评分模块（结构性隔离）。 |
| `server/portfolio/buildPortfolio.ts` | 纯函数内核：`PortfolioHardFacts` → `PortfolioPackage`。无证据 Attempt 直接过滤；确定性排序；`submissionHash = sha256(evidence.actual 非空拼接)`；题目缺失诚实缺省。 |
| `server/portfolio/PortfolioExportService.ts` | 编排层：默认选题过滤（assessment + code/essay + completed）、显式 `attemptIds` 白名单（仍受无证据约束）、PII 净化（别名/题干/批注/evidence.actual/expected 命中即隐去）、出站跑 `findUnbackedPortfolioAttempts` 保险丝。Service 自身零写句柄。 |
| `server/portfolio/PortfolioExportStore.ts` | `portfolio_exports` 台账实现（实现 `PortfolioExportRecorder`）。只 touch 自有表。 |
| `server/portfolio/renderPortfolioReadme.ts` | 纯函数：包 → `README.md`（封面 + 逐条摘要，空态诚实，证据分层可见）。 |
| `server/portfolio/zipWriter.ts` | 零依赖 zip 归档（method=0 STORE，UTF-8），`buildZip` / `readZipEntry`（测试可直接解析，无需解压依赖）/ `portfolioFilename`。 |
| `server/portfolio/portfolioRoutes.ts` | HTTP 面：`POST /api/student/portfolio/export`（仅本人）+ `POST /api/teacher/portfolio/export`（仅本单元在读学生），缺省 zip 下载、`?format=json` 返回原文；权限四道门（角色→单元归属→enrollment→student-data）；导出即留痕（台账+审计链）。 |
| `server/portfolio/index.ts` | 模块公共出口（与 T18/T19/T20 同构）。 |
| `tests/portfolioExport.test.ts` | 27 条契约/行为/HTTP/架构守卫测试（见 §5）。 |

## 2. 设计决策

1. **证据是唯一的入包门票**：`buildPortfolio` 对 `evidence.length === 0` 的 Attempt 直接过滤（"无证据不进包"在构建期成立），出站再跑 `findUnbackedPortfolioAttempts` 断言（不变量被破坏时 500 而非静默放行）。与 T19 `findUnbackedMetrics`、T20 `findUnbackedAchievements` 同手法。
2. **只读投影的结构性保证**：`server/portfolio/` 的 import 图里没有任何一条边指向 `server/mastery`、`server/review`、`server/runner`、`server/tutoring`（ports 是 duck-typed 声明）。唯一写路径是自有 `portfolio_exports` 表 + append-only 审计链。
3. **PII 收敛**：包内只出现 `studentAlias`（学名号/化名，过 PIIDetector 命中即退回 studentId）；题干、教师批注、`evidence.actual` / `expected` 入站前整段净化（`REDACTED_PORTFOLIO_TEXT`）。契约里没有 `summary` / `rejectionReason` / `evidence.message` 等自由文本字段，PII 面收敛到零。
4. **LLM 辅导对话默认不打入包**：契约类型里根本没有对话/AI 推断字段，且无任何 opt-in 开关 —— "默认关" 在类型层面成立。
5. **submissionHash 的口径**：T01/CodeRunner 只持久化证据的 `actual`，不存裸提交，因此 `submissionHash = sha256(evidence.actual 非空拼接)`（与 T08 `SubjectiveGradingService.toQueueItem` 的提交文本口径一致），是「Runner 观察到的提交痕迹」的确定性指纹，可与包内 evidence 交叉验证。
6. **zip 零依赖**：用 method=0（STORE）+ 表驱动 CRC32 手写归档，输出字节确定；测试经 `readZipEntry` 直接校验内容，无需解压依赖。PRD 要求"不测 zip 内部结构" —— 数据完整性测试走 `?format=json` 与纯函数层。
7. **默认题型**：`PORTFOLIO_DEFAULT_QUESTION_TYPES = ['code', 'essay']`。ISSUE 的"code/project"当前没有 `project` 题型，essay 覆盖项目式主观题（T08 教师批注挂这类提交）；未来新增 `project` 题型只需在该数组追加。

## 3. 待主控接线的粘合代码（可照抄）

> 以下都因「严格文件边界」未落地，全部指向**只新建文件**之外的目标，需主控统一接线。

### 3.1 `server/serverTypes.ts`

- **导入区**（`tips: TeacherTipService` 那一行附近）加：
```ts
import type { PortfolioExportService } from './portfolio/PortfolioExportService'
import type { PortfolioExportRecorder } from './portfolio/ports'
```
- **`ApiContext` 接口**（`tips: TeacherTipService` 之后）加：
```ts
  portfolio: PortfolioExportService
  portfolioExports: PortfolioExportRecorder
```

### 3.2 `server/serverContext.ts`

- **导入区**（`TeacherTipService` 附近）加：
```ts
import { PortfolioExportService, PortfolioExportStore } from './portfolio'
import { seedQuestionId } from './questionbank/seedFromAssignments'
```
- **在 `const tips = new TeacherTipService(...)` 块之后、`const context: ApiContext = {` 之前**加：
```ts
  const portfolioExports = new PortfolioExportStore({ database: productDb })
  const portfolio = new PortfolioExportService({
    attempts: store,
    questions: {
      // Demo 的旧路径 Attempt 带的是裸 assignmentId（如 'calculator'），
      // 题库里以 'seed:<assignmentId>' 落库 —— 复合读取兜底，保证 demo 包非空。
      get: (id) => questionStore.get(id) ?? questionStore.get(seedQuestionId(id))
    },
    org,
    aliases: {
      getDisplayName: (studentId) => auth.getPublicUser(studentId)?.displayName
    },
    now: () => new Date()
  })
```
- **`context` 对象**（`tips,` 之后）加：
```ts
    portfolio,
    portfolioExports,
```

### 3.3 `server/index.ts`

- **导入区**（`handleTeacherApi` 附近）加：
```ts
import { handlePortfolioApi } from './portfolio'
```
- **在 `handleTeacherApi` 的 if 块之后、`handleMediaApi` 的 if 块之前**插入：
```ts
  if (
    await handlePortfolioApi(request, response, requestUrl, {
      db: context.productDb,
      portfolio: context.portfolio,
      org: context.org,
      user,
      exports: context.portfolioExports,
      audit: context.audit
    })
  ) {
    return
  }
```

### 3.4 `tests/architecture.test.ts`（PRD 指定新增守护，因文件边界未改，供主控粘贴）

在文件末尾追加一个 describe：
```ts
describe('architecture guard: T23 portfolio export stays read-only', () => {
  const SCORING_PATH_PATTERNS = [
    /(^|\/)mastery(\/|$)/,
    /(^|\/)review(\/|$)/,
    /(^|\/)runner(\/|$)/,
    /(^|\/)tutoring(\/|$)/
  ]

  it('server/portfolio never imports scoring/mastery/runner/tutoring paths', () => {
    const violations = findForbiddenImports(['server/portfolio'], SCORING_PATH_PATTERNS)
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T23 违规：server/portfolio 必须与打分路径物理隔离（导出只读，ADR-0001）。',
            '违规导入：',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })

  it('portfolio module never writes scoring tables', () => {
    const violations: string[] = []
    for (const filePath of collectSourceFiles('server/portfolio')) {
      const source = readFileSync(filePath, 'utf8')
      if (
        /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(mastery_scores|review_cards|evaluations|attempts)/i.test(source)
      ) {
        violations.push(filePath.slice(projectRoot.length + 1).replace(/\\/g, '/'))
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : ['T23 违规：作品集导出不得写计分表（ADR-0001）。', `违规文件：${violations.join(', ')}`].join('\n')
    ).toEqual([])
  })
})
```
（`findForbiddenImports` / `collectSourceFiles` / `formatViolations` / `projectRoot` 该文件已定义，直接复用。）

### 3.5 前端入口（PRD：「我的成绩/错题」旁 + 教师学员详情，因不能改前端路由/侧边栏文件，仅给接入说明）

- **学生「我的成绩/错题」页**：加一个按钮「导出证据包」，`POST /api/student/portfolio/export`，body `{ teachingUnitId }`，用 `fetch` 拿 blob 触发下载（响应头已带 `content-disposition`）；需要预览时 `GET`/`POST ?format=json` 直接渲染。
- **教师学员详情页**：加按钮「导出证据包」，`POST /api/teacher/portfolio/export`，body `{ studentId, teachingUnitId }`。

## 4. 验证结果

- `npx tsc --noEmit`：**T23 全部 0 错误**。全仓仅剩 `server/flashcardDraft/FlashcardDraftService.ts(326,28)` 两处错误 —— 那是并行中的 T22 模块（未跟踪文件，非本次改动），按约定未修。
- `npx vitest run tests/portfolioExport.test.ts`：**27/27 通过**（纯函数内核 5 + Service 编排 7 + zip 2 + HTTP 端点 10 + 架构守卫 2 + 导出只读 1）。

对照验收清单（ISSUE-T23）：
- ✅ Demo 代码题 100 分 Attempt 可导出 JSON 含满证据（`buildPortfolio` + `?format=json` HTTP 测试：`score=100`、两条证据原子、`findUnbackedPortfolioAttempts` 为空）。
- ✅ 权限与审计：越权全部 403（学生导他人 / 教师导非在读 / 教师导别班单元 / 学生访问教师端点 / 学生不在在读名单）+ 每次成功导出写台账与审计链。
- ✅ 架构：`server/portfolio` import 图不含 scoring 路径；SQL 不写计分表；行为断言导出后 `mastery_scores` / `evaluations` 行数不变。
- ✅ LLM 辅导对话默认不打入包：包 JSON 断言无 `llm_inference` / `dialogue` / `conversation`。
- ✅ 实现报告完成（本文件）。

## 5. 未覆盖项 / 已知取舍

1. **裸 assignmentId 的 demo 旧 Attempt**：通过 §3.2 的复合 `questions.get` 兜底；若主控不接该兜底，历史 demo Attempt（`questionId` = 裸 assignmentId）因查不到题型会被默认筛选排除 → 包为空。新路径（T07 `StartPractice` 起题）不受影响。
2. **PII 检测保守性**：题干如「学生张三…」这类含上下文标记的教学示例，会被 PIIDetector 判命中并整段隐去（ADR-0003 宁可隐去）。如需保留可后加"题干白名单"。
3. **zip 用 STORE（不压缩）**：Demo 规模够用且字节确定；体积敏感时再引压缩库。
4. **未做**：`GET` 历史导出列表端点（台账有 `list`，前端如需回看可后加只读端点）、公开作品墙 / 点赞 / 一键同步 / 证书模板（PRD Out of Scope）。
5. **架构守护未进 `tests/architecture.test.ts`**：因文件边界禁止修改，等价守护已内嵌在本模块自己的测试文件（`tests/portfolioExport.test.ts` 第 5 组），并附 §3.4 供主控粘贴进全仓架构测试。
