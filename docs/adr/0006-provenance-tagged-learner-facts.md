# ADR 0006：Provenance-tagged learner facts

## 状态

已采纳（覆盖 #2 记忆与自适应方向全阶段）

## 背景

记忆与自适应方向要求在项目中引入长期学情画像——记录学生的掌握度变化、学习偏好、误解模式，用于个性化学习路径与复习计划。

**核心矛盾**：ADR-0001 的铁律是"评分事实只来自可复现证据，LLM 不得改分或捏造事实"。但学情画像必须包含：
- **硬事实**（有证据）：某学生在"递归"知识点失败 3 次 → 掌握度 30%
- **软语义**（无硬证据）：学生偏好逐步引导 / 下午 3 点后错误率上升 / 从代码风格看理解停留在表面

如果软语义参与"评价性决策"（推荐题目、调整反馈），它就与 ADR-0001 冲突了吗？

## 决策

**ADR-0001 不修订。** 铁律的真正含义不是"禁止 LLM 参与"，而是"**LLM 参与的部分和它不参与的部分，在类型系统里必须可分辨**"。通过 6 项设计固化这条边界：

### 1. 双聚合根强制隔离

引入两个**互不写入**的聚合根：

```typescript
// 硬事实聚合根
MasteryProfile {
  masteryLevel: number         // 由证据聚合算法确定性计算
  knowledgePoint: KnowledgePointId
  evidenceRefs: EvidenceId[]   // 参与本次计算的证据 ID
  algorithm: "simple.v1" | "bkt.v1" | "fsrs.v5"
  computedAt: timestamp
}

// 软语义聚合根
LearnerNarrative {
  patterns: NarrativeFragment[]  // "对递归停留在表面"这类推断
  provenance: LLMExtractionMeta  // 强制字段
  // 严禁包含数值型 mastery
}
```

**关键护栏**：
- `MasteryProfile.compute()` 是**纯函数** `(Evidence[]) → number`
- **禁止入参包含 `LearnerNarrative`**
- CI 加架构测试（如 `dependency-cruiser` 规则）在流水线里守住这条线

### 2. Provenance 必填字段

所有学情事实携带 `provenance` 字段，**TypeScript 层面强制非可选**：

```typescript
type Provenance =
  | { kind: "evidence"; evidenceIds: string[]; algorithm: string }
  | { kind: "llm_inference"; sourceMessages: MessageId[]; model: string; extractedAt: Date; confidence?: number }
  | { kind: "learner_self_report"; sessionId: string }
  | { kind: "teacher_annotation"; teacherId: string; note: string }

interface LearnerFact {
  content: string | number
  provenance: Provenance      // 非可选
  createdAt: Date
}
```

**理由**：可选就等于没有——业务代码必然遗漏"如果 provenance 存在则显示徽章"。必填 + 编译期强制是唯一可靠路径。

### 3. UI 三色系统 + "只看证据层"开关

| 类型 | 视觉 | 交互 |
|------|------|------|
| Evidence-backed | 蓝色 + 盾牌图标 | 可点击→溯源到具体测试用例/静态检查 |
| LLM inference | 灰色 + 气泡图标 + "AI 推断"徽章 | 悬浮显示"基于 N 条对话推断，未经证据验证" |
| Self-report | 绿色 + 对话图标 | 悬浮显示"学生自述，未验证" |
| Teacher note | 橙色 + 教师图标 | 显示教师签名 |

**教师面板必须提供"只显示证据层"开关**——面对家长/学校时的免责视图。

### 4. 学习路径主干-调味分层

```
PathDecision {
  // 硬输入（确定性，可复现）
  hardInputs: { masteryMatrix, knowledgeDAG, schedule }
  → candidateTasks: TaskId[]     // 主干输出，纯函数

  // 软输入（顾问性，不改变候选集）
  softInputs: { preferences, circadianContext, emotionalState }
  → presentationHint: PresentationStyle    // 只影响 UI/文案，不改 candidateTasks
}
```

**决定性检验**（可写成测试）：**同样的 hardInputs，`candidateTasks` 必须字节级一致**，与 softInputs 无关。

### 5. 五步闭环的读写边界

| 步骤 | 读记忆 | 写记忆 | 记忆能影响输出吗 |
|------|--------|--------|-----------------|
| 1. 读取任务 | ❌ | ❌ | — |
| 2. 受限验证 | ❌ | ❌ | — |
| 3. 量规评分 | **❌** | ❌ | **绝对不能** |
| 4. 知识匹配 | ❌ | ❌ | ❌ |
| 5. 反馈生成 | ✅ | ✅ | ✅（仅叙事） |

**反馈生成中的护栏**：
- **可叙事引用**：`"你上次在这道递归题也在**终止条件**处失败——那次的证据是 [evidence#123]（可点击）"`。前提：引用的历史事件本身是 Evidence，可溯源。
- **不可自造断言**：不允许 `"你在递归上一直理解不深"`——这种"跨事件推断"必须显式标注 `"根据我们过去对话推断..."`
- **不改变步 3 输出**：即便记忆显示"该学生历史上在此点掌握度高"，也不能上调本次分数
- **不改变步 4 诊断**：即便记忆里学生说"我懂递归了"，只要本次证据显示失败，诊断结论就是薄弱

### 6. AdvisoryLayer 与 LearnerNarrative 的关系

两个概念本质是同一事物的不同侧面：
- **AdvisoryLayer**（ADR-0004）：面向**单次评估**的主观建议（作文立意等）
- **LearnerNarrative**（本 ADR）：面向**长期画像**的软语义抽取

两者共享 `provenance` 字段和"教师确认才计入正式指标"的边界。在实现层可以是同一个 domain object 的不同视图。

## 后果

### 正面
- ADR-0001 的锐利性不被稀释——铁律与个性化能力是**分层关系**而非替代
- 记忆层可以安全接入 LLM 抽取（Mem0 借鉴或自建）而不威胁评分公信力
- 教师"只看证据层"是信任构建的核心 UX——一旦被误当成事实，整个合规立场崩塌
- Provenance 强制字段让审计溯源无损

### 代价
- 数据模型比"一张表存所有事实"更复杂（双聚合根 + 强制字段）
- UI 必须做三色区分，视觉设计成本增加
- CI 需要额外的架构测试守护"MasteryProfile 不读 LearnerNarrative"
- 团队必须理解并遵守"跨事件推断需显式标注 provenance"的写作规范

## 一句话总结

**铁律不是"禁止 LLM 参与"，而是"禁止 LLM 参与的部分和它参与的部分，在类型系统里必须可分辨"。分辨性一旦通过 `provenance` 字段和聚合根隔离固化到模型层，长期记忆就可以安全接入软语义层。**

## 相关决策

- ADR 0001：证据优先评分（本 ADR 是其在长期记忆场景的具体化）
- ADR 0004：多学科证据模型（AdvisoryLayer 与 LearnerNarrative 的共同基础）
- ADR 0007：记忆层技术选型（本 ADR 决策的技术承载）
