/**
 * AgentRosterView — 项目透明度 · Agent 编队（T17）。
 *
 * 消费 shared/agentCatalog.ts 单一事实源，渲染五张 Agent 卡片
 * （输入 / 输出 / 禁止事项）+「评分路径零 LLM」铁律徽章。
 *
 * 纯展示：不发请求、不改分、不持有状态。只读 API
 * `GET /api/transparency/agents` 返回同一份目录，供外部评审引用。
 */
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  ListChecks,
  MessagesSquare,
  Scale,
  ShieldCheck,
  Stethoscope,
  UserRoundCheck
} from 'lucide-react'
import { AGENT_CATALOG, type AgentId } from '../../../shared/agentCatalog'
import './agentRoster.css'

const agentIcons: Record<AgentId, typeof Scale> = {
  scoring: Scale,
  diagnosis: Stethoscope,
  tutoring: MessagesSquare,
  assignment: ListChecks,
  advisory: UserRoundCheck
}

function IronRuleBadge() {
  return (
    <p className="agent-roster-iron-rule" role="note">
      <ShieldCheck size={14} />
      评分路径零 LLM
      <small>只有评分 Agent 碰分数，且它是确定性的</small>
    </p>
  )
}

/**
 * 可嵌入的区块：五张 Agent 卡片 + 铁律徽章。透明度页与独立路由共用。
 */
export function AgentRosterSection() {
  return (
    <section className="transparency-section">
      <div className="section-heading">
        <div>
          <span>04</span>
          <h2>五个 Agent，只有一个碰分数</h2>
        </div>
        <IronRuleBadge />
      </div>
      <div className="agent-roster-grid">
        {AGENT_CATALOG.map((agent) => {
          const Icon = agentIcons[agent.id]
          return (
            <article className="agent-card" key={agent.id}>
              <div className="agent-card-icon" aria-hidden="true">
                <Icon size={20} />
              </div>
              <h3>{agent.name}</h3>
              <code>{agent.internalModule}</code>
              <div className="agent-card-flags">
                <span className={agent.touchesScore ? 'agent-flag is-brand' : 'agent-flag'}>
                  {agent.touchesScore ? '碰分数 · 确定性' : '不碰分数'}
                </span>
                <span className="agent-flag">
                  {agent.llmAllowed ? '可用 LLM · llm_inference' : '零 LLM'}
                </span>
              </div>

              <div className="agent-card-facet">
                <span>
                  <ArrowDownToLine size={13} />
                  输入
                </span>
                <ul>
                  {agent.inputs.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="agent-card-facet">
                <span>
                  <ArrowUpFromLine size={13} />
                  输出
                </span>
                <ul>
                  {agent.outputs.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="agent-card-facet">
                <span>
                  <Ban size={13} />
                  禁止事项
                </span>
                <ul>
                  {agent.prohibitions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/**
 * 独立页面外壳（当作为单独路由挂载时使用）。
 */
export function AgentRosterView() {
  return (
    <div className="page-view transparency-view">
      <header className="page-heading transparency-heading">
        <div>
          <h1>Agent 编队</h1>
          <p>
            现有服务切分的对外命名，不是新框架、不是新进程。每个 Agent
            的输入、输出与禁止事项都写在同一份目录里，可被 API 与测试引用。
          </p>
        </div>
        <IronRuleBadge />
      </header>
      <AgentRosterSection />
    </div>
  )
}
