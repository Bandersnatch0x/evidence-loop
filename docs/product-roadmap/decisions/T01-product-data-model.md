# [wayfinder:grilling] T01 产品级数据模型（全图地基）

## Question

D1-D4 四个裁决联合要求一个能撑起产品的数据模型。定义核心实体与关系，使认证/题库/学情/闭环都能挂其上：

- **组织**：Term（学期）、Class（行政班）、Subject（学科）、TeachingUnit（班级×学科）、Enrollment（学生-班）
- **人**：User（学生/老师两层）、账号-身份绑定
- **内容**：Question（题，含 questionType/答案/知识点/来源可信度 test_case|authored_key/标准解析）、题库归属（老师私有）
- **做题**：Attempt（做题记录，带 mode: practice|assessment、termId）、错题聚合
- **证据/学情**：现有 Evidence/MasteryProfile 如何加 mode/termId/来源分级；已教知识点集合怎么存

产出：实体关系图（文字）+ 关键字段 + 现有 JSON 结构如何迁移。这是全图最底层，其他票几乎都 block on 它。

**Blocked by**: 无（地基，最先）

---

## Status: RESOLVED（closed）

## 裁决（综合领域建模/存储架构/铁律守护三视角圆桌）

### 核心：Attempt 聚合根收敛四约束
散落的 `EvaluationResult` 收敛成 **Attempt 聚合根**，D1-D4 四约束落为 Attempt 上的四个**必填判别字段**，让"可复现/权威/模型推断"三态在类型系统里永远可分辨：

```typescript
type SessionMode = 'practice' | 'assessment'          // D1
type EvidenceAuthority =                                // D2
  | { source: 'test_suite' }                            // 代码题，答案即行为，最高
  | { source: 'authored_key'; authorId: string; verifiedBy?: string }  // 导入题，人填，可推翻

interface Attempt {                    // 取代裸 EvaluationResult
  id: string
  studentId: string
  questionId: string
  teachingUnitId: string               // D3 谁在教
  termId: string                       // D4 学期切片
  mode: SessionMode                     // D1
  createdAt: string
  result: EvaluationResult             // 复用现有，内嵌
}
interface Evidence extends EvidenceItem { authority: EvidenceAuthority }  // D2
```

### 四聚合根（不跨根持引用，只持 ID）
1. **Person**（User：学生/老师两层，账号-身份绑定）
2. **OrgUnit**（Term/Class/Subject/TeachingUnit=班级×学科/Enrollment）
3. **Question/QuestionBank**（从 Assignment 演进；含 questionType/答案/知识点/authority/标准解析；老师私有）
4. **Attempt**（新增，核心）；Evidence 是 Attempt 内部实体，不独立成根

### 派生读模型（按 mode 分流）
- MasteryProfile / ReviewCard 降为 **Attempt 事件流派生的读模型**，不是根
- **投影器分流**：`practice` → 只喂 FSRS + 练习掌握度（独立命名空间）；`assessment` → 才写正式 MasteryProfile
- `MasteryProfile.compute()` 纯函数**入参只接受 assessment 证据**（CI 架构测试守护，复用 ADR-0006 §1 dependency-cruiser 手法）

### D3 组织模型（两层不变，班升级为教学单元）
```typescript
interface Term { id; name; startAt; endAt }
interface TeachingUnit { id; teacherId; classId; subject; taughtKpIds: string[]; termId }  // D4 已教KP
interface Enrollment { studentId; classId; termId }
```
学情查询按 `termId` + `taughtKpIds` 交集裁剪：未教 KP 不进 CohortSnapshot 报警（D4）。

### 存储演进（换 Postgres 时业务层零改动）
- **SQLite + Drizzle**（收编现有手写 ensureColumn 为 migration 0001），不上 Postgres——触发点是"多进程并发写"，那时再迁
- **EvaluationStore 接口作为唯一数据入口** → 演进为 `AttemptStore`；JSON→SQLite 走 expand-contract（新建 SqliteStore + backfill 脚本 + 双写影子读 + 切换 + 删 JSON）
- **题库媒体**：图片内容寻址落 `data/media/<hash>.<ext>`，DB 只存路径（绝不进 BLOB）；上云换 S3 前缀，DB 不动
- 复合索引围绕热查询：`(class_id, assignment_id)`、`(student_id, created_at DESC)`、`(subject_id, kp_id)`

### 铁律 provenance 协同
- `authored_key`(D2) ↔ `teacher_annotation`(人工权威)；`test_case` ↔ `evidence`(机器)。冲突时 authored_key 优先，两者皆可复现证据，不破铁律，且可追溯/可推翻
- AI 三层辅导(D3-tutoring)一律 `llm_inference`，**结构上不写 EvidenceItem**（类型层护栏，非纪律）
- 教师终裁 `teacher_annotation`（必填 teacherId+note 签名），写独立字段非 earnedScore，"只看证据层"开关可过滤

**一句话**：Attempt 聚合根 + 四必填判别字段 + 按 mode 分流的派生读模型 + SQLite/Drizzle/接口隔离，用最小架构变更承载全部产品约束且零破铁律。
