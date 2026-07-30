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

/** Code-question runner config (existing Python path). Code branch of RunnerSpec. */
export interface PythonRunnerSpec {
  functionName: string
  maxAstNodes: number
  testCases: PythonTestCase[]
}

/** Skeleton specs for non-code question types (tickets 025+). */
export interface ChoiceRunnerSpec {
  readonly kind: 'choice'
  correctOptionIds: string[]
}

export interface FillBlankRunnerSpec {
  readonly kind: 'fill_blank'
  acceptedAnswers: string[]
  caseSensitive?: boolean
}

export interface NumericRunnerSpec {
  readonly kind: 'numeric'
  expected: number
  tolerance: number
}

export interface ExpressionRunnerSpec {
  readonly kind: 'expression'
  expectedLatex: string
  steps?: readonly string[]
  /**
   * Multi-expression mode (ADR-0011): when present, the submission is parsed
   * as labeled sub-expressions (one per label) and each is CAS-compared
   * against the matching expected here. `expectedLatex` is ignored in this
   * mode. Labels map to criterion ids `cas-<label>`.
   */
  answers?: Readonly<Record<string, string>>
}

export interface ChemEquationRunnerSpec {
  readonly kind: 'chem_equation'
  expectedEquation: string
}

export interface EssayRunnerSpec {
  readonly kind: 'essay'
  minWords?: number
  requiredKeywords?: string[]
}

/**
 * Geometry runner config for 3D-solid section questions (ADR-0010).
 * `vertices` is the solid's vertex table (e.g. a cube's 8 corners, keys A..H)
 * shared by the runner (shape recognition) and the Canvas (render) — a single
 * source of truth, mirroring ADR 0009's fixed-constants principle.
 * `sectionVertexIds` is the authored answer's section; the learner submits a
 * different set and the runner compares the resulting polygon's shape.
 */
export interface GeometryRunnerSpec {
  readonly kind: 'geometry'
  /** Solid vertex coordinates, keys A..H, right-handed frame. */
  vertices: Readonly<Record<string, readonly [number, number, number]>>
  /** Authored section vertex ids (learner submits its own set). */
  sectionVertexIds: readonly string[]
}

/**
 * Runner configuration union, discriminated by assignment.questionType.
 * The code branch keeps the untagged PythonRunnerSpec shape for backward
 * compatibility with Docker/subprocess runners.
 */
export type RunnerSpec =
  | PythonRunnerSpec
  | ChoiceRunnerSpec
  | FillBlankRunnerSpec
  | NumericRunnerSpec
  | ExpressionRunnerSpec
  | ChemEquationRunnerSpec
  | EssayRunnerSpec
  | GeometryRunnerSpec

export function isPythonRunnerSpec(spec: RunnerSpec): spec is PythonRunnerSpec {
  if (typeof spec !== 'object' || spec === null) return false
  if ('kind' in spec) return false
  return (
    'functionName' in spec &&
    typeof spec.functionName === 'string' &&
    'maxAstNodes' in spec &&
    typeof spec.maxAstNodes === 'number' &&
    'testCases' in spec &&
    Array.isArray(spec.testCases)
  )
}

export interface ExecutableAssignment extends Assignment {
  criteria: EvidenceCriterion[]
  runner: RunnerSpec
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
  questionType: 'code',
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

/** Demo: single-choice algebra (ObjectiveValidator → answer_match evidence). */
const choiceSimplifyAssignment: ExecutableAssignment = {
  id: 'choice-algebra-simplify',
  title: '选择题：代数式化简',
  module: '数学 · 代数基础',
  language: 'math',
  questionType: 'choice',
  estimatedMinutes: 5,
  status: 'ready',
  objective: '选择与 2(x+1) 代数等价的化简结果。',
  scenario: '课堂小测：同类项合并后的标准形式。',
  requirements: ['从选项中选出唯一正确答案', '答案以选项 id 提交（如 B）'],
  constraints: ['评分只比对选项集合，顺序无关', '生成式模型不参与分数计算'],
  functionSignature: '2(x+1) 化简后等于？',
  rubric: [
    {
      id: 'correctness',
      label: '答案正确性',
      description: '选项与标准答案集合一致',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '选中与 2x+2 等价的选项 B。',
      code: 'B'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误选未展开形式。',
      code: 'A'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '选项匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: 'B',
      conceptId: 'kp.math.algebra.simplify',
      passedMessage: '选项与标准答案一致',
      failedMessage: '选项与标准答案不一致'
    }
  ],
  runner: {
    kind: 'choice',
    correctOptionIds: ['B']
  }
}

/** Demo: fill-blank chemistry formula name. */
const fillBlankAtomAssignment: ExecutableAssignment = {
  id: 'fill-blank-water-formula',
  title: '填空题：水的化学式',
  module: '化学 · 物质构成',
  language: 'chemistry',
  questionType: 'fill_blank',
  estimatedMinutes: 3,
  status: 'ready',
  objective: '写出水分子的化学式。',
  scenario: '初中化学入门：从名称写化学式。',
  requirements: ['提交化学式字符串', '大小写按标准化学式书写'],
  constraints: ['可接受多种等价写法（如 H2O / H₂O 的 ASCII 形式）'],
  functionSignature: '水的化学式是 ______',
  rubric: [
    {
      id: 'correctness',
      label: '答案正确性',
      description: '填空命中任一可接受答案',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '标准化学式 H2O。',
      code: 'H2O'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '写成 HO 或 H2O2。',
      code: 'H2O2'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '填空匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: 'H2O',
      conceptId: 'kp.chemistry.matter.atom_structure',
      passedMessage: '填空与可接受答案匹配',
      failedMessage: '填空未命中可接受答案'
    }
  ],
  runner: {
    kind: 'fill_blank',
    acceptedAnswers: ['H2O', 'h2o'],
    caseSensitive: false
  }
}

/** Demo: numeric physics with tolerance. */
const numericOhmAssignment: ExecutableAssignment = {
  id: 'numeric-ohm-law',
  title: '数值题：欧姆定律求电阻',
  module: '物理 · 电学',
  language: 'physics',
  questionType: 'numeric',
  estimatedMinutes: 5,
  status: 'ready',
  objective: '已知 U=12 V，I=0.5 A，求电阻 R（欧姆）。',
  scenario: '串联电路中一段导体两端电压与电流已知，求电阻。',
  requirements: ['提交数值答案', '允许 ±0.01 的容差'],
  constraints: ['单位为欧姆，只提交数值不写单位'],
  functionSignature: 'R = U / I = ?',
  rubric: [
    {
      id: 'correctness',
      label: '数值正确性',
      description: '在容差内与期望值一致',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '12 / 0.5 = 24。',
      code: '24'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误用 R = I / U。',
      code: '0.0417'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '数值匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '24',
      conceptId: 'kp.physics.electricity.ohm_law',
      passedMessage: '数值在容差范围内',
      failedMessage: '数值超出容差或无法解析'
    }
  ],
  runner: {
    kind: 'numeric',
    expected: 24,
    tolerance: 0.01
  }
}

/**
 * Demo: CAS expression expansion.
 * ExpressionValidator evidence ids: cas-final (+ optional cas-step-*).
 */
const expressionExpandAssignment: ExecutableAssignment = {
  id: 'expression-perfect-square',
  title: '表达式题：完全平方展开',
  module: '数学 · 代数式',
  language: 'math',
  questionType: 'expression',
  estimatedMinutes: 8,
  status: 'ready',
  objective: '将 (x+1)^2 展开为多项式（CAS 代数等价即可）。',
  scenario: '课堂练习：不同书写形式只要代数等价均判对。',
  requirements: [
    '提交最终表达式（mathjs 友好形式）',
    '可选多行步骤：每行一步，末行为最终答案'
  ],
  constraints: ['评分来自 CAS 等价检查，形式不同仍可满分', '超时或解析失败记 blocked'],
  functionSignature: '(x+1)^2 → ?',
  rubric: [
    {
      id: 'correctness',
      label: '代数正确性',
      description: '最终答案与期望表达式代数等价',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案（展开式）',
      description: 'x^2+2*x+1 与 (x+1)^2 等价。',
      code: 'x^2+2*x+1'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '漏掉交叉项。',
      code: 'x^2+1'
    }
  ],
  criteria: [
    {
      id: 'cas-final',
      kind: 'cas_check',
      label: '最终答案 CAS 等价',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '(x+1)^2',
      conceptId: 'kp.math.algebra.simplify',
      passedMessage: '最终答案与期望代数等价',
      failedMessage: '最终答案与期望不等价或无法校验'
    }
  ],
  runner: {
    kind: 'expression',
    expectedLatex: '(x+1)^2'
  }
}

/**
 * Demo: chemical equation balancing.
 * ChemEquationValidator always emits evidence id `cas_check`.
 */
const chemWaterAssignment: ExecutableAssignment = {
  id: 'chem-water-formation',
  title: '方程式题：氢气燃烧生成水',
  module: '化学 · 化学反应',
  language: 'chemistry',
  questionType: 'chem_equation',
  estimatedMinutes: 8,
  status: 'ready',
  objective: '写出并配平氢气与氧气反应生成水的化学方程式。',
  scenario: '配平练习：允许整体倍数的等价配平。',
  requirements: [
    '提交完整方程式（支持 =、->、→）',
    '原子守恒且化学计量比与标准答案约简后一致'
  ],
  constraints: ['未配平或物种错误记 failed；解析失败记 blocked'],
  functionSignature: 'H2 + O2 → H2O （配平）',
  rubric: [
    {
      id: 'correctness',
      label: '配平正确性',
      description: '质量守恒且系数比与标准答案一致',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确配平',
      description: '2H2+O2=2H2O',
      code: '2H2+O2=2H2O'
    },
    {
      id: 'wrong',
      label: '未配平',
      description: '漏写系数。',
      code: 'H2+O2=H2O'
    }
  ],
  criteria: [
    {
      id: 'cas_check',
      kind: 'cas_check',
      label: '方程式配平与比对',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '2H2+O2=2H2O',
      conceptId: 'kp.chemistry.reaction.equation_balance',
      passedMessage: '配平正确且系数比与标准答案一致',
      failedMessage: '方程式未配平或与标准答案不一致'
    }
  ],
  runner: {
    kind: 'chem_equation',
    expectedEquation: '2H2+O2=2H2O'
  }
}

/**
 * Demo: physics projectile motion (y-component), expression + CAS.
 * ExpressionValidator splits a `y = RHS` submission and compares RHS to
 * expectedLatex. x(t) is intentionally NOT scored (no false evidence).
 * Fixed constants (v0=10, θ=π/4, g=9.8, t∈[0,2]) are shared with the
 * Canvas trajectory component; the runner stays symbolic over them.
 */
const physicsProjectileYAssignment: ExecutableAssignment = {
  id: 'physics-projectile-y',
  title: '物理题：斜抛运动的竖直分量',
  module: '物理 · 力学',
  language: 'physics',
  questionType: 'expression',
  estimatedMinutes: 8,
  status: 'ready',
  objective:
    '写出斜抛运动的竖直位移方程 y(t)，用初速度 v0、抛射角 theta、重力加速度 g、时间 t 表示。',
  scenario:
    '固定参数：v0 = 10 m/s，theta = π/4，g = 9.8 m/s²，t ∈ [0, 2]。提交形式：y = <表达式>。',
  requirements: [
    '提交 y 关于 t 的表达式（等号左侧为 y）',
    '允许代数等价的不同书写形式（CAS 判等）'
  ],
  constraints: ['评分来自 CAS 等价检查；解析失败记 blocked'],
  functionSignature: 'y = ?(v0, theta, g, t)',
  rubric: [
    {
      id: 'correctness',
      label: '竖直分量正确性',
      description: 'y(t) 与期望表达式代数等价',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '竖直分量：v0*sin(theta)*t - 0.5*g*t^2。',
      code: 'y = v0*sin(theta)*t - 0.5*g*t^2'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误用 cos 分量。',
      code: 'y = v0*cos(theta)*t - 0.5*g*t^2'
    }
  ],
  criteria: [
    {
      id: 'cas-final',
      kind: 'cas_check',
      label: '竖直分量 CAS 等价',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: 'v0*sin(theta)*t-0.5*g*t^2',
      conceptId: 'kp.physics.mechanics.projectile',
      passedMessage: '竖直分量与期望代数等价',
      failedMessage: '竖直分量与期望不等价或无法校验'
    }
  ],
  runner: {
    kind: 'expression',
    expectedLatex: 'v0*sin(theta)*t-0.5*g*t^2'
  }
}

/**
 * Demo: projectile motion, both components (ADR-0011 multi-expression mode).
 * Reuses the `expression` QuestionType + ExpressionValidator; the spec carries
 * `answers: {x, y}` so the validator emits `cas-x` / `cas-y` separately.
 * Fixed constants (v0=10, θ=π/4, g=9.8, t∈[0,2]) are shared with the
 * ProjectileXYCanvas; the runner stays symbolic over them.
 */
const physicsProjectileXYAssignment: ExecutableAssignment = {
  id: 'physics-projectile-xy',
  title: '物理题：斜抛运动的完整分量',
  module: '物理 · 力学',
  language: 'physics',
  questionType: 'expression',
  estimatedMinutes: 10,
  status: 'ready',
  objective:
    '写出斜抛运动的水平位移 x(t) 与竖直位移 y(t)，用初速度 v0、抛射角 theta、重力加速度 g、时间 t 表示。',
  scenario:
    '固定参数：v0 = 10 m/s，theta = π/4，g = 9.8 m/s²，t ∈ [0, 2]。提交形式：每行一个等式，先 x 后 y。',
  requirements: [
    '提交两行：x = <表达式> 和 y = <表达式>',
    '允许代数等价的不同书写形式（CAS 判等）'
  ],
  constraints: ['评分来自两条 CAS 等价检查；解析失败记 blocked'],
  functionSignature: 'x = ?(v0, theta, g, t)\ny = ?(v0, theta, g, t)',
  rubric: [
    {
      id: 'correctness',
      label: '分量正确性',
      description: 'x(t) 与 y(t) 均与期望代数等价',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: 'x=v0*cos(theta)*t，y=v0*sin(theta)*t-0.5*g*t^2。',
      code: 'x = v0*cos(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2'
    },
    {
      id: 'wrong-x',
      label: 'x 分量错误',
      description: '误用 sin 写 x 分量。',
      code: 'x = v0*sin(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2'
    },
    {
      id: 'missing-y',
      label: '缺少 y 分量',
      description: '只提交 x 分量，y 缺失。',
      code: 'x = v0*cos(theta)*t'
    }
  ],
  criteria: [
    {
      id: 'cas-x',
      kind: 'cas_check',
      label: 'x 分量 CAS 等价',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 50,
      expected: 'v0*cos(theta)*t',
      conceptId: 'kp.physics.mechanics.projectile_xy',
      passedMessage: 'x 分量与期望代数等价',
      failedMessage: 'x 分量与期望不等价或无法校验'
    },
    {
      id: 'cas-y',
      kind: 'cas_check',
      label: 'y 分量 CAS 等价',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 50,
      expected: 'v0*sin(theta)*t-0.5*g*t^2',
      conceptId: 'kp.physics.mechanics.projectile_xy',
      passedMessage: 'y 分量与期望代数等价',
      failedMessage: 'y 分量与期望不等价或无法校验'
    }
  ],
  runner: {
    kind: 'expression',
    expectedLatex: '',
    answers: {
      x: 'v0*cos(theta)*t',
      y: 'v0*sin(theta)*t-0.5*g*t^2'
    }
  }
}

/**
 * Demo: 3D-solid section shape recognition (ADR-0010).
 * GeometryRunner emits shape-vertices / shape-convex / render-artifact.
 * render-artifact is weight=0 audit-only (kind: render_artifact), isolated
 * in the maxScore=0 `render` rubric dimension so its state never pollutes
 * `correctness`. The vertex table is the single source of truth shared with
 * the Canvas (ADR 0009 fixed-constants principle).
 */
const cubeSectionAssignment: ExecutableAssignment = {
  id: 'cube-section',
  title: '立体几何：正方体截面形状',
  module: '数学 · 立体几何',
  language: 'math',
  questionType: 'geometry',
  estimatedMinutes: 8,
  status: 'ready',
  objective:
    '用平面截正方体，提交截面所经过的顶点编号，判断截面多边形的顶点数与凸性。',
  scenario:
    '正方体顶点 A–H（右手系）。提交顶点编号（逗号分隔，按截面多边形顺序），系统判断形状。',
  requirements: ['提交截面经过的顶点编号，按多边形顺序排列', '顶点数 3–6'],
  constraints: ['形状识别由 GeometryRunner 确定性计算；渲染参数作为审计证据记录'],
  functionSignature: '截面顶点: A, ...',
  rubric: [
    {
      id: 'correctness',
      label: '形状正确性',
      description: '截面顶点数合理且多边形为凸',
      maxScore: 100
    },
    {
      id: 'render',
      label: '渲染审计',
      description: '渲染参数快照（不计分，仅供复核重画）',
      maxScore: 0
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案（四边形截面）',
      description: '过 A,B,C,D 的底面截面，凸四边形。',
      code: 'A,B,C,D'
    },
    {
      id: 'wrong',
      label: '错误答案（顶点数超界）',
      description: '提交 7 个顶点，超出合理范围。',
      code: 'A,B,C,D,E,F,G'
    }
  ],
  criteria: [
    {
      id: 'shape-vertices',
      kind: 'answer_match',
      label: '截面顶点数',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 50,
      expected: '3–6',
      conceptId: 'kp.math.geometry.solid',
      passedMessage: '截面顶点数在合理范围内',
      failedMessage: '截面顶点数超出合理范围'
    },
    {
      id: 'shape-convex',
      kind: 'answer_match',
      label: '截面凸性',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 50,
      expected: '凸多边形',
      conceptId: 'kp.math.geometry.solid',
      passedMessage: '截面多边形共面且为凸多边形',
      failedMessage: '截面多边形非凸或不共面'
    },
    {
      id: 'render-artifact',
      kind: 'render_artifact',
      label: '渲染取证',
      dimensionId: 'render',
      visibility: 'public',
      weight: 0,
      conceptId: 'kp.math.geometry.solid',
      passedMessage: '已记录渲染参数快照',
      failedMessage: '未记录渲染参数'
    }
  ],
  runner: {
    kind: 'geometry',
    vertices: {
      A: [-1, -1, -1],
      B: [1, -1, -1],
      C: [1, 1, -1],
      D: [-1, 1, -1],
      E: [-1, -1, 1],
      F: [1, -1, 1],
      G: [1, 1, 1],
      H: [-1, 1, 1]
    },
    sectionVertexIds: ['A', 'B', 'C', 'D']
  }
}

/**
 * Demo: VSEPR molecular geometry — methane (ADR-0012).
 * Reuses `fill_blank` + ObjectiveValidator; the student writes the molecular
 * shape name (e.g. "tetrahedral"). No new QuestionType/runner. The 3D
 * ball-and-stick scene is the presentation layer (MoleculeCanvas); scoring
 * rests on the text match, not on the rendered geometry.
 */
const chemVseprMethaneAssignment: ExecutableAssignment = {
  id: 'chem-vsepr-methane',
  title: '化学题：甲烷的分子空间构型',
  module: '化学 · 物质构成',
  language: 'chemistry',
  questionType: 'fill_blank',
  estimatedMinutes: 6,
  status: 'ready',
  objective:
    '根据 VSEPR 模型判断甲烷（CH4）分子的空间构型名称。',
  scenario:
    '甲烷中心碳原子有 4 个 σ 键、0 个孤对电子。按 VSEPR 判断其分子几何形状，提交形状英文名或中文名。',
  requirements: ['提交分子几何形状名称（英文或中文均可）'],
  constraints: ['大小写不敏感；评分来自填空文本匹配'],
  functionSignature: 'CH4 的分子构型是 ______',
  rubric: [
    {
      id: 'correctness',
      label: '构型判断',
      description: '形状名称命中可接受答案',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '正四面体构型。',
      code: 'tetrahedral'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误判为平面正方形。',
      code: 'square planar'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: 'VSEPR 形状匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: 'tetrahedral',
      conceptId: 'kp.chemistry.matter.molecular_geometry',
      passedMessage: '甲烷为正四面体构型',
      failedMessage: '形状名称未命中可接受答案'
    }
  ],
  runner: {
    kind: 'fill_blank',
    acceptedAnswers: ['tetrahedral', '正四面体', '正四面体型', '四面体'],
    caseSensitive: false
  }
}

/**
 * Demo: VSEPR molecular geometry — water (ADR-0012).
 * H2O: 2 σ 键 + 2 孤对电子 → V 形（bent），键角约 104.5°。第二例验证
 * VSEPR 不止一种形状，且 acceptedAnswers 含多语言/同义词。
 */
const chemVseprWaterAssignment: ExecutableAssignment = {
  id: 'chem-vsepr-water',
  title: '化学题：水分子的空间构型',
  module: '化学 · 物质构成',
  language: 'chemistry',
  questionType: 'fill_blank',
  estimatedMinutes: 6,
  status: 'ready',
  objective: '根据 VSEPR 模型判断水分子（H2O）的空间构型名称。',
  scenario:
    '水分子中心氧原子有 2 个 σ 键、2 个孤对电子。按 VSEPR 判断其分子几何形状。',
  requirements: ['提交分子几何形状名称（英文或中文均可）'],
  constraints: ['大小写不敏感；评分来自填空文本匹配'],
  functionSignature: 'H2O 的分子构型是 ______',
  rubric: [
    {
      id: 'correctness',
      label: '构型判断',
      description: '形状名称命中可接受答案',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: 'V 形（弯曲形）。',
      code: 'bent'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误判为直线形。',
      code: 'linear'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: 'VSEPR 形状匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: 'bent',
      conceptId: 'kp.chemistry.matter.molecular_geometry',
      passedMessage: '水分子为 V 形（弯曲形）构型',
      failedMessage: '形状名称未命中可接受答案'
    }
  ],
  runner: {
    kind: 'fill_blank',
    acceptedAnswers: ['bent', 'v形', 'v 型', '弯曲形', '角形'],
    caseSensitive: false
  }
}

/**
 * Demo: crystal structure — NaCl (ADR-0014). Reuses `fill_blank` +
 * ObjectiveValidator; the student writes the crystal-structure name
 * (e.g. "面心立方"/"rock salt"). No new QuestionType/runner — same pattern as
 * VSEPR (0012). The 3D unit-cell scene is the presentation layer; scoring
 * rests on the text match.
 */
const chemCrystalNaClAssignment: ExecutableAssignment = {
  id: 'chem-crystal-nacl',
  title: '化学题：氯化钠的晶体结构',
  module: '化学 · 物质构成',
  language: 'chemistry',
  questionType: 'fill_blank',
  estimatedMinutes: 7,
  status: 'ready',
  objective:
    '识别氯化钠（NaCl）晶体的结构类型，理解每个 Na⁺ 被 6 个 Cl⁻ 八面体配位。',
  scenario:
    'NaCl 晶体中 Cl⁻ 作面心立方密堆积，Na⁺ 占据八面体空隙，形成 6:6 配位的离子晶体。提交该结构类型名称（中英文均可）。',
  requirements: ['提交晶体结构类型名称（英文或中文均可）'],
  constraints: ['大小写不敏感；评分来自填空文本匹配'],
  functionSignature: 'NaCl 的晶体结构是 ______ 型',
  rubric: [
    {
      id: 'correctness',
      label: '结构识别',
      description: '结构名称命中可接受答案',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '面心立方（岩盐型）。',
      code: '面心立方'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误判为体心立方。',
      code: '体心立方'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '晶体结构匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '面心立方',
      conceptId: 'kp.chemistry.matter.crystal_structure',
      passedMessage: 'NaCl 为面心立方（岩盐型）结构，6:6 配位',
      failedMessage: '结构名称未命中可接受答案'
    }
  ],
  runner: {
    kind: 'fill_blank',
    acceptedAnswers: [
      '面心立方',
      '氯化钠型',
      'rock salt',
      'rock-salt',
      'rocksalt',
      '岩盐',
      '岩盐型',
      'nacl型'
    ],
    caseSensitive: false
  }
}

/**
 * Demo: crystal structure — diamond (ADR-0014). Diamond cubic: two
 * interpenetrating FCC sublattices offset by (¼,¼,¼), each C is 4-coordinate
 * tetrahedral (C–C–C ≈ 109.47°). Covalent network crystal, contrast with the
 * ionic NaCl cell.
 */
const chemCrystalDiamondAssignment: ExecutableAssignment = {
  id: 'chem-crystal-diamond',
  title: '化学题：金刚石的晶体结构',
  module: '化学 · 物质构成',
  language: 'chemistry',
  questionType: 'fill_blank',
  estimatedMinutes: 7,
  status: 'ready',
  objective:
    '识别金刚石的晶体结构类型，理解每个碳原子以 sp³ 四面体配位形成共价网络。',
  scenario:
    '金刚石中每个碳原子与 4 个相邻碳原子形成四面体配位，构成三维共价网络。提交该结构类型名称（中英文均可）。',
  requirements: ['提交晶体结构类型名称（英文或中文均可）'],
  constraints: ['大小写不敏感；评分来自填空文本匹配'],
  functionSignature: '金刚石的晶体结构是 ______ 型',
  rubric: [
    {
      id: 'correctness',
      label: '结构识别',
      description: '结构名称命中可接受答案',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '金刚石型（四面体共价网络）。',
      code: '金刚石'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误判为石墨层状。',
      code: '石墨'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '晶体结构匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '金刚石',
      conceptId: 'kp.chemistry.matter.crystal_structure',
      passedMessage: '金刚石为四面体配位的共价网络结构',
      failedMessage: '结构名称未命中可接受答案'
    }
  ],
  runner: {
    kind: 'fill_blank',
    acceptedAnswers: ['金刚石', '金刚石型', 'diamond', '四面体', '四面体型'],
    caseSensitive: false
  }
}
const essayPerseveranceAssignment: ExecutableAssignment = {
  id: 'essay-perseverance-growth',
  title: '作文题：论坚持与成长',
  module: '语文 · 议论文写作',
  language: 'chinese',
  questionType: 'essay',
  estimatedMinutes: 30,
  status: 'ready',
  objective: '围绕「坚持与成长」写一篇结构完整的议论文。',
  scenario:
    '客观维度（字数、段落、句长、标点、结构、关键词）入正式分；立意与论证质量由 AdvisoryLayer 给出建议，不入分。',
  requirements: [
    '字数不少于 120 字',
    '至少 3 个自然段',
    '覆盖关键词：坚持、成长',
    '论点、支撑与结论清晰可辨'
  ],
  constraints: [
    '主观建议带 llm_inference provenance，须教师确认',
    '生成式模型不参与正式分数计算'
  ],
  functionSignature: '以「坚持与成长」为题',
  rubric: [
    {
      id: 'structure',
      label: '结构与篇幅',
      description: '字数、段落、句长与结构完整性',
      maxScore: 60
    },
    {
      id: 'language',
      label: '语言与关键词',
      description: '标点/书写启发式与关键词覆盖',
      maxScore: 40
    }
  ],
  demoVariants: [
    {
      id: 'well-structured',
      label: '结构完整范文',
      description: '论点、支撑、结论齐备，覆盖关键词。',
      code: '我认为坚持是成长路上最重要的品质。\n\n因为任何有价值的目标都不会一蹴而就，例如运动员每天重复枯燥的训练，研究表明长期坚持的人更容易突破瓶颈。数据显示，持续练习一万小时的人往往能达到专业水准，这正说明了坚持的力量。\n\n此外，坚持并不意味着盲目重复，而是在反思中不断调整方向。真正的成长来自于把坚持与思考结合起来。\n\n综上所述，唯有把坚持内化为习惯，我们才能在漫长的岁月里持续成长，成为更好的自己。'
    },
    {
      id: 'missing-structure',
      label: '结构缺失短文',
      description: '字数不足，缺关键词与结构标记。',
      code: '今天天气很好。我出去走了走，看到了很多花花草草。风吹过来很舒服，心情也变得不错。路边有很多人在散步。'
    }
  ],
  criteria: [
    {
      id: 'word-count',
      kind: 'structural_metric',
      label: '字数',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 15,
      conceptId: 'kp.chinese.writing.argumentative',
      passedMessage: '字数达到要求',
      failedMessage: '字数不在要求区间'
    },
    {
      id: 'paragraph-count',
      kind: 'structural_metric',
      label: '段落数',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 15,
      conceptId: 'kp.chinese.writing.argumentative',
      passedMessage: '段落数达到最低要求',
      failedMessage: '段落数不足'
    },
    {
      id: 'sentence-length',
      kind: 'structural_metric',
      label: '平均句长',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 10,
      conceptId: 'kp.chinese.writing.argumentative',
      passedMessage: '平均句长适中',
      failedMessage: '平均句长偏离合理区间'
    },
    {
      id: 'structure-completeness',
      kind: 'structural_metric',
      label: '结构完整性',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 20,
      conceptId: 'kp.chinese.writing.argumentative',
      passedMessage: '论点、支撑与结论齐备',
      failedMessage: '结构不完整'
    },
    {
      id: 'spelling-punctuation',
      kind: 'lint_result',
      label: '标点与书写',
      dimensionId: 'language',
      visibility: 'public',
      weight: 20,
      conceptId: 'kp.chinese.language.characters',
      passedMessage: '标点/书写启发式检查通过',
      failedMessage: '标点或书写问题过多'
    },
    {
      id: 'keyword-coverage',
      kind: 'structural_metric',
      label: '关键词覆盖',
      dimensionId: 'language',
      visibility: 'public',
      weight: 20,
      expected: '坚持,成长',
      conceptId: 'kp.chinese.writing.argumentative',
      passedMessage: '覆盖全部关键词',
      failedMessage: '缺少要求的关键词'
    }
  ],
  runner: {
    kind: 'essay',
    minWords: 120,
    requiredKeywords: ['坚持', '成长']
  }
}

/** Demo: English grammar choice (objective; reuses ChoiceValidator). */
const choiceEnglishTenseAssignment: ExecutableAssignment = {
  id: 'choice-english-present-perfect',
  title: '选择题：现在完成时',
  module: '英语 · 语法时态',
  language: 'english',
  questionType: 'choice',
  estimatedMinutes: 4,
  status: 'ready',
  objective: '选择正确完成句子的时态形式。',
  scenario: 'She _____ in Beijing since 2020.',
  requirements: ['从选项中选出唯一正确答案', '答案以选项 id 提交（如 C）'],
  constraints: ['评分只比对选项集合', '生成式模型不参与分数计算'],
  functionSignature: 'She _____ in Beijing since 2020.',
  rubric: [
    {
      id: 'correctness',
      label: '答案正确性',
      description: '选项与标准答案集合一致',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: 'since + 时间点 → 现在完成时 has lived。',
      code: 'C'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误选一般过去时。',
      code: 'A'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '选项匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: 'C',
      conceptId: 'kp.english.grammar.tenses',
      passedMessage: '选项与标准答案一致',
      failedMessage: '选项与标准答案不一致'
    }
  ],
  runner: {
    kind: 'choice',
    correctOptionIds: ['C']
  }
}

/**
 * Demo: magnetic helix trajectory (fill-blank + curve visualization).
 * Curve geometry is pre-seeded on seed:physics-magnetic-helix (no LLM).
 */
const physicsMagneticHelixAssignment: ExecutableAssignment = {
  id: 'physics-magnetic-helix',
  title: '填空题：磁场中的螺旋轨迹',
  module: '物理 · 电磁学',
  language: 'physics',
  questionType: 'fill_blank',
  estimatedMinutes: 4,
  status: 'ready',
  objective: '说出带电粒子在匀强磁场中（速度不垂直 B）的轨迹形状。',
  scenario:
    '粒子有平行于磁场的速度分量时，沿磁场方向匀速前进，垂直分量做圆周运动，合运动为螺旋线。右侧 3D 为预置螺旋演示（可旋转）。',
  requirements: ['提交轨迹形状名称', '可接受「螺旋」「螺旋线」等写法'],
  constraints: ['评分命中可接受答案即可；3D 仅展示不入分'],
  functionSignature: '轨迹形状是 ______',
  rubric: [
    {
      id: 'correctness',
      label: '答案正确性',
      description: '填空命中任一可接受答案',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '螺旋线。',
      code: '螺旋线'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误写为直线。',
      code: '直线'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '填空匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '螺旋线',
      conceptId: 'kp.physics.em.magnetic_force',
      passedMessage: '填空与可接受答案匹配',
      failedMessage: '填空未命中可接受答案'
    }
  ],
  runner: {
    kind: 'fill_blank',
    acceptedAnswers: ['螺旋线', '螺旋', 'helix', 'helical'],
    caseSensitive: false
  }
}

/** Demo: DNA double-helix shape (fill-blank + dual-strand curve visualization). */
const bioDnaHelixAssignment: ExecutableAssignment = {
  id: 'bio-dna-double-helix',
  title: '填空题：DNA 的空间结构',
  module: '生物 · 分子结构',
  language: 'biology',
  questionType: 'fill_blank',
  estimatedMinutes: 3,
  status: 'ready',
  objective: '写出 DNA 分子的典型空间结构名称。',
  scenario: '分子生物学入门：双链骨架呈双螺旋。右侧为预置双螺旋曲线演示（可旋转）。',
  requirements: ['提交结构名称'],
  constraints: ['评分命中可接受答案；3D 仅展示不入分'],
  functionSignature: 'DNA 的空间结构是 ______',
  rubric: [
    {
      id: 'correctness',
      label: '答案正确性',
      description: '填空命中任一可接受答案',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '双螺旋。',
      code: '双螺旋'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误写单链。',
      code: '单链'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '填空匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '双螺旋',
      conceptId: 'kp.biology.molecule.dna',
      passedMessage: '填空与可接受答案匹配',
      failedMessage: '填空未命中可接受答案'
    }
  ],
  runner: {
    kind: 'fill_blank',
    acceptedAnswers: ['双螺旋', '双螺旋结构', 'double helix', 'double-helix'],
    caseSensitive: false
  }
}

/** Demo: Biology fill-blank (objective; reuses ObjectiveValidator fill_blank). */
const fillBlankBiologyCellAssignment: ExecutableAssignment = {
  id: 'fill-blank-biology-mitochondria',
  title: '填空题：线粒体功能',
  module: '生物 · 细胞结构',
  language: 'biology',
  questionType: 'fill_blank',
  estimatedMinutes: 3,
  status: 'ready',
  objective: '写出细胞中主要负责有氧呼吸供能的细胞器名称。',
  scenario: '初中/高中衔接：细胞器与功能对应。',
  requirements: ['提交细胞器中文名称', '可接受常见别称'],
  constraints: ['评分命中任一可接受答案即可'],
  functionSignature: '细胞的「动力工厂」是 ______',
  rubric: [
    {
      id: 'correctness',
      label: '答案正确性',
      description: '填空命中任一可接受答案',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '线粒体。',
      code: '线粒体'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误写叶绿体。',
      code: '叶绿体'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '填空匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '线粒体',
      conceptId: 'kp.biology.cell.structure',
      passedMessage: '填空与可接受答案匹配',
      failedMessage: '填空未命中可接受答案'
    }
  ],
  runner: {
    kind: 'fill_blank',
    acceptedAnswers: ['线粒体', 'mitochondria', 'Mitochondria'],
    caseSensitive: false
  }
}

/** Demo: Politics objective choice. */
const choicePoliticsRightsAssignment: ExecutableAssignment = {
  id: 'choice-politics-basic-rights',
  title: '选择题：公民基本权利',
  module: '政治 · 法律基础',
  language: 'politics',
  questionType: 'choice',
  estimatedMinutes: 4,
  status: 'ready',
  objective: '识别宪法保障的公民基本权利范畴。',
  scenario: '初中道德与法治 / 高中思想政治入门小测。',
  requirements: ['从选项中选出唯一正确答案'],
  constraints: ['评分只比对选项集合'],
  functionSignature: '下列哪一项属于公民的基本政治权利？',
  rubric: [
    {
      id: 'correctness',
      label: '答案正确性',
      description: '选项与标准答案集合一致',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '选举权与被选举权。',
      code: 'B'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误选民事合同自由（非基本政治权利表述）。',
      code: 'A'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '选项匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: 'B',
      conceptId: 'kp.politics.law.basic_rights',
      passedMessage: '选项与标准答案一致',
      failedMessage: '选项与标准答案不一致'
    }
  ],
  runner: {
    kind: 'choice',
    correctOptionIds: ['B']
  }
}

/** Demo: History objective choice. */
const choiceHistoryOpiumAssignment: ExecutableAssignment = {
  id: 'choice-history-opium-war',
  title: '选择题：鸦片战争',
  module: '历史 · 中国近代史',
  language: 'history',
  questionType: 'choice',
  estimatedMinutes: 4,
  status: 'ready',
  objective: '识别鸦片战争的直接导火索。',
  scenario: '中国近代史开端知识点检测。',
  requirements: ['从选项中选出唯一正确答案'],
  constraints: ['评分只比对选项集合'],
  functionSignature: '鸦片战争的直接导火索是？',
  rubric: [
    {
      id: 'correctness',
      label: '答案正确性',
      description: '选项与标准答案集合一致',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '虎门销烟。',
      code: 'A'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误选洋务运动。',
      code: 'C'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '选项匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: 'A',
      conceptId: 'kp.history.modern_china.opium_war',
      passedMessage: '选项与标准答案一致',
      failedMessage: '选项与标准答案不一致'
    }
  ],
  runner: {
    kind: 'choice',
    correctOptionIds: ['A']
  }
}

/** Demo: Geography numeric (climate latitude band). */
const numericGeographyLatitudeAssignment: ExecutableAssignment = {
  id: 'numeric-geography-tropic',
  title: '数值题：北回归线纬度',
  module: '地理 · 地球运动与气候',
  language: 'geography',
  questionType: 'numeric',
  estimatedMinutes: 4,
  status: 'ready',
  objective: '写出北回归线的大致纬度值（度）。',
  scenario: '自然地理：五带划分与回归线。',
  requirements: ['提交数值答案', '允许 ±0.5 的容差'],
  constraints: ['只提交数值，不写单位「度」'],
  functionSignature: '北回归线纬度 ≈ ?°',
  rubric: [
    {
      id: 'correctness',
      label: '数值正确性',
      description: '在容差内与期望值一致',
      maxScore: 100
    }
  ],
  demoVariants: [
    {
      id: 'correct',
      label: '正确答案',
      description: '约 23.5°N。',
      code: '23.5'
    },
    {
      id: 'wrong',
      label: '错误答案',
      description: '误记为赤道 0°。',
      code: '0'
    }
  ],
  criteria: [
    {
      id: 'answer-match',
      kind: 'answer_match',
      label: '数值匹配',
      dimensionId: 'correctness',
      visibility: 'public',
      weight: 100,
      expected: '23.5',
      conceptId: 'kp.geography.physical.climate',
      passedMessage: '数值在容差范围内',
      failedMessage: '数值超出容差或无法解析'
    }
  ],
  runner: {
    kind: 'numeric',
    expected: 23.5,
    tolerance: 0.5
  }
}

/**
 * Demo: History discourse (essay type). Objective structural metrics enter the
 * formal score; thesis quality stays in AdvisoryLayer only (ADR-0008).
 */
const essayHistorySourceAssignment: ExecutableAssignment = {
  id: 'essay-history-source-analysis',
  title: '论述题：史料实证与鸦片战争',
  module: '历史 · 史料方法',
  language: 'history',
  questionType: 'essay',
  estimatedMinutes: 25,
  status: 'ready',
  objective: '结合史料实证方法，简述鸦片战争对中国近代社会转型的影响。',
  scenario:
    '客观维度（字数、段落、关键词）入正式分；立意与论证深度由 AdvisoryLayer 给出建议，不入分，须教师确认。',
  requirements: [
    '字数不少于 100 字',
    '至少 2 个自然段',
    '覆盖关键词：史料、鸦片战争'
  ],
  constraints: [
    '主观建议带 llm_inference provenance，须教师确认',
    '生成式模型不参与正式分数计算'
  ],
  functionSignature: '以史料实证视角论述鸦片战争的影响',
  rubric: [
    {
      id: 'structure',
      label: '结构与篇幅',
      description: '字数、段落与结构完整性',
      maxScore: 60
    },
    {
      id: 'language',
      label: '关键词覆盖',
      description: '史料方法相关关键词',
      maxScore: 40
    }
  ],
  demoVariants: [
    {
      id: 'well-structured',
      label: '结构完整论述',
      description: '覆盖关键词，有论点与结论。',
      code: '我认为运用史料实证方法研究鸦片战争，能够更准确地把握近代中国的社会转型。\n\n例如，对照中英双方档案与海关贸易数据可以发现，战争前后通商口岸的开放改变了传统经济格局。史料表明，条约体系逐步侵蚀了原有的朝贡秩序。\n\n综上所述，只有把鸦片战争放在多源史料互证的框架下，才能理解它作为近代史开端的深刻影响。'
    },
    {
      id: 'missing-structure',
      label: '结构缺失短文',
      description: '字数不足且缺关键词。',
      code: '很久以前发生过战争。人们打了很久。后来签了条约。'
    }
  ],
  criteria: [
    {
      id: 'word-count',
      kind: 'structural_metric',
      label: '字数',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 25,
      conceptId: 'kp.history.methodology.source_analysis',
      passedMessage: '字数达到要求',
      failedMessage: '字数不在要求区间'
    },
    {
      id: 'paragraph-count',
      kind: 'structural_metric',
      label: '段落数',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 20,
      conceptId: 'kp.history.methodology.source_analysis',
      passedMessage: '段落数达到最低要求',
      failedMessage: '段落数不足'
    },
    {
      id: 'structure-completeness',
      kind: 'structural_metric',
      label: '结构完整性',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 15,
      conceptId: 'kp.history.methodology.source_analysis',
      passedMessage: '论点、支撑与结论齐备',
      failedMessage: '结构不完整'
    },
    {
      id: 'keyword-coverage',
      kind: 'structural_metric',
      label: '关键词覆盖',
      dimensionId: 'language',
      visibility: 'public',
      weight: 40,
      expected: '史料,鸦片战争',
      conceptId: 'kp.history.modern_china.opium_war',
      passedMessage: '覆盖全部关键词',
      failedMessage: '缺少要求的关键词'
    }
  ],
  runner: {
    kind: 'essay',
    minWords: 100,
    requiredKeywords: ['史料', '鸦片战争']
  }
}

/**
 * Demo: Politics discourse (essay type). Same ADR-0008 split: objective
 * evidence scores; AdvisoryLayer never contributes formal points.
 */
const essayPoliticsMoralityAssignment: ExecutableAssignment = {
  id: 'essay-politics-social-rules',
  title: '论述题：社会规则与个人成长',
  module: '政治 · 道德与法治',
  language: 'politics',
  questionType: 'essay',
  estimatedMinutes: 25,
  status: 'ready',
  objective: '论述遵守社会规则对个人成长的意义。',
  scenario:
    '客观维度入正式分；价值判断与论证质量仅由 AdvisoryLayer 建议，不入分。',
  requirements: [
    '字数不少于 100 字',
    '至少 2 个自然段',
    '覆盖关键词：规则、成长'
  ],
  constraints: [
    '主观建议带 llm_inference provenance，须教师确认',
    '生成式模型不参与正式分数计算'
  ],
  functionSignature: '论述社会规则与个人成长',
  rubric: [
    {
      id: 'structure',
      label: '结构与篇幅',
      description: '字数、段落与结构完整性',
      maxScore: 60
    },
    {
      id: 'language',
      label: '关键词覆盖',
      description: '规则与成长相关关键词',
      maxScore: 40
    }
  ],
  demoVariants: [
    {
      id: 'well-structured',
      label: '结构完整论述',
      description: '覆盖关键词，有论点与结论。',
      code: '我认为遵守社会规则是个人成长的重要基础。\n\n因为规则为每个人划定了权利与义务的边界，例如交通规则保障出行安全，学习纪律帮助形成自律习惯。只有在规则之内行动，成长才是可持续的。\n\n综上所述，规则不是束缚，而是个人在集体中实现更好成长的轨道。'
    },
    {
      id: 'missing-structure',
      label: '结构缺失短文',
      description: '字数不足且缺关键词。',
      code: '做人要听话。不要捣乱。好好学习。'
    }
  ],
  criteria: [
    {
      id: 'word-count',
      kind: 'structural_metric',
      label: '字数',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 25,
      conceptId: 'kp.politics.morality.social_rules',
      passedMessage: '字数达到要求',
      failedMessage: '字数不在要求区间'
    },
    {
      id: 'paragraph-count',
      kind: 'structural_metric',
      label: '段落数',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 20,
      conceptId: 'kp.politics.morality.social_rules',
      passedMessage: '段落数达到最低要求',
      failedMessage: '段落数不足'
    },
    {
      id: 'structure-completeness',
      kind: 'structural_metric',
      label: '结构完整性',
      dimensionId: 'structure',
      visibility: 'public',
      weight: 15,
      conceptId: 'kp.politics.morality.self_growth',
      passedMessage: '论点、支撑与结论齐备',
      failedMessage: '结构不完整'
    },
    {
      id: 'keyword-coverage',
      kind: 'structural_metric',
      label: '关键词覆盖',
      dimensionId: 'language',
      visibility: 'public',
      weight: 40,
      expected: '规则,成长',
      conceptId: 'kp.politics.morality.social_rules',
      passedMessage: '覆盖全部关键词',
      failedMessage: '缺少要求的关键词'
    }
  ],
  runner: {
    kind: 'essay',
    minWords: 100,
    requiredKeywords: ['规则', '成长']
  }
}

const allAssignments: readonly ExecutableAssignment[] = [
  pythonAverageAssignment,
  choiceSimplifyAssignment,
  fillBlankAtomAssignment,
  numericOhmAssignment,
  expressionExpandAssignment,
  physicsProjectileYAssignment,
  physicsProjectileXYAssignment,
  physicsMagneticHelixAssignment,
  cubeSectionAssignment,
  chemVseprMethaneAssignment,
  chemVseprWaterAssignment,
  chemCrystalNaClAssignment,
  chemCrystalDiamondAssignment,
  chemWaterAssignment,
  essayPerseveranceAssignment,
  choiceEnglishTenseAssignment,
  fillBlankBiologyCellAssignment,
  bioDnaHelixAssignment,
  choicePoliticsRightsAssignment,
  choiceHistoryOpiumAssignment,
  numericGeographyLatitudeAssignment,
  essayHistorySourceAssignment,
  essayPoliticsMoralityAssignment
]

class InMemoryAssignmentRegistry implements AssignmentRegistry {
  private readonly assignments = new Map<string, ExecutableAssignment>(
    allAssignments.map((item) => [item.id, item])
  )

  public list(): AssignmentSummary[] {
    return [...this.assignments.values()].map(
      ({ id, title, module, language, questionType, estimatedMinutes, status }) => ({
        id,
        title,
        module,
        language,
        questionType,
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
