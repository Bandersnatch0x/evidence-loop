import type { EvaluationResult, EvidenceItem } from '../../shared/contracts'

/**
 * Demo-level PII detection (ADR-0003 §3).
 *
 * Only three fields are scanned before evaluation persistence:
 * `summary`, `rejectionReason`, and `evidence[].actual`.
 * Numeric fields such as `score` / `count` are intentionally out of scope
 * so they cannot false-positive.
 */

export type PIIKind = 'chinese_name' | 'phone' | 'email' | 'student_id'

export interface PIIMatch {
  kind: PIIKind
  field: string
  /** 1-based line number within the scanned field value. */
  line: number
  snippet: string
}

export class PIIError extends Error {
  public readonly matches: readonly PIIMatch[]

  public constructor(matches: readonly PIIMatch[]) {
    if (matches.length === 0) {
      throw new Error('PIIError requires at least one match')
    }
    const primary = matches[0]
    if (primary === undefined) {
      throw new Error('PIIError requires at least one match')
    }
    super(formatPIIErrorMessage(matches))
    this.name = 'PIIError'
    this.matches = matches
  }
}

const PII_KIND_LABEL: Record<PIIKind, string> = {
  chinese_name: '中文姓名',
  phone: '手机号',
  email: '邮箱',
  student_id: '学号'
}

/**
 * Common single-character Chinese surnames used for demo-level name detection.
 * Paired with 1–2 given-name characters. Not production NER — only catches
 * careless name leakage (ADR-0003). Names are matched via:
 *   1) context markers (姓名/学生/同学/我是/名叫), or
 *   2) punctuation / whitespace boundaries (avoids educational bigrams).
 */
const CHINESE_SURNAMES =
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公'

const NAME_BODY = `[${CHINESE_SURNAMES}][\\u4e00-\\u9fa5]{1,2}`

/** Educational bigrams that look like surname+given but are not personal names. */
const CHINESE_NAME_FALSE_POSITIVES = new Set([
  '通过',
  '当前',
  '全部',
  '计算',
  '正确',
  '函数',
  '返回',
  '列表',
  '分数',
  '得分',
  '提高',
  '下降',
  '持平',
  '训练',
  '能力',
  '任务',
  '闭环',
  '验证',
  '提交',
  '失败',
  '成功',
  '错误',
  '触发',
  '边界',
  '常规',
  '平均',
  '结构',
  '保持',
  '聚焦',
  '存在',
  '发现',
  '输入',
  '输出',
  '完成',
  '处理',
  '优先',
  '本轮',
  '进入',
  '运行',
  '签名',
  '数据',
  '负数',
  '小数',
  '空列',
  '除零',
  '需要',
  '说明',
  '正常',
  '关注',
  '重新',
  '联系',
  '获取',
  '帮助',
  '查看',
  '详情',
  '符合',
  '预期',
  '对应',
  '用例',
  '安全',
  '问题',
  '可能',
  '可以',
  '因为',
  '所以',
  '但是',
  '如果',
  '已经',
  '还是',
  '或者',
  '以及',
  '进行',
  '使用',
  '实现',
  '支持',
  '提供',
  '包括',
  '根据',
  '关于',
  '对于',
  '由于',
  '为了',
  '之后',
  '之前',
  '之间',
  '其中',
  '这个',
  '那个',
  '什么',
  '怎么',
  '如何',
  '是否',
  '没有',
  '不是',
  '就是',
  '还能',
  '还可',
  '未能',
  '可进',
  '已完',
  '未通',
  '薄弱',
  '补交',
  '写了',
  '得分'
])

const PATTERNS: ReadonlyArray<{ kind: PIIKind; regex: RegExp; group?: number }> =
  [
    // Mobile: mainland China 11-digit numbers starting 13–19.
    { kind: 'phone', regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
    // Email (ASCII local + domain).
    {
      kind: 'email',
      regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    },
    // Student id: 20xxxxxx (8 digits, year 20xx + 4-digit serial).
    { kind: 'student_id', regex: /(?<!\d)20\d{6}(?!\d)/g },
    // Chinese name with an explicit context marker (captures name in group 1).
    {
      kind: 'chinese_name',
      regex: new RegExp(
        `(?:姓名|学生|同学|我是|名叫)[：:\\s]*(${NAME_BODY})`,
        'g'
      ),
      group: 1
    },
    // Chinese name bounded by start/end, punctuation, or whitespace.
    {
      kind: 'chinese_name',
      regex: new RegExp(
        `(?:^|[，,。；;：:\\s（(【\\[])(${NAME_BODY})(?=$|[，,。；;：:\\s！!？?）)】\\]])`,
        'g'
      ),
      group: 1
    }
  ]

function formatPIIErrorMessage(matches: readonly PIIMatch[]): string {
  const primary = matches[0]
  if (primary === undefined) {
    return '检测到潜在个人身份信息，请清理后重试'
  }
  const kindLabel = PII_KIND_LABEL[primary.kind]
  const kinds = [...new Set(matches.map((match) => PII_KIND_LABEL[match.kind]))]
  const kindsJoined = kinds.join('、')
  return (
    `${primary.field} 第 ${String(primary.line)} 行包含${kindLabel}`
    + `（潜在个人身份信息：${kindsJoined}），请清理后重试`
  )
}

function lineNumberAt(value: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < value.length; i += 1) {
    if (value.charAt(i) === '\n') line += 1
  }
  return line
}

function scanText(field: string, value: string): PIIMatch[] {
  const matches: PIIMatch[] = []
  const seen = new Set<string>()

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0
    let found = pattern.regex.exec(value)
    while (found !== null) {
      const groupIndex = pattern.group ?? 0
      const snippet = found[groupIndex] ?? found[0] ?? ''
      const fullMatch = found[0] ?? ''
      const snippetOffset = fullMatch.indexOf(snippet)
      const index =
        found.index + (snippetOffset >= 0 ? snippetOffset : 0)

      if (pattern.kind === 'chinese_name' && CHINESE_NAME_FALSE_POSITIVES.has(snippet)) {
        found = pattern.regex.exec(value)
        continue
      }

      const dedupeKey = `${pattern.kind}:${String(index)}:${snippet}`
      if (!seen.has(dedupeKey) && snippet.length > 0) {
        seen.add(dedupeKey)
        matches.push({
          kind: pattern.kind,
          field,
          line: lineNumberAt(value, index),
          snippet
        })
      }
      found = pattern.regex.exec(value)
    }
  }
  return matches
}

/**
 * Scan a free-form string (e.g. STT transcript) for PII.
 * Throws {@link PIIError} on the first field batch of hits.
 */
export function assertNoPII(field: string, value: string): void {
  const matches = scanText(field, value)
  if (matches.length > 0) {
    throw new PIIError(matches)
  }
}

/**
 * Scan the three evaluation fields that may carry free-form PII.
 * Throws {@link PIIError} when any match is found (reject-store strategy).
 */
export function detectEvaluationPII(evaluation: EvaluationResult): void {
  const matches: PIIMatch[] = []

  matches.push(...scanText('summary', evaluation.summary))

  if (evaluation.rejectionReason !== undefined && evaluation.rejectionReason !== '') {
    matches.push(...scanText('rejectionReason', evaluation.rejectionReason))
  }

  evaluation.evidence.forEach((item: EvidenceItem, index: number) => {
    if (item.actual === undefined || item.actual === '') return
    matches.push(...scanText(`evidence[${String(index)}].actual`, item.actual))
  })

  if (matches.length > 0) {
    throw new PIIError(matches)
  }
}

/** Pure scan helper for tests / callers that prefer a list over throw. */
export function findPIIInText(field: string, value: string): PIIMatch[] {
  return scanText(field, value)
}
