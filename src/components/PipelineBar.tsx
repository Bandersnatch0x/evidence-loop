import { useEffect, useState } from 'react'
import {
  BookOpenCheck,
  BrainCircuit,
  MessageSquareText,
  Scale,
  TerminalSquare
} from 'lucide-react'
import type { TraceStep } from '../../shared/contracts'

interface PipelineBarProps {
  isEvaluating: boolean
  trace?: TraceStep[]
}

type StepVisualState = 'pending' | 'active' | 'done' | 'failed' | 'skipped'

const steps = [
  {
    id: 'retrieve-assignment',
    label: '读取任务',
    tool: 'assignment.retrieve',
    icon: BookOpenCheck
  },
  {
    id: 'run-submission',
    label: '受限运行',
    tool: 'python.safe-runner',
    icon: TerminalSquare
  },
  { id: 'score-rubric', label: '量规评分', tool: 'rubric.score', icon: Scale },
  {
    id: 'retrieve-knowledge',
    label: '知识匹配',
    tool: 'knowledge.retrieve',
    icon: BrainCircuit
  },
  {
    id: 'compose-feedback',
    label: '反馈生成',
    tool: 'feedback.compose',
    icon: MessageSquareText
  }
] as const

const stepStateLabels: Record<StepVisualState, string> = {
  pending: '待执行',
  active: '执行中',
  done: '完成',
  failed: '失败',
  skipped: '跳过'
}

function resolveStates(
  isEvaluating: boolean,
  activeIndex: number,
  trace?: TraceStep[]
): StepVisualState[] {
  if (trace && trace.length > 0) {
    const byId = new Map(trace.map((step) => [step.id, step]))
    return steps.map((step) => {
      const record = byId.get(step.id)
      if (!record) return 'pending'
      if (record.status === 'completed') return 'done'
      if (record.status === 'failed') return 'failed'
      return 'skipped'
    })
  }
  if (isEvaluating) {
    return steps.map((_, index) => {
      if (index < activeIndex) return 'done'
      if (index === activeIndex) return 'active'
      return 'pending'
    })
  }
  return steps.map(() => 'pending')
}

function stepMeta(
  stepId: string,
  state: StepVisualState,
  trace?: TraceStep[]
): string {
  if (trace && trace.length > 0) {
    const record = trace.find((step) => step.id === stepId)
    if (record?.status === 'completed') return `完成 · ${record.durationMs} ms`
  }
  if (state === 'active') return '执行中…'
  if (state === 'done') return '完成'
  return stepStateLabels[state] === '待执行'
    ? (steps.find((step) => step.id === stepId)?.tool ?? '')
    : stepStateLabels[state]
}

export function PipelineBar({ isEvaluating, trace }: PipelineBarProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!isEvaluating) return
    const prefersReducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setActiveIndex(steps.length - 1)
      return
    }
    setActiveIndex(0)
    const timer = window.setInterval(() => {
      setActiveIndex((current) => Math.min(current + 1, steps.length - 1))
    }, 620)
    return () => window.clearInterval(timer)
  }, [isEvaluating])

  const states = resolveStates(isEvaluating, activeIndex, trace)
  const isIdle = !isEvaluating && (!trace || trace.length === 0)

  return (
    <header className="loop-bar">
      <div className="loop-bar-heading">
        <span className="loop-bar-title">
          <span className="loop-live-dot" aria-hidden="true" />
          循证闭环
        </span>
        <p>{isIdle ? '提交代码后，五步流程将依次执行' : '分数由测试与量规确定，模型只组织反馈'}</p>
      </div>
      <ol className="loop-steps" aria-label="评估流程">
        {steps.map((step, index) => {
          const state = states[index] ?? 'pending'
          const Icon = step.icon
          return (
            <li
              key={step.id}
              className={`loop-step is-${state}`}
              aria-label={`${step.label}：${stepStateLabels[state]}`}
            >
              <span className="loop-node" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="loop-text">
                <strong>{step.label}</strong>
                <small>{stepMeta(step.id, state, trace)}</small>
              </span>
            </li>
          )
        })}
      </ol>
    </header>
  )
}
