# 初赛提交填表指南

表单字段建议值（直接复制）。

## 代码仓库
```
https://github.com/Bandersnatch0x/evidence-loop
```

## Demo 链接
当前**未做公网部署**（Python 子进程 runner 仅适合本地 Demo）。

**建议填写其一：**
1. 留空（若非必填）
2. 仓库 README 本地启动说明：
```
https://github.com/Bandersnatch0x/evidence-loop#快速启动
```

本地演示：
```powershell
cd evidence-loop
npm install
npm run dev
```
打开 http://localhost:4173

## 作品附件（zip）*
文件路径：
```
D:\code_space\evidence-loop\output\submission\EvidenceLoop-submission.zip
```

压缩包内含：源码、测试、docs（含初赛 PPT）、截图、README、LICENSE。  
**不含** node_modules / dist / .git / .data / 日志。

## 常用文案（若表单还有其他字段）

### 作品名称
EvidenceLoop · 循证实训 Agent

### 赛道
Boundless Agents 无界应用 · AI+教育

### 一句话简介
用可验证证据驱动编程实训闭环：提交代码 → 受限运行 → 量规评分 → 知识诊断 → 修复再验证。

### 目标用户
编程初学者、实训教师/助教、课程产品团队

### 核心闭环
提交代码 → 受限运行测试与静态检查 → 按量规生成证据与分数 → 映射薄弱知识点 → 生成下一轮修复任务 → 重新提交验证 → 更新学情

### 差异化要点
- 分数只来自测试/静态证据，模型不改分
- 教师视图只给干预建议，不自动写正式成绩
- 可一键演示：缺陷 80 分 → 修复 100 分（+20）

### 技术栈
React 19 + Vite + Node HTTP + TypeScript + Python 子进程/Docker 容器池 runner + Zod

### 许可证
Apache-2.0

### 合规边界
匿名样例数据；本地子进程仅 Demo；Docker 隔离模式可显式启用，公开生产仍需认证、审计、镜像治理与数据库迁移。

## 建议同时上传的材料位置
| 材料 | 路径 |
|------|------|
| 作品简介 | docs/PROJECT_BRIEF.md |
| 方案 PPT | docs/EvidenceLoop-初赛路演.pptx |
| 合规说明 | docs/COMPLIANCE.md |
| 架构 | docs/ARCHITECTURE.md |
