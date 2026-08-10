# [wayfinder:ticket] T20 证据驱动的轻激励（克制版）

## Question

PRODUCT-MAP fog「激励体系」与黑客松游戏化（打卡/徽章）之间取折中：**只奖励可复现证据与闭环完成**，不做排行榜/社交 PK（Out of scope）。语气保持「严谨实验报告」，动效服从 `prefers-reduced-motion`。

**来源**：国外教育黑客松调研 Wave B-⑥；PRODUCT 反模式：不低幼、不花哨。

**Blocked by**: T01（Attempt）、T07（错题移出规则）、掌握度读模型

---

## 要定什么

1. **可授予的成就（MVP 固定目录）**

| id | 条件（硬） | 展示名 |
|----|------------|--------|
| `first_evidence_pass` | 首次 assessment 全证据通过 | 首枚证据通过 |
| `repair_plus_20` | 同题连续两次 assessment，分差 ≥20 | 修复闭环 |
| `weak_kp_cleared` | 某 KP 错题本按 T07 规则移出活跃 | 薄弱点清除 |
| `streak_study_3` | 连续 3 个日历日有 practice 或 assessment | 三日研习 |
| `plan_day_done` | T18 当日 tasks 全完成（若 T18 未上则不做） | 今日计划完成 |

2. **禁止**  
   - 全班排名、公开羞辱性对比、付费加速、随机抽奖徽章。  
   - 用 LLM 评判「学习态度」发奖。

3. **存储**  
   - `StudentAchievement { studentId, achievementId, earnedAt, evidenceRef? }`  
   - 可重放：条件可从 Attempt 重算；展示用缓存。

4. **UI**  
   - 学生工作台侧栏「证据成就」列表（克制图标 + 一句话条件）。  
   - 达成时 **非阻塞** toast；`prefers-reduced-motion` 无动画。  
   - 教师可选看班级成就计数（聚合），不展示排行榜。

5. **与分数关系**  
   - 成就 **零影响** score / MasteryProfile 算法。

---

## 建议 MVP 形状

### API

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/student/achievements` | student | 已获得 + 目录进度 |
| POST | `/api/internal/achievements/recompute` | system/test | 重算（或评估后钩子） |

评估成功路径 hook：写 Attempt 后异步/同步检查成就（保持简单可同步）。

### 测试

- 成就写入不改 score。  
- 条件边界：分差 19 不授 `repair_plus_20`。  
- 重算幂等。

---

## 出界（本票不做）

- 积分商城、虚拟货币  
- 好友 PK、公会  
- 复杂徽章编辑器  
- 音效包  

---

## 验收（Done 定义）

1. Demo 路径「80→100」可点亮 `repair_plus_20`。  
2. 学生成就列表可见；无排行榜入口。  
3. 铁律/架构测试：成就模块不写 score。  
4. 实现报告 `docs/product-roadmap/reports/T20-implementation-report.md`。

---

## 状态

**OPEN** — 待实现。依赖 T18 的成就可标记 optional。

## 关联

[[T07-student-experience]] [[T18-hard-fact-study-plan]] PRODUCT.md Brand / Anti-references  
PRODUCT-MAP fog：激励体系。
