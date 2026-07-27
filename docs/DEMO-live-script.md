# 现场演示脚本 + 专家问答准备

**用途**：决赛 / 专家答辩现场 10–15 分钟主路径 + 问答备稿。  
**身份常量**：学员 `learner-demo` · 教师 `teacher-demo` · 单元 `tu-demo` · 预置题 `seed:<assignmentId>`。  
**推荐端口**：`http://127.0.0.1:5280`（本机 `4173` 可能 EACCES）。

```powershell
cd D:/code_space/evidence-loop
$env:PORT='5280'; npm run dev
# 或：node output/restart-dev-server.cjs
```

角色切换：侧栏「演示角色切换」+ 请求头 `x-demo-role`（dev-only MockSession）。

---

## 0. 开场 30 秒（讲清楚产品是什么）

**循证环 · EvidenceRing = 循证实训 Agent**：学生作答 → Runner 产出可复现证据 → 分数只来自证据；LLM 只能辅导/讲解，**永不改分**。  
练习态与测评态分流（D1）：练习喂 FSRS 复习，不进正式掌握度；测评计入正式 MasteryProfile。

一句话铁律（可板书）：

> 分数只来自可复现证据；消息不是分；终裁不折叠进 score。

---

## 1. 主演示路径（约 8–10 分钟）

### A. 学生：收提示 → 今日该练 → 双模 → 错题本（~4 min）

| 步 | 操作 | 口述要点 | 验收信号 |
|----|------|----------|----------|
| 1 | 角色切到**学生**，打开「我的练习」 | 学生工作台聚合：老师提示、今日该练、双模、场次、错题本 | 页头可见 D1 说明 |
| 2 | **老师提示**收件箱 | T14 站内消息：只读投递，**不写 score / evidence / MasteryProfile** | 有未读则角标；点「标已读」 |
| 3 | 「今日该练」点一题 → **练习态** | 练习态可求助；辅导 generator 与打分路径物理隔离 | 进入作答 / 辅导入口可用 |
| 4 | （可选）练习态点「求助」问一步 | 辅导产出是 `llm_inference`  provenance，**不改分** | 辅导文本出现；分数区无被改写 |
| 5 | 提交一题（可故意做错） | Attempt 是产品级作答单元；完成态才入掌握/复习 | 有结果反馈 |
| 6 | 打开**错题本** → 重练 | 重练进**练习态**，不伪装成测评掌握 | 错题条目 + 重练入口 |
| 7 | 再开一题走**测评态**（若有入口） | 测评态独立完成；正式掌握度只吃测评证据 | 徽章「测评态」 |

### B. 成套测评计时壳（~1 min，仪式感）

| 步 | 操作 | 口述要点 | 验收信号 |
|----|------|----------|----------|
| 1 | 教师侧先布置一套 **测评态** 手选题（见 C） | 后端 `paper` 成套；session 从 Attempt 元数据派生 | 布置成功 banner |
| 2 | 学生「练习场次」中找 **成套 + 测评态** | 计时壳是 UI 仪式：倒计时 + 统一交卷，**不改分** | 倒计时 /「交卷」按钮 |
| 3 | 点「交卷」 | 本地仪式态「已交卷」；各题 Attempt 仍按原提交流程计分 | 状态变为已交卷 |

> 说明：计时壳不发明第二套计分 API；证据与分数仍在单题 Attempt 闭环里。

### C. 教师：布置 → 发提示 → 批改终裁（~4 min）

| 步 | 操作 | 口述要点 | 验收信号 |
|----|------|----------|----------|
| 1 | 角色切到**教师**，使用演示单元 `tu-demo` | 教师工作台 | 单元上下文正确 |
| 2 | **布置作业**：手选题 + 测评态；学生可选 `learner-demo` | 三种形态：手选 / 按 KP / 按薄弱点；均可带截止时间 | 成功创建 attempt 占位 |
| 3 | **发提示**（T14） | 可多选学生或留空=全班；正文站内投递 | 「已投递 N 人」+ 历史列表已读计数 |
| 4 | 回到学生侧刷新收件箱 | 闭环：教师发 → 学生收 | 新提示可见 |
| 5 | **主观题批改 / 终裁**（有待裁则演示） | 终裁写 `result.teacherAnnotation`（+ signature），**永不折叠进 `result.score`**；无批量给分 | 终裁区与客观分并列 |
| 6 | （可选）导出 CSV | 教务导出 fog 项；CSV 已有 | 下载触发 |

### D. 学情一眼（~30 s）

- 打开班级学情：中位分尊重终裁门；`pendingAdjudication` 主观题不进正式中位分。
- 点明：Cohort 统计与 D1 / 终裁门一致，不是「把所有分平均一下」。

### E. 多模态（可选 1–2 min，有 flag 时）

前置：`MULTIMODAL_ENABLED=true`。  
脚本见：

- [DEMO-multimodal-math.md](./DEMO-multimodal-math.md)
- [DEMO-multimodal-essay.md](./DEMO-multimodal-essay.md)
- [DEMO-multimodal-code.md](./DEMO-multimodal-code.md)
- [DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md)（弱网 / 无阿里云 STT）

口播红线：语音只读讲解与高亮；**评分不变**（ADR-0005）。

---

## 2. 时间盒建议

| 时长 | 内容 |
|------|------|
| 0:00–0:30 | 开场铁律 |
| 0:30–4:30 | 学生主路径 A |
| 4:30–5:30 | 成套计时壳 B（若已布置成套） |
| 5:30–9:30 | 教师 C + 学情 D |
| 9:30–11:00 | 多模态 E 或 Q&A |
| 11:00–15:00 | 专家问答 |

若只剩 5 分钟：只做 **开场铁律 → 学生练习态求助不改分 → 教师终裁不折叠 → T14 提示不是分**。

---

## 3. 专家问答备稿（Q&A）

### Q1. 为什么相信分数不是模型「编」的？

**A**：评分只消费 Runner 产出的 `Evidence`；LLM 路径的 provenance 是 `llm_inference`，架构与产品门禁禁止其改写 `score`。ADR-0001；辅导 generator 与打分路径物理隔离。可用练习态求助前后对比分数不变来现场证伪。

### Q2. 练习态和测评态有何不同？（D1）

**A**：

| | 练习态 | 测评态 |
|--|--------|--------|
| AI 辅导 | 开放（mode gate） | 关闭 / 403 |
| FSRS 复习 | 可喂 | 按产品规则 |
| 正式 MasteryProfile | **不进** | **进入** |
| 典型用途 | 订正、今日该练、错题重练 | 作业/成套测评 |

UI 用徽章显式标识，避免「练着练着变成考了」。

### Q3. 教师终裁会不会直接改客观分？

**A**：不会。终裁写入 `result.teacherAnnotation`（provenance `teacher_annotation`）并带签名语义，与 `result.score`（客观自动分）并列；不折叠、不批量给分。待终裁主观题在 cohort 正式中位分中排除（`pendingAdjudication`）。

### Q4. T14「发提示」会不会变成暗箱加减分？

**A**：提示是站内消息。投递只碰 tip store / 已读状态；**永不写 score / evidence / MasteryProfile**。学生收件箱只读展示。与布置作业的 `studentIds` 选择类似，但是消息不是任务分。

### Q5. 成套卷计时交卷是否另有一套成绩逻辑？

**A**：否。`PracticeSession.shape='paper'` 由 Attempt 的 `paperId` 等元数据派生；计时 + 统一交卷是学生侧仪式壳。分数仍在各题 Attempt 的评价闭环里产生，符合「Attempt 是聚合根」。

### Q6. 数据与合规怎么说？

**A**（Demo 边界要诚实）：

- 容器：Docker + `--network=none` + 资源限制（复赛基线）。
- 审计：SQLite WAL + 哈希链 + HMAC 签名批量写。
- Demo 假多租户 + `X-Security-Warning`；真审计仍记伪角色操作。
- PII 规则扫描；T10 egress：**学生 PII 永不出境**。
- Demo 用本地 JSON / 匿名样例，不接真实学籍成绩系统。

### Q7. 多模态会污染评分吗？

**A**：不会。语音管线独立；审计记 `modality:'voice'` 元数据；ADR-0005 规定语音只读、不改分。Feature flag 关闭即回退复赛前状态。

### Q8. 自适应 / 薄弱点布置如何避免「未做就算掌握」？

**A**：按薄弱点布置生成的是**占位 Attempt**；未提交不入掌握度。`NextPracticeService` 组合 FSRS due ∩ 依赖链弱点 ∩ 已留进度；与 D1 一致。

### Q9. 和「聊天式 AI 家教」差异？

**A**：我们不是对话即分数。编排是「读取任务 → 受限验证 → 量规评分 → 知识匹配 → 反馈」；仅反馈步可读记忆写记忆，评分步严格本轮证据。可解释、可审计、可复现。

### Q10. 已知未做 / 有意后置？

**A**（主动披露加分）：

| 项 | 状态 |
|----|------|
| 成绩 Excel/PDF 教务导出 | fog；CSV 已有 |
| S4 list 性能 / S5 demo id 耦合 | Demo 可接受 |
| 激励 / 家长报告 / 课标对齐 | MAP 未规格化 |
| 短信 / 推送 / 家长端提示 | T14 出界 |
| 多模态 Phase 2+ | 见 ROADMAP |

---

## 4. 故障应急

| 现象 | 处理 |
|------|------|
| 端口 EACCES | `$env:PORT='5280'; npm run dev` 或 `node output/restart-dev-server.cjs` |
| 侧栏角色不对 | 再切一次演示角色；硬刷新 |
| 无老师提示 | 教师侧对 `tu-demo` 发一条；学生刷新 |
| 无成套场次 | 教师手选 ≥2 题测评态布置后再看学生场次 |
| 多模态不亮 | 查 `MULTIMODAL_ENABLED`；见 fallback 脚本 |
| 终裁入口空 | 选主观题待裁 attempt；或改讲「终裁数据模型」用已有截图/报告 |

---

## 5. 一页备忘（可打印）

**完整卡点（时间盒 + Q&A 脱口 + 故障表）：** [DEMO-cue-card.md](./DEMO-cue-card.md)

```
身份: learner-demo / teacher-demo / tu-demo
铁律: 证据打分 · LLM 不改分 · 练习≠正式掌握 · 终裁不折叠 · 提示不是分 · PII 不出境
学生: 提示收件箱 → 今日该练(练习) → 求助不改分 → 错题重练 → 成套计时交卷(仪式)
教师: 布置 → 发提示(多选/全班) → 批改终裁 → 学情中位分尊重门禁
多模态: docs/DEMO-multimodal-*.md · 只读不改分
端口: 5280
```

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [DEMO-cue-card.md](./DEMO-cue-card.md) | 一页现场卡点（推荐贴屏） |
| [DEMO-oral-10min.md](./DEMO-oral-10min.md) | 10 分钟口播逐字稿（照念 + 操作时码） |
| [HANDOFF.md](../HANDOFF.md) | 任务边界与铁律 |
| [CONTEXT.md](../CONTEXT.md) | 域语言 |
| [PRODUCT-MAP.md](./product-roadmap/PRODUCT-MAP.md) | 十票地图 |
| [T14-implementation-report.md](./product-roadmap/reports/T14-implementation-report.md) | 提示实现 |
| [T07-implementation-report.md](./product-roadmap/reports/T07-implementation-report.md) | 学生场次 / paper |
| ADR-0001 / 0005 / 0008 | 评分铁律、多模态、题型引擎 |
