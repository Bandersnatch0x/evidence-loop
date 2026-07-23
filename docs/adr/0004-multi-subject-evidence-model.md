# ADR 0004：多学科证据模型

## 状态

已采纳（覆盖 Phase 1，Phase 2 canvas 场景由 ADR-0007 补充）

## 背景

ADR-0001 定义的 Evidence 是"测试用例或静态检查的可复现结果"，这在代码作业下够用；但项目演进方向包含数学、作文等非代码作业：

- **数学作业**：没有单元测试，只有"答案对错 + 解题步骤合理性"
- **作文作业**：没有可验证事实，只有"结构、语法、内容质量"这些主观维度

这挑战了 ADR-0001 的立身之本——铁律是否只适用于代码？还是可以扩展到多学科而保持锋利？

## 决策

**不修订 ADR-0001。ADR-0001 的核心命题（"分数只由证据，LLM 不改分"）在扩展后依然成立。** 通过重新划定 Evidence 的**外延**来覆盖多学科：

### 1. Evidence 的可复现性判据不变，外延扩展

`Evidence.type` 枚举扩展为：
- `test_case`：单元测试结果（代码）
- `static_check`：静态分析结果（代码）
- `cas_check`：CAS 步骤等价性校验（数学）
- `answer_match`：最终答案匹配（数学）
- `lint_result`：语法/结构 linter 结果（作文）
- `structural_metric`：字数、句长方差、成语密度等确定性度量（作文）

判据：**给定输入必有确定性输出，无 LLM 幻觉**。CAS 的 `simplify(step_n - step_{n+1}) == 0` 与单元测试同构；作文 linter 是启发式规则的确定性执行。

### 2. Runner + Rubric 统一抽象

所有学科走同一评分闭环：

```
interface Runner {
  run(submission: Submission): Evidence[]   // 必须确定性、可沙箱
}

// 实现
CodeRunner       → Docker + 测试/静态分析      → Evidence{type: test_case | static_check}
MathRunner       → CAS 子进程 + 答案比对        → Evidence{type: cas_check | answer_match}
EssayRunner      → linter 管线                 → Evidence{type: lint_result | structural_metric}
```

**RubricEngine.score(rubric, evidence[]) → Score** 学科无关、确定性纯函数。

### 3. AdvisoryLayer：承认主观维度的存在

作文的立意、创意、洞察等**不存在可复现证据**的维度，走独立通道：

```
AdvisoryAgent.suggest(submission, evidence[]) → AdvisorySuggestion[]
```

- **AdvisorySuggestion 不入 Score**，是教师视图的输入
- **教师确认前只可见不可计分**（Cohort 指标不包含未确认的建议）
- ADR-0001 的边界"教师视图只给干预建议，不自动写正式成绩"天然覆盖这里

### 4. 术语泛化

- "受限运行 (Bounded Execution)" → "**受限验证 (Bounded Verification)**"
- 涵盖 Docker 沙箱、CAS 子进程、linter 管线三种"跑起来但不都是执行代码"的场景
- 隔离/确定性/无网络访问的核心约束不变

### 5. EvaluationAgent 五步闭环的演化

| 步骤 | 代码 | 数学 | 作文 |
|------|------|------|------|
| 1. 读取任务 | 不变 | 不变（Schema 扩展） | 不变 |
| 2. 受限**验证** | Docker 跑测试 | CAS 校验步骤等价 | linter 管线 |
| 3. 量规评分 | 全部客观 | 全部客观 | **分叉**：客观→Score；主观→AdvisorySuggestion |
| 4. 知识匹配 | 代码错误分类 | 代数错误分类 | 写作能力标签 |
| 5. 反馈生成 | 文本 | 文本 + DOM 指点 | 文本 + DOM 指点 + 教师确认队列 |

## 后果

### 正面
- ADR-0001 的锐利性不被稀释——它继续是"边界"而非"描述"
- 多学科接入不需要重复建评分、审计、诊断三层
- 复赛容器决策（Docker 池化）自然扩展到数学（复用 Docker 池跑 CAS）
- Cohort 视图仍处理同质的 Score，AdvisorySuggestion 是独立视图

### 代价
- CAS 弱项（几何证明、组合数学）必须显式标记"暂不支持"而非降级为 LLM 判分
- 需要一套"允许的代数变换白名单"或直接信任 CAS 判定
- 作文接入前，`AdvisoryLayer` 域概念必须先落地并明确教师确认流程
- `Runner` 接口需要覆盖 Docker/子进程/纯库三种运行时形态

## 相关决策

- ADR 0001：证据优先评分（本 ADR 是其在多学科维度的具体化）
- ADR 0002：容器隔离选型（CodeRunner 的实现基础）
- ADR 0005：多模态提交与视觉指点（Runner 的输入 SubmissionForm 定义）
- ADR 0006：Provenance-tagged learner facts（AdvisoryLayer 与 LearnerNarrative 的关系）
