# EvidenceRing 最终质量审查

审查日期：2026-07-22  
项目根：`D:/code_space/evidence-loop`  
赛道：GOAI Boundless Agents · AI+教育

## 结论

**可提交演示态：通过。**  
初赛材料齐备，核心闭环已在新路径复验；生产化沙箱与多租户持久化不在本阶段范围，已在文档中显式标注。

## 验证证据

| 检查项 | 结果 |
|--------|------|
| `npm run check` | lint + **11/11 tests** + tsc + vite build 通过 |
| Live health | `GET /api/health` → ok / python-subprocess / local-policy |
| Live 闭环 | boundary-bug **80** (attempt1, empty-sequence) → fixed **100** (attempt2, +20) |
| 内存 store | `:memory:` 读写测试通过，不落盘 |
| 源码扫描 | 无 empty-catch / as-any / TODO / 硬编码密钥 / shell:true / eval |
| 参赛文档 | README、PRD、架构、合规、路演大纲、ADR、合规说明齐全 |

## 产品不变量（已核对）

1. **分数不变量**：`EvaluationAgent` 分数 = 通过证据权重求和；LLM/反馈只产出 `summary`，失败回退 local-policy。
2. **教师边界**：班级视图只给干预建议，不自动写正式成绩。
3. **运行器边界**：Python 子进程为 Demo only，非生产沙箱。
4. **存储边界**：JSON 单进程串行写；测试可用 `:memory:`。
5. **数据边界**：匿名样例，无真实学籍/LMS。

## 本轮修复

1. **`JsonEvaluationStore` 支持 `:memory:`**  
   测试服务器不再尝试写字面量 `:memory:` 文件。
2. **补 API 闭环测试**  
   内存模式下验证 80→100、attempt/scoreDelta、list 历史。
3. **BOM 容错**  
   PowerShell `UTF8` 写入会带 BOM，导致 live API 500；读取时 strip `\uFEFF`，并重置 `.data/evaluations.json` 为干净 `[]`。

## 风险与残余

| 级别 | 项 | 说明 |
|------|----|------|
| 已知约束 | Python 子进程 | 演示环境可用；复赛若强调安全需容器/隔离 |
| 已知约束 | JSON 文件库 | 单进程；多实例会冲突 |
| 低 | 移动端 drawer | 偶发 pointer intercept 警告，导航可用 |
| 可选 | 初赛 PPT/PDF | 大纲在 `docs/PITCH_DECK_OUTLINE.md`，成品 PDF 未生成 |

## 3 分钟演示路径（复验可用）

1. 打开 http://localhost:4173 ，默认 boundary-bug  
2. 运行循证评估 → 约 80，空序列诊断  
3. 应用修复示例 → 100 / +20  
4. 班级学情  
5. 项目透明度（评分边界 + 安全说明）

## 命令

```powershell
cd D:\code_space\evidence-loop
npm run dev      # http://localhost:4173
npm run check
```

## 审查人建议

- 初赛：直接用现有 brief + 路演大纲做 PPT。  
- 复赛：优先加强 runner 隔离与真实课程数据适配，不改评分不变量。
