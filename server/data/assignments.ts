import type {
  Assignment,
  AssignmentSummary,
  EvidenceKind,
  EvidenceVisibility
} from '../../shared/contracts'

export interface EvidenceCriterion {
  id: string
  kind: EvidenceKind
  label: string
  dimensionId: string
  visibility: EvidenceVisibility
  weight: number
  expected?: string
  conceptId: string
  passedMessage: string
  failedMessage: string
}

export interface PythonTestCase {
  id: string
  args: unknown[]
  expected: unknown
}

export interface PythonRunnerSpec {
  functionName: string
  maxAstNodes: number
  testCases: PythonTestCase[]
}

export interface ExecutableAssignment extends Assignment {
  criteria: EvidenceCriterion[]
  runner: PythonRunnerSpec
}

export interface AssignmentRegistry {
  list(): AssignmentSummary[]
  get(id: string): ExecutableAssignment | undefined
}

const pythonAverageAssignment: ExecutableAssignment = {
  id: 'python-average',
  title: '边界条件诊断：平均分函数',
  module: 'Python 基础 · 函数与边界',
  language: 'python',
  estimatedMinutes: 12,
  status: 'ready',
  objective: '实现一个可靠的平均分函数，并用测试证据证明它能处理常规输入与边界输入。',
  scenario:
    '教务系统需要汇总一组成绩。上游数据可能暂时为空，函数必须返回稳定结果，不能因为空列表中断整批任务。',
  requirements: [
    '声明 calculate_average(scores) 函数',
    '非空列表返回算术平均值',
    '空列表返回 0',
    '函数内不读取输入、不打印结果'
  ],
  constraints: [
    '仅使用 Python 标准语法，不导入第三方库',
    '本地演示运行器限制执行时间并屏蔽文件、网络与动态执行能力',
    '评分只来自测试和静态证据，生成式模型不参与分数计算'
  ],
  functionSignature: 'def calculate_average(scores):',
  rubric: [
    {
      id: 'correctness',
      label: '功能正确性',
      description: '常规、数值与边界测试的可重复运行结果',
      maxScore: 60
    },
    {
      id: 'contract',
      label: '接口契约',
      description: '函数签名稳定，执行过程无交互副作用',
      maxScore: 20
    },
    {
      id: 'clarity',
      label: '实现清晰度',
      description: '实现保持聚焦，没有与任务无关的复杂结构',
      maxScore: 20
    }
  ],
  demoVariants: [
    {
      id: 'boundary-bug',
      label: '存在边界缺陷',
      description: '常规输入正确，但空列表会触发除零错误。',
      code: 'def calculate_average(scores):\n    return sum(scores) / len(scores)'
    },
    {
      id: 'fixed',
      label: '完成边界修复',
      description: '先处理空序列，再执行平均值计算。',
      code:
        'def calculate_average(scores):\n    if not scores:\n        return 0\n\n    return sum(scores) / len(scores)'
    },
    {
      id: 'contract-bug',
      label: '存在交互副作用',
      description: '计算正确，但函数内部打印结果，违反接口契约。',
      code:
        'def calculate_average(scores):\n    if not scores:\n        return 0\n\n    result = sum(scores) / len(scores)\n    print(result)\n    return result'
    }
  ],
  criteria: [
    {
      id: 'basic-average',
      kind: 'test',
      label: '常规样例',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 15,
      expected: '90',
      conceptId: 'aggregation-basics',
      passedMessage: '常规整数列表计算正确',
      failedMessage: '常规整数列表的平均值不正确'
    },
    {
      id: 'decimal-average',
      kind: 'test',
      label: '小数精度',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 10,
      expected: '80',
      conceptId: 'numeric-semantics',
      passedMessage: '小数分数计算正确',
      failedMessage: '小数输入的计算结果不符合预期'
    },
    {
      id: 'negative-average',
      kind: 'test',
      label: '符号与零值',
      dimensionId: 'correctness',
      visibility: 'hidden',
      weight: 5,
      conceptId: 'numeric-semantics',
      passedMessage: '含负数与零值的数据计算正确',
      failedMessage: '混合符号输入暴露了数值处理问题'
    },
    {
      id: 'empty-input',
      kind: 'test',
      label: '空序列边界',
      dimensionId: 'correctness',
      visibility: 'hidden',
      weight: 20,
      conceptId: 'empty-sequence',
      passedMessage: '空列表按契约返回 0',
      failedMessage: '空列表路径没有返回约定结果'
    },
    {
      id: 'single-score',
      kind: 'test',
      label: '单元素输入',
      dimensionId: 'correctness',
      visibility: 'hidden',
      weight: 10,
      conceptId: 'aggregation-basics',
      passedMessage: '单元素列表计算正确',
      failedMessage: '单元素列表结果不正确'
    },
    {
      id: 'required-function',
      kind: 'static',
      label: '函数签名',
      dimensionId: 'contract',
      visibility: 'public',
      weight: 10,
      expected: 'calculate_average(scores)',
      conceptId: 'function-contract',
      passedMessage: '目标函数签名存在',
      failedMessage: '未找到约定的 calculate_average 函数'
    },
    {
      id: 'no-side-effects',
      kind: 'static',
      label: '无交互副作用',
      dimensionId: 'contract',
      visibility: 'public',
      weight: 10,
      conceptId: 'function-contract',
      passedMessage: '执行过程没有标准输出副作用',
      failedMessage: '函数执行时产生了不必要的输出'
    },
    {
      id: 'focused-function',
      kind: 'static',
      label: '实现聚焦',
      dimensionId: 'clarity',
      visibility: 'public',
      weight: 20,
      conceptId: 'implementation-clarity',
      passedMessage: '实现规模与任务复杂度匹配',
      failedMessage: '实现包含过多结构，降低了可读性'
    }
  ],
  runner: {
    functionName: 'calculate_average',
    maxAstNodes: 48,
    testCases: [
      { id: 'basic-average', args: [[84, 90, 96]], expected: 90 },
      { id: 'decimal-average', args: [[72.5, 87.5]], expected: 80 },
      { id: 'negative-average', args: [[-10, 0, 10]], expected: 0 },
      { id: 'empty-input', args: [[]], expected: 0 },
      { id: 'single-score', args: [[86]], expected: 86 }
    ]
  }
}

class InMemoryAssignmentRegistry implements AssignmentRegistry {
  private readonly assignments = new Map<string, ExecutableAssignment>([
    [pythonAverageAssignment.id, pythonAverageAssignment]
  ])

  public list(): AssignmentSummary[] {
    return [...this.assignments.values()].map(
      ({ id, title, module, language, estimatedMinutes, status }) => ({
        id,
        title,
        module,
        language,
        estimatedMinutes,
        status
      })
    )
  }

  public get(id: string): ExecutableAssignment | undefined {
    return this.assignments.get(id)
  }
}

export function createAssignmentRegistry(): AssignmentRegistry {
  return new InMemoryAssignmentRegistry()
}
