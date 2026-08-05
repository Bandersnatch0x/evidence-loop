# 预算环境配置与调参方案

> 决策票 #27 · 关联：spec §9.2、T-M §9、`server/demonstration/sceneSecurity.ts`、`server/media/mediaGate.ts`、`server/media/QuotaService.ts`
> 日期：2026 系列（随 T-M 落地）

## 0. 结论速览

三组预算已全部 env 化（代码常量 → 环境配置，配置值 ≠ 代码常量），均有测试覆盖：

| 组 | 解析器 | 测试 |
|---|---|---|
| 场景资源预算 `DEMO_BUDGET_*` | `sceneSecurity.resolveResourceBudget` | `tests/v1Acceptance.test.ts` |
| 单文件媒体上限 `MEDIA_LIMIT_*` | `mediaGate.resolveKindLimits` | `tests/mediaGate.test.ts` |
| 教师配额 `MEDIA_QUOTA_TEACHER_BYTES` | `QuotaService.resolveQuotaBytes` | `tests/mediaGate.test.ts` |

`.env.example` 已补齐三组变量的注释默认值与字节换算说明。本文件给出**建议档位**与**按运行数据调整**的反馈回路。

## 1. 当前默认值（= spec §9.2 保守 v1 值）

### 1.1 场景资源预算（`DEMO_BUDGET_*`，`sceneSecurity.HARD_BUDGET`）

| 变量 | 默认 | 含义 |
|---|---|---|
| `DEMO_BUDGET_MAX_NODES` | 2000 | objectTree 递归节点总数上限 |
| `DEMO_BUDGET_MAX_TRIANGLES` | 500_000 | 内联 3D 图元估算三角面上限 |
| `DEMO_BUDGET_MAX_TEXTURE_PIXELS` | 8,388,608 (8 MP) | GLB/纹理总解码像素上限 |
| `DEMO_BUDGET_MAX_ANIMATION_SECONDS` | 600 | timeline 时长上限（秒） |
| `DEMO_BUDGET_MAX_MEDIA_REFS` | 200 | mediaRefs 引用数上限 |

### 1.2 单文件媒体上限（`MEDIA_LIMIT_*`，`mediaGate.KIND_LIMITS`）

| 变量 | 默认 | spec §9.2 |
|---|---|---|
| `MEDIA_LIMIT_IMAGE_BYTES` | 25 MiB (26,214,400) | 25 MiB / 40 MP / 长边 16,384 px |
| `MEDIA_LIMIT_GLB_BYTES` | 200 MiB (209,715,200) | 200 MiB |
| `MEDIA_LIMIT_VIDEO_BYTES` | 2 GiB (2,147,483,648) | 2 GiB / 120 min |
| `MEDIA_LIMIT_VTT_BYTES` | 2 MiB (2,097,152) | 2 MiB / 50,000 cues |
| `MEDIA_LIMIT_AUDIO_BYTES` | 250 MiB (262,144,000) | 250 MiB / 120 min |

### 1.3 教师配额（`MEDIA_QUOTA_TEACHER_BYTES`，`QuotaService.PER_TEACHER_QUOTA_BYTES`）

| 变量 | 默认 | spec §9.2 |
|---|---|---|
| `MEDIA_QUOTA_TEACHER_BYTES` | 5 GiB (5,368,709,120) | 每教师 5 GiB 逻辑原始内容 |

> 配额为**逻辑预留**：`upload_sessions` 活跃会话预留字节求和即当前用量（无独立配额表）。2 并发上传、1 并发视频作业、临时盘 ≤3 GiB 为账号级并发/临时盘约束，属部署层（非本组 env）。

## 2. 建议档位（v1 保守 → 生产已调）

> spec §9.2 原话「配置化阈值先落地后按运行数据调整」。下表为**待生产运行数据确认后**的档位建议，非当前生效值。

### 2.1 场景资源预算

| 变量 | v1 默认 | 生产建议 | 依据 |
|---|---|---|---|
| `DEMO_BUDGET_MAX_NODES` | 2000 | 4000 | 教师创作 3D 场景含分组/多图元倾向偏大；播放端为只读投影，无执行风险 |
| `DEMO_BUDGET_MAX_TRIANGLES` | 500,000 | 500,000（保持） | 内联图元三角面由 CPU 估算，过高损坏移动端帧率；GLB 以解码纹理像素/文件上限双控 |
| `DEMO_BUDGET_MAX_TEXTURE_PIXELS` | 8 MP | 16 MP | 中档移动设备 1080p 场景仍需高分辨率纹理；但需配移动档能力协商降级兜底 |
| `DEMO_BUDGET_MAX_ANIMATION_SECONDS` | 600 | 600（保持） | 教学演示时长由教师教学节奏决定而非资源；过长仅影响加载包体 |
| `DEMO_BUDGET_MAX_MEDIA_REFS` | 200 | 200（保持） | refs 多关联网络往返，懒加载下非首屏成本 |

### 2.2 媒体上限

| 变量 | v1 默认 | 生产建议 | 依据 |
|---|---|---|---|
| `MEDIA_LIMIT_IMAGE_BYTES` | 25 MiB | 25 MiB（保持） | 40 MP 上限已被解码像素约束；原始文件 25 MiB 足够 |
| `MEDIA_LIMIT_GLB_BYTES` | 200 MiB | 300 MiB | 复杂机械/分子模型 GLB 单文件体积大；以纹理像素与三角面双控防滥用 |
| `MEDIA_LIMIT_VIDEO_BYTES` | 2 GiB | 2 GiB（保持） | 120 min 时长约束为主；压码率由 ffprobe 解析后降级 |
| `MEDIA_LIMIT_VTT_BYTES` | 2 MiB | 2 MiB（保持） | 50,000 cues 已宽松 |
| `MEDIA_LIMIT_AUDIO_BYTES` | 250 MiB | 250 MiB（保持） | 120 min 时长约束为主 |

### 2.3 教师配额

| 变量 | v1 默认 | 生产建议 | 依据 |
|---|---|---|---|
| `MEDIA_QUOTA_TEACHER_BYTES` | 5 GiB | 10 GiB | 教师上传视频原始 + 派生物；5 GiB 对视频多的班级偏紧；上调前先看运行期 `upload_sessions` 用量分布 |

## 3. 按运行数据调整的反馈回路

1. **观测**：`upload_sessions` 表按 `owner_id` 聚合活跃预留（`QuotaService.usageBytes` 同 SQL）；`funding/audit` 事件记录媒体上传/拒绝。
2. **判定**：超限拒绝率（`Media quota exceeded` 计数）与单文件超限拒绝（`validateMedia` 返回）是两个信号。
   - 超限拒绝率持续 > 阈值 → 上调对应上限/配额。
   - 无超限拒绝但磁盘/带宽成本高 → 下调（或保持默认）。
3. **变更**：改 `.env` 对应变量 → 重启 → 新阈值即时生效（解析器每次调用读 `process.env`，无缓存）。
4. **回归**：`tests/mediaGate.test.ts`、`tests/v1Acceptance.test.ts` 的 env 覆盖断言保护「配置 ≠ 常量」不变量不受调参影响。

## 4. 边界与不变量

- 所有解析器在 `env` 缺省/空/非法时回退默认值（`intEnv`/`bytesEnv` 的 `Number.isFinite && > 0` 守卫），非法配置不会静默放开预算。
- 场景预算为**静态守卫第二道强制**（发布前审核证据面板 + 播放端加载时二次校验，spec §6.5）；`DEMO_BUDGET_*` 只影响拒绝/降级判定，不进入评分证据链。
- 媒体上限在**上传三方比对**（declared/actual/sniffed，`verifyTriangle`）阶段强制，超限 fail-closed 进入 `rejected`。
- 配额在 `upload_sessions` 创建事务内预留，超限抛错回滚 INSERT（`reserveWithin`）。