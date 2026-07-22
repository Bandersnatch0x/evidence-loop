# Handoff: EvidenceLoop 全项目落地

## Mission
GOAI Boundless Agents · AI+教育 — **EvidenceLoop（循证实训 Agent）** 全项目落地。

**Authoritative root:** `D:/code_space/evidence-loop`  
旧路径 `D:/code_space/test/日常/evidence-loop` 已迁出且不存在。

## Status (2026-07-22)
**Goal: complete for MVP/demo delivery.**

- [x] 前后端闭环可运行
- [x] 参赛文档 / 合规 / 架构
- [x] `:memory:` store + BOM 容错
- [x] 迁移后 live 复验 80→100
- [x] `npm run check` 11/11
- [x] 最终质量审查：`docs/QUALITY_REVIEW.md`
- [x] 初赛 PPT：`docs/EvidenceLoop-初赛路演.pptx`（10 页 16:9）

## Product invariants
- 分数只来自测试/静态证据 + 确定性量规；模型不改分
- 教师视图只给干预建议，不自动写正式成绩
- Python 子进程 = Demo only
- JSON store 单进程串行；`:memory:` 用于测试
- 匿名样例数据

## Closed loop
提交 → 受限运行 → 量规评分 → 知识诊断 → 修复任务 → 再验证 → 学情更新

## Live re-smoke (post-move)
- health: ok
- attempt1 boundary-bug: score **80**, diagnosis empty-sequence
- attempt2 fixed: score **100**, scoreDelta **+20**
- demo data reset: `.data/evaluations.json` = `[]`

## Commands
```powershell
cd D:/code_space/evidence-loop
npm run dev
npm run check
```

## Do not re-do
- 赛道选择、核心 Agent 环、从零写文档

## Optional next
1. 从 `docs/PITCH_DECK_OUTLINE.md` 出初赛 PPT/PDF
2. 用户要求时再 git init / commit（仅本目录）
