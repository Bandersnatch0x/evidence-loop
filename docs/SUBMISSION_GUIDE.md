# 报名 / 提交填表指南（决赛口径 · 2026-07-27）

表单字段建议值，**直接复制**。与初赛材料兼容；正文已按**产品化十票 + T11–T14** 更新。

---

## 0. 项目要不要改名？

### 结论：**不改名**

| 项 | 建议 |
|----|------|
| **作品正式名** | `EvidenceLoop · 循证实训 Agent` |
| **仓库 / package** | `evidence-loop`（保持） |
| **中文别称** | 循证实训 Agent（可单独出现） |
| **不推荐** | 换成「AI 家教 / 智能批改 / EduGPT」等泛名 |

**为什么保持：**

1. **品牌连续**：初赛 PPT、仓库、路演、截图、UI 标题均为 EvidenceLoop；决赛改名会割裂评委记忆。
2. **名字仍准确**：产品从「编程实训」扩到**多学科循证实训**，但核心仍是 **Evidence（可复现证据）→ Loop（提交–诊断–再练）**；「循证」是差异化，不是过时词。
3. **改名成本高、收益低**：GitHub、`package.json`、函数名 `createEvidenceLoopServer`、zip、演示脚本、E2E 选择器均绑定此名。
4. **赛道要求**看的是任务闭环与可信评分，不是新营销名。

**允许的「软扩展」（不是改名）：**

- 一句话简介里写清「多学科 / 双模 / 教师终裁」，不要只写 Python。
- 副标题可选：`EvidenceLoop · 循证实训 Agent（多学科证据闭环）`——**仅当表单「作品名称」字数够**；默认仍用短名。

**何时才考虑改名：** 商业化独立品牌、或组委会强制与已登记名冲突时——**当前都不成立**。

---

## 1. 固定字段

### 作品名称
```
EvidenceLoop · 循证实训 Agent
```

### 赛道
```
Boundless Agents 无界应用 · AI+教育
```
（大赛全称可写：杭州全球人工智能技术创新大赛 / 世界人工智能开源大赛）

### 代码仓库
```
https://github.com/Bandersnatch0x/evidence-loop
```

### Demo 链接
当前**未做公网部署**（执行不可信代码 + 本地数据，适合机房/本机演示）。

**建议填写：**
1. 非必填则留空，备注「现场本地 Demo」
2. 或填 README 启动锚点：
```
https://github.com/Bandersnatch0x/evidence-loop#快速启动
```

### 本地演示（材料附件 / 运行说明）
```powershell
cd evidence-loop
npm install
# Windows 若 4173/5173 EACCES，换端口：
$env:PORT='5280'; npm run dev
```
浏览器打开：`http://127.0.0.1:5280`  
（旧文档写的 `4173` 在部分 Windows/Hyper-V 环境会失败，以 `5280` 为准。）

可选 E2E 自检：
```powershell
node scripts/e2e-demo-loops.mjs http://127.0.0.1:5280
```
目标：**16 passed**。

### 许可证
```
Apache-2.0
```

---

## 2. 文案字段（更新后）

### 一句话简介（≤50 字优先）
```
用可复现证据驱动多学科实训：只证据打分，LLM 只辅导不改分，练习与测评分流，教师终裁可审计。
```

### 一句话简介（稍长 · 表单不限字时）
```
EvidenceLoop 是循证实训 Agent：学生作答后由题型 Runner 产出可复现证据并归约分数；大模型仅辅导讲解永不改分；支持练习/测评双模、教师布置与终裁、站内提示与班级学情，覆盖代码到多学科客观/主观题。
```

### 目标用户
```
中小学/高校实训学员；任课教师与助教；需要可复用 Agent 模板的课程/产品团队
```

### 场景痛点
```
自动批改只给对错；AI 讲评易幻觉且越权改分；练习与考试掌握度混计；教师缺少可审计的终裁与学情门禁；聊天式家教不可复现、难合规。
```

### 核心任务闭环
```
布置/今日该练 → 学生作答（练习态或测评态）→ Runner 产出证据 → 量规归约分数 →（可选）练习态 AI 辅导不改分 → 错题重练 / 复习调度 → 教师终裁与站内提示 → 班级学情（尊重终裁门与双模）
```

### 差异化要点（条目可拆成多框）
```
1. 分数只来自可复现 Evidence；LLM 路径与打分物理隔离（ADR-0001）
2. D1 双模：练习喂 FSRS 不进正式掌握；测评才进 MasteryProfile
3. 教师终裁写入 teacherAnnotation，不折叠进客观 score；无批量灌分
4. T14 站内提示是消息不是分；不写 score/evidence/掌握度
5. 7 题型 Runner + 9 学科知识点 DAG；多模态语音只读不改分（可 feature flag 关闭）
6. 容器隔离、HMAC 审计链、PII 扫描、学生 PII 不出境；Demo 假多租户诚实披露
```

### 技术栈
```
React 19 + Vite + TypeScript + Node HTTP；Zod；better-sqlite3 + Drizzle；
7 题型 Runner（含 Python 子进程/Docker 池）；FSRS；可选 LLM API / 阿里云 STT；Playwright E2E
```

### Agent 能力说明（若表单问 Agent）
```
任务理解：按题型与模式路由作答单元 Attempt。
流程编排：读取任务 → 受限验证 → 量规评分 → 知识匹配 → 反馈（评分步不读记忆写分）。
工具调用：RunnerRegistry、题库/布置、掌握度与复习、审计、可选多模态 STT。
知识增强：学科 KP DAG + 诊断映射。
多轮：错题重练、辅导多轮、教师终裁与提示闭环。
结果交付：可解释证据分、学情中位分门禁、CSV 导出。
```

### 数据来源与合规边界
```
本地匿名样例与演示账号（learner-demo / teacher-demo）；不接真实学籍。
审计：SQLite 哈希链 + HMAC。执行：默认可子进程 Demo；可启用 Docker --network=none。
模型可选；未配置 LLM_API_KEY 时本地策略反馈。学生 PII 设计上不出境。Demo 角色为假会话并带安全警告头。
```

### 开源与复用
```
Apache-2.0。可复用：题型 Runner 与量规模板、知识点 seed、ADR 与架构文档、演示脚本与 E2E。
模型与 STT 可替换；证据门禁与 D1/终裁红线不可替换。
```

### 后续迭代（诚实 · 勿写已完成）
```
教务 Excel/PDF 全套导出（CSV 已有）；真多租户与生产身份；成套 Attempt 批量提交 API；
多模态 Phase 2（手写 canvas）；LMS/SIS 对接。不以 Demo 冒充三千人并发生产。
```

---

## 3. 附件清单

| 材料 | 路径 | 说明 |
|------|------|------|
| 作品简介 | [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) | 对外简介正文 |
| 本填表指南 | [SUBMISSION_GUIDE.md](./SUBMISSION_GUIDE.md) | 字段复制源 |
| 方案 PPT（初赛底） | `docs/EvidenceLoop-初赛路演.pptx` | 决赛可沿用结构，口播用新产品口径 |
| PPT 提纲 | [PITCH_DECK_OUTLINE.md](./PITCH_DECK_OUTLINE.md) | 决赛页纲 |
| 现场口播 | [DEMO-oral-10min.md](./DEMO-oral-10min.md) | 10 分钟逐字 |
| 卡点 / 预检 | [DEMO-cue-card.md](./DEMO-cue-card.md) · [DEMO-preflight.md](./DEMO-preflight.md) | 上场 |
| 合规 | [COMPLIANCE.md](./COMPLIANCE.md) | 隐私与边界 |
| 架构 | [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术路线 |
| 赛道摘录 | [research/competition-requirements.md](./research/competition-requirements.md) | 评审关注点 |
| 作品 zip（若需） | `output/submission/EvidenceLoop-submission.zip` | **2026-07-27 已重打**（见下） |

### 当前 zip（2026-07-27）

| 项 | 值 |
|----|-----|
| 路径 | `D:\code_space\evidence-loop\output\submission\EvidenceLoop-submission.zip` |
| 大小 | ~6.1 MB（6402731 bytes） |
| 条目 | 367 |
| 校验 | `output/submission/verify-report.json` → `ok: true` |
| 含 | 源码 / tests / docs（含决赛填表、口播、PPT、截图）/ seed / README / LICENSE |
| 不含 | `node_modules` · `dist` · `.git` · `.data` · `output/` · `.env` · 密钥 |
| git | `output/` 被 ignore，zip **不进仓库**，上传用本地路径 |

重打命令思路：从工作区 robocopy 排除上述目录后 `ZipFile.CreateFromDirectory`；打完用 verify-report 核对 must-have 与 forbidden。

---

## 4. 与初赛文案对照（避免填错旧版）

| 项 | 初赛旧口径 | 现在应写 |
|----|------------|----------|
| 场景 | 偏 Python 编程 | 多学科实训 + 编程仍是强 demo |
| 闭环 | 提交→测试→诊断→再提交 | 双模 + 教师布置/终裁/提示 + 学情门禁 |
| 端口 | 4173 | **5280**（或 18473） |
| 模型角色 | 不改分 | 不改分 + 辅导隔离 + 终裁/提示非分 |
| 合规 | 子进程 Demo | + Docker 可选、审计链、PII、egress |

---

## 5. 填表自检

- [ ] 作品名仍是 **EvidenceLoop · 循证实训 Agent**（未擅自改名）
- [ ] 一句话含「证据打分 / 模型不改分」
- [ ] 未宣称生产多租户、未承诺 LLM 改分更智能
- [ ] Demo 链接或运行说明可复现
- [ ] 附件 PPT/简介与仓库 README 口径一致
