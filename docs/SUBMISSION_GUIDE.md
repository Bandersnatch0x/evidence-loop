# 报名 / 提交填表指南（初赛口径 · 2026-07-27 改名后）

表单字段建议值，**直接复制**。正文按**产品化十票 + T11–T14** + **循证环 · EvidenceRing** 品牌。

---

## 0. 品牌（已改名）

| 项 | 值 |
|----|-----|
| **作品正式名** | `循证环 · EvidenceRing` |
| **英文短名** | EvidenceRing |
| **中文短名** | 循证环 |
| **品类描述** | 循证实训 Agent（副标题，非作品名） |
| **package** | `evidence-ring` |
| **目标仓库名** | `evidence-ring`（GitHub 上请将原 `evidence-loop` 重命名） |
| **本地目录** | 当前磁盘路径仍可为 `D:/code_space/evidence-loop`（文件夹未强制改名） |

### 命名理由

1. **循证** = 分数只来自可复现证据（核心差异化，对评委一听就懂）。  
2. **环** = 布置 → 作答 → 证据分 → 辅导/重练 → 终裁/学情 的闭环。  
3. **EvidenceRing** = 英文可检索品牌，区别于旧名 EvidenceLoop，初赛阶段可全量换新。  
4. 避免「AI 家教 / 智能批改 / EduGPT」等泛名。

### 曾用名

- EvidenceLoop · 循证实训 Agent（初赛早期）→ **已废弃**，材料与代码已全量替换。

---

## 1. 固定字段

### 作品名称
```
循证环 · EvidenceRing
```

### 赛道
```
Boundless Agents 无界应用 · AI+教育
```
（大赛全称可写：杭州全球人工智能技术创新大赛 / 世界人工智能开源大赛）

### 代码仓库
```
https://github.com/Bandersnatch0x/evidence-ring
```
若 GitHub 尚未完成重命名，临时仍可能是：
```
https://github.com/Bandersnatch0x/evidence-loop
```
填表时以**实际可打开的 URL**为准；重命名后 GitHub 会自动跳转。

### Demo 链接
当前**未做公网部署**（执行不可信代码 + 本地数据，适合机房/本机演示）。

**建议填写：**
1. 非必填则留空，备注「现场本地 Demo」
2. 或填 README 启动锚点（以实际仓库 URL 为准）

### 本地演示
```powershell
cd D:/code_space/evidence-loop   # 或 clone 后的 evidence-ring 目录
npm install
$env:PORT='5280'; npm run dev
```
浏览器：`http://127.0.0.1:5280`

可选 E2E：
```powershell
node scripts/e2e-demo-loops.mjs http://127.0.0.1:5280
```

### 许可证
```
Apache-2.0
```

---

## 2. 文案字段

### 一句话简介（短）
```
循证环用可复现证据驱动多学科实训：只证据打分，LLM 只辅导不改分，练习与测评分流，教师终裁可审计。
```

### 一句话简介（长）
```
循证环（EvidenceRing）是循证实训 Agent：学生作答后由题型 Runner 产出可复现证据并归约分数；大模型仅辅导讲解永不改分；支持练习/测评双模、教师布置与终裁、站内提示与班级学情，覆盖代码到多学科客观/主观题。
```

### 目标用户
```
中小学/高校实训学员；任课教师与助教；需要可复用 Agent 模板的课程/产品团队
```

### 场景痛点
```
自动批改只给对错；AI 讲评易幻觉且越权改分；练习与考试掌握度混计；教师缺少可审计终裁与学情门禁；聊天式家教不可复现、难合规。
```

### 核心任务闭环
```
布置/今日该练 → 学生作答（练习态或测评态）→ Runner 产出证据 → 量规归约分数 →（可选）练习态 AI 辅导不改分 → 错题重练 / 复习调度 → 教师终裁与站内提示 → 班级学情（尊重终裁门与双模）
```

### 差异化要点
```
1. 分数只来自可复现 Evidence；LLM 路径与打分物理隔离
2. D1 双模：练习喂 FSRS 不进正式掌握；测评才进 MasteryProfile
3. 教师终裁写入 teacherAnnotation，不折叠进客观 score；无批量灌分
4. 站内提示是消息不是分；成套交卷为服务端确认，仍无第二套计分
5. 7 题型 Runner + 9 学科知识点 DAG；多模态语音只读不改分（可关闭）
6. 容器隔离、HMAC 审计链、PII 扫描、学生 PII 不出境；Demo 假多租户诚实披露
7. 家长端只读视图 + 子女绑定落库（parent_children）；Excel 兼容 CSV 导出
```

### 技术栈
```
React 19 + Vite + TypeScript + Node HTTP；Zod；better-sqlite3 + Drizzle；
7 题型 Runner（含 Python 子进程/Docker 池）；FSRS；可选 LLM API / 阿里云 STT；Playwright E2E
```

### 数据与合规
```
本地匿名样例与演示账号；不接真实学籍。审计：SQLite 哈希链 + HMAC。
执行可 Docker 无网。模型可选。学生 PII 设计上不出境。Demo 角色为假会话。
```

### 开源与复用
```
Apache-2.0。可复用 Runner/量规模板、知识点 seed、ADR、演示脚本与 E2E。
模型与 STT 可替换；证据门禁与 D1/终裁红线不可替换。
```

### 后续迭代（诚实）
```
已做：Excel 兼容 CSV 导出（UTF-8 BOM）、成套服务端交卷确认、家长端只读视图 + 子女绑定落库（parent_children 表）；
待做：短信/推送、真实多租户与生产身份、真实家长身份、多模态 Phase 2、LMS/SIS 对接。
不以 Demo 冒充大规模生产。
```

---

## 3. 附件清单

| 材料 | 路径 |
|------|------|
| 作品简介 | [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) |
| 本填表指南 | [SUBMISSION_GUIDE.md](./SUBMISSION_GUIDE.md) |
| 方案 PPT | `docs/EvidenceRing-初赛路演.pptx` |
| 口播 / 卡点 / 预检 | DEMO-oral-10min · DEMO-cue-card · DEMO-preflight |
| 合规 / 架构 | COMPLIANCE.md · ARCHITECTURE.md |
| 作品 zip | `output/submission/EvidenceRing-submission.zip`（gitignore；改名后请重打） |

---

## 4. 填表自检

- [ ] 作品名是 **循证环 · EvidenceRing**（不是 EvidenceLoop）
- [ ] 一句话含「证据打分 / 模型不改分」
- [ ] 仓库 URL 可打开（loop 或 ring 以 GitHub 实际为准）
- [ ] 未宣称生产多租户
- [ ] zip / PPT 文件名与品牌一致
