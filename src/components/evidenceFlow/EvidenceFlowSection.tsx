import { useEffect, useState } from 'react'
import type { EvaluationResult } from '../../../shared/contracts'
import { getEvaluation, listEvaluations } from '../../lib/api'
import { EvidenceFlowDiagram } from './EvidenceFlowDiagram'
import { demoEvaluationFlow } from './demoFlowFixture'

/**
 * P2-2: fetch the student's latest real evaluation for the flow diagram;
 * fall back to the representative fixture when there is no evaluation yet
 * (cold start / teacher view) so the concept is always illustrated.
 *
 * 只读消费已确定的评估，不回写分数/证据（呈现层红线）。
 */
export function EvidenceFlowSection() {
  const [evaluation, setEvaluation] = useState<EvaluationResult | undefined>()

  useEffect(() => {
    let cancelled = false
    listEvaluations()
      .then(async (items) => {
        const latest = items[0]
        if (cancelled || latest === undefined) return
        try {
          const full = await getEvaluation(latest.id)
          if (!cancelled) setEvaluation(full)
        } catch {
          // 评估详情取失败时保留 fixture 回退，不阻塞透明度页
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return <EvidenceFlowDiagram evaluation={evaluation ?? demoEvaluationFlow} />
}
