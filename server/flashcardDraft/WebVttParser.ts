/**
 * T22 WebVTT → 纯文本解析（MVP：教师粘贴字幕/WebVTT）。
 *
 * 只做轻量清理：去掉头部与时间轴标记、cue 序号、行内 <v> 说话人标签与
 * 其他 HTML 标签，把 cue 文本按段拼接。不做字幕质量判断 —— 出题质量由
 * 校对闸门负责（PRD §好测试的标准：不测转写/字幕质量）。
 *
 * 识别策略（照 `server/media/mediaGate.ts` 的 VTT 魔数）：以 `WEBVTT` 开头
 * （允许 UTF-8 BOM）视为 WebVTT；否则按纯文本原样返回（转录端点两种都收）。
 */
export class WebVttInputError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'WebVttInputError'
  }
}

export function isWebVtt(text: string): boolean {
  const stripped = text.replace(/^\uFEFF/, '')
  return stripped.startsWith('WEBVTT')
}

export interface ParseWebVttResult {
  /** 拼接后的纯文本（cue 文本，段落分隔）。 */
  text: string
  /** 解析到的 cue 数。 */
  cueCount: number
}

/**
 * 解析 WebVTT 文本。无法解析出任何 cue 时抛 `WebVttInputError`。
 * 非 WebVTT 内容按纯文本原样返回（cueCount = 0）。
 */
export function parseWebVtt(raw: string): ParseWebVttResult {
  const source = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!source.startsWith('WEBVTT')) {
    return { text: raw.trim(), cueCount: 0 }
  }

  const cues: string[] = []
  const lines = source.split('\n')
  let i = 0

  // 头部：第一行必须是 WEBVTT，可带可选元数据直到首个空行。
  while (i < lines.length && lines[i]?.trim() !== '') {
    i += 1
  }

  while (i < lines.length) {
    const line = lines[i]?.trim() ?? ''
    // 跳过空行与时间轴（含 NOTE 注释、cue 设置、序号）。
    if (
      line === '' ||
      line.includes('-->') ||
      /^\d+$/.test(line) ||
      line.startsWith('NOTE') ||
      /^STYLE|^REGION/.test(line)
    ) {
      i += 1
      continue
    }
    // 说话人标签 `<v Alice> ...` 或行内标签清理。
    const cleaned = stripInlineTags(line)
    if (cleaned !== '') cues.push(cleaned)
    i += 1
  }

  const text = cues.join('\n').trim()
  if (text === '') {
    throw new WebVttInputError('WebVTT 内容为空或无法解析出任何字幕文本')
  }
  return { text, cueCount: cues.length }
}

/** 去掉行内标签（<v xxx>、<c>、<i> 等），保留纯文本。 */
function stripInlineTags(line: string): string {
  return line
    .replace(/<[^>]+>/g, '')
    .trim()
}
