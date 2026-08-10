# 路演 PPT 提纲（决赛口径）

建议 8–10 页，**现场口播以 10 分钟逐字稿为准**（[DEMO-oral-10min.md](./DEMO-oral-10min.md)）。  
初赛成品：`docs/EvidenceRing-初赛路演.pptx`（封面请改为 **循证环 · EvidenceRing**）。

## 1. 封面
- **循证环 · EvidenceRing**
- Boundless Agents · AI+教育
- 副标题：证据打分 · 模型不改分 · 双模可信学情

## 2. 问题
- 批改只给对错；AI 讲评幻觉且越权改分
- 练习与考试掌握度混计
- 教师缺可审计终裁；沟通易变成暗箱加减分

## 3. 方案（铁律一页）
- 分数只来自可复现 Evidence
- LLM 只辅导，与打分路径隔离
- 练习 ≠ 正式掌握（D1）
- 终裁不折叠客观分；提示不是分
- 学生 PII 不出境

## 4. 目标用户与价值
- 学员：可解释反馈 + 错题/复习闭环
- 教师：布置 · 提示 · 终裁 · 学情门禁
- 课程团队：可复用 Runner / KP / ADR 模板

## 5. 任务闭环（图）
布置/今日该练 → 作答(双模) → Runner 证据 → 量规分 → 辅导(可选) → 重练/复习 → 终裁/提示 → 学情

## 6. 现场 Demo 镜头
- 练习态求助：分数不变
- 缺陷代码 80 → 修复 100（编程强镜头，可保留）
- 教师发提示 → 学生收件箱
- 终裁 annotation 并列；学情待裁排除

## 7. 技术架构
- Evaluation / Attempt 聚合；RunnerRegistry 7 题型
- 掌握度 + FSRS 与评分隔离
- Docker 可选隔离；审计 HMAC 链
- 多模态 flag 可关
- **多智能体叙事**：评分 / 诊断 / 辅导 / 组卷 / 教师建议 — 只有评分碰分且不用 LLM（见 agentCatalog + 透明度页）

## 8. 安全与合规
- 匿名样例；Demo 假多租户 + 警告头（诚实）
- 模型不改分；egress 边界
- 架构测试守护红线

## 9. 开放复用
- Apache-2.0
- 文档 / seed / E2E / 演示脚本齐全
- 模型可换，证据门禁不可换

## 10. 边界与下一步
- 已做：产品化主路径 + 现场脚本 + E2E
- 后置：教务 Excel/PDF、真多租户、批量交卷 API、家长端
- 不以 Demo 冒充大规模生产

## 项目名
**循证环 · EvidenceRing**（曾用 EvidenceLoop，已全量更名）。见 [SUBMISSION_GUIDE.md](./SUBMISSION_GUIDE.md) §0。
