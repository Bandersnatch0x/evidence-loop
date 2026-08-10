# T17 多 Agent 产品叙事包装 — 实现报告

## 范围

**纯叙事包装。** 把现有服务切分（RunnerRegistry / 知识匹配 / Tutoring / NextPractice / Advisory）
显式命名为五个对外 Agent，配一份可被 UI、只读 API、口播、CI 同时引用的静态目录。

**不做**：新 Agent 框架、新进程、新消息总线、任何评分行为变更。ADR-0001 只被**展示**，不被修改。

## 完成

| 层 | 文件 | 内容 |
|----|------|------|
| **目录（单一事实源）** | `shared/agentCatalog.ts` | `AgentCatalogEntry` 接口 + `AGENT_CATALOG` 5 条：scoring / diagnosis / tutoring / assignment / advisory；每条含 id / name / internalModule / touchesScore / llmAllowed / inputs / outputs / prohibitions |
| **只读 API** | `server/transparency/transparencyRoutes.ts` | `GET /api/transparency/agents` → `{ agents, ironRule }`；纯静态投影，不读库、不写库、不审计；非 GET 返回 405 |
| **UI** | `src/components/transparency/AgentRosterView.tsx`、`agentRoster.css`、`index.ts` | 五张 Agent 卡片（输入 / 输出 / 禁止事项）+「评分路径零 LLM」铁律徽章；导出 `AgentRosterSection`（可嵌入现有透明度页）与 `AgentRosterView`（独立页面外壳） |
| **契约测试** | `tests/agentCatalog.test.ts` | 字段完整性、5 条目、`touchesScore===true ⇒ llmAllowed===false`、评分 Agent 是唯一碰分者且零 LLM、API 响应形状 |
| **Demo** | `docs/DEMO-oral-10min.md` 附录 D、`docs/DEMO-cue-card.md`「多 Agent 插播」 | 30 秒「多 Agent 但不碰分」口播 + 秒级卡点表 |

## Agent 编队（对外名 → 对内模块）

| Agent | 对内模块 | touchesScore | llmAllowed |
|-------|----------|--------------|------------|
| 评分 Agent | `RunnerRegistry + Rubric` | **是（确定性）** | **否** |
| 诊断 Agent | 知识匹配 / Intervention | 否 | 否 |
| 辅导 Agent | Tutoring / Socratic | 否 | 是（`llm_inference`） |
| 组卷/推题 Agent | NextPractice / 薄弱布置 / T16 | 否 | 否 |
| 教师建议 Agent | Advisory + 关注队列 + Tips | 否 | 是（待教师确认） |

## 待接线（本票不改共享 glue 文件，需人工粘贴）

**1. `server/index.ts`** — 顶部 import + 委托路由段（现有 `handle*Api` 之后）：

```ts
import { handleTransparencyApi } from './transparency/transparencyRoutes'
```

```ts
  if (handleTransparencyApi(request, response, requestUrl.pathname)) {
    return
  }
```

**2. `tests/architecture.test.ts`** — 追加契约守护（复用文件内既有 `findForbiddenImports` / `formatViolations`）：

```ts
describe('architecture guard: T17 catalog contract (scoring agent is LLM-free)', () => {
  it('every score-touching catalog entry declares llmAllowed === false', () => {
    const violations = AGENT_CATALOG
      .filter((agent) => agent.touchesScore && agent.llmAllowed)
      .map((agent) => `${agent.id} (${agent.internalModule})`)
    expect(
      violations,
      'ADR-0001 违规：碰分数的 Agent 不得允许 LLM。违规条目：' + violations.join(', ')
    ).toEqual([])
    const scoring = AGENT_CATALOG.find((agent) => agent.id === 'scoring')
    expect(scoring?.touchesScore).toBe(true)
    expect(scoring?.llmAllowed).toBe(false)
  })

  it('the scoring modules named by the catalog never import the tutoring LLM path', () => {
    const violations = findForbiddenImports(
      ['server/runner', 'server/mastery'],
      [/(^|\/)tutoring(\/|$)/, /callOpenAICompatible/, /TutoringService/]
    )
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T17 违规：目录声明「评分 Agent = RunnerRegistry + Rubric，零 LLM」，',
            '但评分模块 import 了 tutoring LLM 写回路径。目录不能是空话。违规导入：',
            formatViolations(violations)
          ].join('\n')
    ).toEqual([])
  })
})
```

需在该文件顶部补一行：`import { AGENT_CATALOG } from '../shared/agentCatalog'`。
（`server/domain/feedback.ts` 走 tutoring LLM 客户端属于五步闭环**第 5 步反馈生成**，
按 CONTEXT 合法，故守护范围只圈 `server/runner` + `server/mastery`。）

**3. 前端挂载（二选一）**

- **推荐（零冲突，路由/侧栏已存在「项目透明度」）**：在 `src/components/TransparencyView.tsx` 加
  `import { AgentRosterSection } from './transparency'`，并在最后一个 `</section>` 之后插入
  `<AgentRosterSection />`。
- **独立路由**：`src/components/Sidebar.tsx` 的 `AppView` 加 `| 'agents'`，`navigation` 数组加
  `{ id: 'agents', label: 'Agent 编队', icon: Bot }`；`src/App.tsx` 加
  `import { AgentRosterView } from './components/transparency'` 与
  `else if (activeView === 'agents') { mainBody = <AgentRosterView /> }`。

## 验证

| 命令 | 结果 |
|------|------|
| `node node_modules/typescript/lib/tsc.js --noEmit` | 0 error |
| `npx vitest run tests/agentCatalog.test.ts` | 9/9 通过 |
| 守护逻辑离线校验（runner + mastery × tutoring 模式） | violations: `[]` |

未跑全量套件（并行工单占用）。

## 口播五句金句

1. 「五个 Agent，只有一个碰分数。」
2. 「评分 Agent 是 `RunnerRegistry + Rubric`——确定性、零 LLM。」
3. 「辅导可以用大模型，但它的产物标 `llm_inference`，永不回写 score。」
4. 「这份编队目录是代码里的单一事实源，`GET /api/transparency/agents` 可直接拉。」
5. 「碰分数的 Agent 一旦被标成允许 LLM，CI 就红灯——多 Agent 是分工，不是分数的多个来源。」

## 出界（未做）

- 新 Agent 框架 / 消息总线 / 多进程编排
- 把辅导 Agent 接到改分路径
- 可视化拖拽 Agent 编排器
- PipelineBar 步骤名与 Agent 名对齐（文案层增强，另票）
