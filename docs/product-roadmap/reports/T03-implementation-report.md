# T03 题库系统 — 实现报告

## 状态结论

| 维度 | 状态 | 说明 |
|------|------|------|
| 后端 CRUD + 校验 | ✅ | `QuestionBankService` / `QuestionStore` / `questionValidation` |
| 7 题型 payload | ✅ | 与 RunnerSpec 形状对齐 |
| 老师私有归属 | ✅ | `authorId` 作用域；跨老师拒绝 |
| 组卷原语 | ✅ | 单题 / 按 KP 组卷 |
| seed 硬编码→预置库 | ✅ | `seedDemoProduct` 主进程冷启动挂载（T07 补挂） |
| 教师录入 UI（7 表单） | ✅ | `QuestionEditor` + `QuestionBankPanel` 挂教师工作台「题库录入」 |
| 实现报告 | ✅ | 本文件 |

**一句话**：T03 **后端 + 教师手录 UI + seed 主路径** 已闭合。题目版本管理 / 跨老师共享仍出界。

## 完成内容

### 后端
- `server/questionbank/*`：CRUD、7 题型校验、组卷、seed
- 路由：`POST/GET/PATCH/DELETE /api/questions`，`POST /api/papers/assemble`
- solution 写入时 **服务端盖 session authorId**（不信客户端）

### 前端（本轮补尾巴）
- `QuestionEditor`：学科 / 题型 / 题干 / KP / 难度 + 7 题型答案规格
- `QuestionBankPanel`：列表 / 新建 / 编辑 / 删除
- `TeacherWorkbench` 新标签「题库录入」（**不依赖**教学单元）

### 测试
- `tests/questionBank.test.ts`
- `tests/QuestionBankPanel.test.tsx`
- `tests/routeWiring.test.ts`（含 create + adopt）

## 仍出界 / 建设期
- 题目版本管理（改题后历史 Attempt）
- 跨老师共享
- 作文 `rubricGuide` 独立字段（见 T09）
