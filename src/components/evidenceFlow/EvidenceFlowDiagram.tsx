import type { EvaluationResult } from '../../../shared/contracts'

export interface EvidenceFlowDiagramProps {
  evaluation: EvaluationResult
}

function scoreTier(score: number): 'score-high' | 'score-mid' | 'score-low' {
  if (score >= 80) return 'score-high'
  if (score >= 60) return 'score-mid'
  return 'score-low'
}

/**
 * P2-2 证据链流转可视化：证据 -> 量规维度 -> 总分 的节点流动图。
 *
 * 挂在项目透明度页，让评委"第一次看见证据本体"——每条证据如何归约到
 * 量规维度、各维度如何加和为总分。密度优先、数据驱动（非装饰）：
 * 每个节点展示真实 label / 权重 / 得分，连线表达归约方向。
 *
 * 红线：只读消费已确定的 EvaluationResult，绝不回写分数/证据（呈现层）。
 */
export function EvidenceFlowDiagram({ evaluation }: EvidenceFlowDiagramProps) {
  const { evidence, dimensions, score, status } = evaluation
  const ariaLabel = `证据流转图：${evidence.length} 条证据汇聚为 ${score} 分`

  return (
    <div className="evidence-flow" role="figure" aria-label={ariaLabel}>
      <div className="evidence-flow-stage">
        <h4 className="evidence-flow-stage-title">评分证据</h4>
        {evidence.length > 0 ? (
          <ul className="evidence-flow-nodes">
            {evidence.map((item) => (
              <li key={item.id} className={`flow-node is-${item.state}`}>
                <span className="flow-node-label">{item.label}</span>
                <span className="flow-node-weight">
                  {item.state === 'passed' ? `+${item.weight}` : '0'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">暂无证据</p>
        )}
      </div>

      <FlowArrow label="归约" />

      <div className="evidence-flow-stage">
        <h4 className="evidence-flow-stage-title">量规维度</h4>
        {dimensions.length > 0 ? (
          <ul className="evidence-flow-nodes">
            {dimensions.map((dim) => (
              <li key={dim.id} className={`flow-node is-${dim.state}`}>
                <span className="flow-node-label">{dim.label}</span>
                <span className="flow-node-weight">
                  {dim.earnedScore}/{dim.maxScore}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">暂无量规</p>
        )}
      </div>

      <FlowArrow label="加和" />

      <div className="evidence-flow-stage">
        <h4 className="evidence-flow-stage-title">总分</h4>
        <div className={`flow-node score-node ${scoreTier(score)}`}>
          <strong className="flow-node-score">{score}</strong>
          <span className="flow-node-weight">/ 100</span>
        </div>
        {status !== 'completed' ? (
          <p className="muted">
            {status === 'rejected' ? '本次提交未执行' : '执行失败'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="evidence-flow-arrow" aria-hidden="true">
      <span className="evidence-flow-arrow-line" />
      <span className="evidence-flow-arrow-label">{label}</span>
    </div>
  )
}
