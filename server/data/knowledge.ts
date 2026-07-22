import type { Diagnosis, Intervention } from '../../shared/contracts'

export interface KnowledgeEntry {
  conceptId: string
  label: string
  diagnosis: Omit<Diagnosis, 'evidenceIds'>
  intervention: Intervention
}

export interface KnowledgeBase {
  get(conceptId: string): KnowledgeEntry | undefined
  list(): KnowledgeEntry[]
}

const entries: KnowledgeEntry[] = [
  {
    conceptId: 'empty-sequence',
    label: '空序列边界',
    diagnosis: {
      conceptId: 'empty-sequence',
      title: '空序列边界未处理',
      explanation:
        '实现直接用序列长度作为除数。当输入为空时，分母为零，任务会在结果交付前中断。',
      severity: 'high'
    },
    intervention: {
      conceptId: 'empty-sequence',
      title: '先封住空序列路径',
      rationale: '这是当前唯一阻断满分的高风险边界，先修复它能形成最短验证闭环。',
      instruction:
        '在计算总和与长度之前识别空序列，并按任务契约直接返回 0；保留非空路径的原有计算。',
      successCriteria: [
        'calculate_average([]) 返回 0',
        '常规整数与小数样例仍通过',
        '函数不打印、不读取用户输入'
      ],
      hints: ['Python 中空列表可直接用于布尔判断', '把边界分支放在除法之前']
    }
  },
  {
    conceptId: 'aggregation-basics',
    label: '聚合计算',
    diagnosis: {
      conceptId: 'aggregation-basics',
      title: '平均值主路径不稳定',
      explanation: '一个或多个基础样例没有得到总和除以元素数量的结果。',
      severity: 'high'
    },
    intervention: {
      conceptId: 'aggregation-basics',
      title: '恢复平均值主路径',
      rationale: '常规计算是其余边界处理成立的基础，应先得到一个可验证的正确主路径。',
      instruction: '使用元素总和除以元素数量，并返回计算结果，不要把测试样例写进函数。',
      successCriteria: ['整数列表计算正确', '单元素列表返回该元素本身'],
      hints: ['分别确认分子和分母的来源', '避免硬编码示例答案']
    }
  },
  {
    conceptId: 'numeric-semantics',
    label: '数值语义',
    diagnosis: {
      conceptId: 'numeric-semantics',
      title: '数值类型或符号处理有偏差',
      explanation: '实现对小数、零值或负数作了额外假设，导致结果偏离算术平均值。',
      severity: 'medium'
    },
    intervention: {
      conceptId: 'numeric-semantics',
      title: '移除不必要的数值假设',
      rationale: '平均值规则对整数、小数和带符号数应保持一致。',
      instruction: '检查是否使用了整除、取整、绝对值或过滤负数，并保留标准除法语义。',
      successCriteria: ['小数样例保留精度', '负数和零值参与原始计算'],
      hints: ['Python 的 / 与 // 语义不同', '不要修改输入列表']
    }
  },
  {
    conceptId: 'function-contract',
    label: '函数契约',
    diagnosis: {
      conceptId: 'function-contract',
      title: '提交没有遵守函数接口契约',
      explanation: '评测系统无法稳定调用目标函数，或函数执行产生了额外交互输出。',
      severity: 'medium'
    },
    intervention: {
      conceptId: 'function-contract',
      title: '收紧函数接口',
      rationale: '稳定接口让同一实现能被测试、复用并集成到真实流程。',
      instruction:
        '保留指定函数名和一个 scores 参数；通过 return 交付结果，移除 input 与 print。',
      successCriteria: ['目标函数可被直接调用', '所有结果通过 return 交付'],
      hints: ['函数定义应与题目签名一致', '调试输出不属于函数结果']
    }
  },
  {
    conceptId: 'implementation-clarity',
    label: '实现清晰度',
    diagnosis: {
      conceptId: 'implementation-clarity',
      title: '实现复杂度超过任务需要',
      explanation: '额外的控制流和结构增加了理解成本，但没有带来新的任务能力。',
      severity: 'low'
    },
    intervention: {
      conceptId: 'implementation-clarity',
      title: '压缩到一个清晰职责',
      rationale: '小函数的可读性来自明确输入、边界与返回值，而不是更多抽象。',
      instruction: '保留一个边界分支和一个主计算路径，删除与任务无关的结构。',
      successCriteria: ['实现可在一次阅读中理解', '没有未使用变量或重复分支'],
      hints: ['先删去不会改变结果的代码', '本任务不需要类或递归']
    }
  }
]

class StaticKnowledgeBase implements KnowledgeBase {
  private readonly byId = new Map(entries.map((entry) => [entry.conceptId, entry]))

  public get(conceptId: string): KnowledgeEntry | undefined {
    return this.byId.get(conceptId)
  }

  public list(): KnowledgeEntry[] {
    return [...this.byId.values()]
  }
}

export function createKnowledgeBase(): KnowledgeBase {
  return new StaticKnowledgeBase()
}
