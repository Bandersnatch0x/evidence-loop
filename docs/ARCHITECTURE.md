# 架构说明

## 总览

EvidenceLoop 采用“单进程 Node 服务 + React 前端 + 共享契约”的本地 Demo 架构。

```
Browser (React)
  |  /api/*
Node HTTP Server
  |- EvaluationAgent
  |    |- Assignment registry
  |    |- CodeRunner
  |    |    |- PythonSubprocessRunner (default, Demo only)
  |    |    `- DockerPythonRunner (opt-in, pooled isolation)
  |    |- Rubric scorer
  |    |- Knowledge base
  |    |- Feedback generator (local / optional LLM)
  |- JsonEvaluationStore
  |- Vite middleware (dev) / dist static (prod)
```

## Agent 五步闭环

1. `assignment.retrieve` 读取任务与量规
2. `code.runner` 使用已配置的 Python 运行器执行提交
3. `rubric.score` 将证据映射为分数
4. `knowledge.retrieve` 匹配薄弱概念与干预策略
5. `feedback.compose` 生成受证据约束的反馈

## 评分边界

- 证据来自测试与静态检查
- 分数由量规确定性计算
- LLM 仅组织文案，不得改分
- 运行中断时返回 blocked/failed，不给假分

## 工具与依赖

| 组件 | 作用 | 备注 |
| --- | --- | --- |
| Python 子进程 | 默认运行提交 | Demo 级约束，无网络隔离 |
| Docker CLI + 容器池 | 可选运行提交 | `--network=none`、cgroups、只读根文件系统、非 root |
| 本地知识库 | 诊断与干预模板 | 静态配置 |
| JSON store | 评估历史 | 单进程串行写入 |
| OpenAI-compatible API | 可选反馈 | 失败回退本地策略 |

## 数据流

1. POST `/api/evaluations` 接收 `assignmentId` + `code`
2. Agent 产出 `EvaluationResult`
3. Store 保存结果
4. 前端刷新历史与班级视图；刷新失败时保留本轮评分

## 部署

- 开发：`npm run dev`，端口默认 `4173`
- 生产预览：`npm run build && npm run preview`
- 默认 `PYTHON_RUNNER=subprocess`；仅适合本地受控 Demo
- `PYTHON_RUNNER=docker`：启动时预热容器池，Docker 不可用时启动失败且不回退
- `GET /api/health` 返回实际 runner 名称，便于部署验收
- Docker runner 通过 CLI 调用 daemon，不在 Node 进程内引入 Docker SDK

## 已知限制

- 子进程不是生产沙箱，不能处理不可信公网提交
- Docker 隔离低于微虚拟机隔离，且安全性依赖宿主 Docker daemon、内核和镜像供应链
- 当前容器池在单个 Node 进程内管理，未实现跨实例调度、配额和租户隔离
- JSON store 不支持多实例并发写
- 仅覆盖一个 Python 样例任务
