# 迭代路线

## 已完成（初赛可用）

- AI+教育方向立项与 Agent 闭环 Demo
- 学习工作台 / 班级学情 / 项目透明度
- 证据优先评分与本地规则反馈
- 自动化测试、生产构建与浏览器演示路径
- 参赛材料：简介、PRD、架构、合规、路演提纲

## 复赛（8/25-9/23）

1. 无网络 Docker 容器运行器：代码、池化、异常回收和自动化测试已于 2026-07-23 完成；真实 Docker daemon 集成验收待具备运行环境后执行
2. 评估历史迁移到数据库，支持多实例
3. 增加 2-3 个知识点任务模板（关联 011 知识点 seed 文件：`server/knowledge/` seed 数据）
4. 录制 2-3 分钟 Demo 视频
5. 补齐部署脚本与一键复现文档

### Phase 1 多模态交付（ADR-0005）

- [x] 协议冻结 + feature flag 红线（`MULTIMODAL_ENABLED`）
- [x] VoiceCompanion + OverlayLayer 骨架与 directive 分发
- [x] 阿里云 STT 抽象 + KaTeX 数学 SPEAK/DISPLAY 双通道
- [x] 多模态合规：审计 `modality`、语音元数据审计、IndexedDB 24h TTL、教师语音使用次数面板（021）
- [x] 演示脚本：代码 / 数学 / 作文 + 弱网降级演练（022）
  - [docs/DEMO-multimodal-code.md](./DEMO-multimodal-code.md)
  - [docs/DEMO-multimodal-math.md](./DEMO-multimodal-math.md)
  - [docs/DEMO-multimodal-essay.md](./DEMO-multimodal-essay.md)
  - [docs/DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md)
- [x] 架构守护 + Feature Flag 冒烟（023）：`tests/architecture.test.ts` + `tests/multimodal-flag-smoke.test.ts`
- [ ] 录屏 3 个 30 秒短视频（可选，评审加分）
- [ ] Phase 2：canvas 手写 + 视觉 LLM（前置 ADR-0007 笔迹隐私分类）

## 决赛（9/22-9/23）

1. 现场演示脚本固化（缺陷 80 → 修复 100）
2. 准备专家问答：评分边界、安全、开源复用
3. 展示开放模板：任务配置、量规、知识诊断
4. 多模态现场路径：按 DEMO-multimodal-*.md 演练；弱网切 Web Speech

## 后续产品化

- LMS/作业平台对接
- 教师人工确认后的成绩回写
- 多语言运行器
- 机构级隐私与审计能力

