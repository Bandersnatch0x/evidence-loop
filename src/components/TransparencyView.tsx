import {
  Binary,
  Bot,
  Box,
  BrainCircuit,
  Database,
  FileCheck2,
  Scale,
  ShieldCheck,
  UserRoundCheck
} from 'lucide-react'
import { EvidenceFlowDiagram, demoEvaluationFlow } from './evidenceFlow'

const pipeline = [
  { icon: Box, title: '读取任务', tool: 'assignment.retrieve', text: '加载任务、测试规范和版本化量规。' },
  { icon: Binary, title: '受限执行', tool: 'python.safe-runner', text: '运行测试并生成不可由模型改写的事实。' },
  { icon: Scale, title: '量规评分', tool: 'rubric.score', text: '按证据权重确定每个维度和总分。' },
  { icon: Database, title: '知识检索', tool: 'knowledge.retrieve', text: '将失败证据映射为薄弱概念与训练策略。' },
  { icon: Bot, title: '反馈表达', tool: 'feedback.generate', text: '模型仅将既有证据组织成简明反馈。' }
]

export function TransparencyView() {
  return (
    <div className="page-view transparency-view">
      <header className="page-heading transparency-heading">
        <div>
          <h1>项目透明度</h1>
          <p>可复现 Agent 架构：把评分事实、知识推理和生成表达拆开，让每一步都能被检查和替换。</p>
        </div>
        <span className="open-badge"><FileCheck2 size={15} /> Evidence-first</span>
      </header>

      <section className="transparency-section">
        <div className="section-heading">
          <div><span>01</span><h2>一次评估如何完成</h2></div>
          <p>五步执行轨迹会随每次结果返回，便于复现与排错。</p>
        </div>
        <div className="pipeline-grid">
          {pipeline.map(({ icon: Icon, title, tool, text }, index) => (
            <article key={tool}>
              <div className="pipeline-number">{String(index + 1).padStart(2, '0')}</div>
              <Icon size={20} />
              <h3>{title}</h3><code>{tool}</code><p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="transparency-section">
        <div className="section-heading">
          <div><span>02</span><h2>三条不可越过的边界</h2></div>
        </div>
        <div className="boundary-grid">
          <article>
            <div className="boundary-icon"><Scale size={21} /></div>
            <span>评分边界</span><h3>模型不能决定分数</h3>
            <p>总分是各证据项通过权重之和。测试失败、静态检查和量规映射均可单独核验。</p>
            <ul><li>固定测试用例</li><li>版本化评分量规</li><li>结果保留证据 ID</li></ul>
          </article>
          <article>
            <div className="boundary-icon"><BrainCircuit size={21} /></div>
            <span>模型边界</span><h3>生成只负责表达</h3>
            <p>模型接收的是已确定的分数、证据和诊断，只能总结，失败时自动回退到本地规则。</p>
            <ul><li>结构化输入</li><li>Schema 校验输出</li><li>本地策略兜底</li></ul>
          </article>
          <article>
            <div className="boundary-icon"><UserRoundCheck size={21} /></div>
            <span>教师边界</span><h3>建议不替代专业判断</h3>
            <p>系统只标出与当前任务相关的证据缺口，不自动认定正式成绩，不评价个人属性。</p>
            <ul><li>教师确认干预</li><li>可回看原始证据</li><li>避免越界推断</li></ul>
          </article>
        </div>
      </section>

      <section className="transparency-section safety-section">
        <div className="section-heading">
          <div><span>03</span><h2>数据与执行安全</h2></div>
        </div>
        <div className="safety-grid">
          <article><ShieldCheck size={20} /><div><h3>最小化数据</h3><p>当前 Demo 使用本地匿名样例，只保存代码评估结果，不要求姓名、学校或联系方式。</p></div></article>
          <article><Database size={20} /><div><h3>本地可清除存储</h3><p>评估历史写入本地 JSON，方便演示复现。生产环境应采用租户隔离、保留期限和审计日志。</p></div></article>
          <article className="safety-warning"><Box size={20} /><div><h3>运行器适用范围</h3><p>Python 子进程隔离仅用于受控本地 Demo。公开部署前必须迁移到无网络容器或微虚拟机，并设置 CPU、内存和文件系统配额。</p></div></article>
        </div>
      </section>

      <section className="transparency-section">
        <div className="section-heading">
          <div><span>04</span><h2>证据如何变成分数</h2></div>
          <p>每条测试证据按权重归约到量规维度，各维度加和为总分--模型不参与打分，整条链可核验。</p>
        </div>
        <EvidenceFlowDiagram evaluation={demoEvaluationFlow} />
      </section>

    </div>
  )
}
