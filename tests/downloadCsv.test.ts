/**
 * downloadCsv — Excel 兼容导出契约（T13/P6 + 决赛加码）。
 * 1) 输出以 UTF-8 BOM 开头，Excel 直接打开中文不乱码；
 * 2) 单元格含逗号/引号/换行时按 RFC 4180 引号转义。
 */
import { describe, expect, it } from 'vitest'
import { buildCsvContent, escapeCsvCell } from '../src/lib/downloadCsv'

describe('escapeCsvCell', () => {
  it('普通单元格原样输出', () => {
    expect(escapeCsvCell('abc')).toBe('abc')
    expect(escapeCsvCell(42)).toBe('42')
    expect(escapeCsvCell(null)).toBe('')
    expect(escapeCsvCell(undefined)).toBe('')
  })

  it('含逗号/引号/换行时转义', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"')
  })
})

describe('buildCsvContent', () => {
  it('首字符为 UTF-8 BOM（Excel 中文兼容）', () => {
    const content = buildCsvContent(['学生', '分数'], [['张三', 95]])
    expect(content.charCodeAt(0)).toBe(0xfeff)
    expect(content.slice(1)).toContain('学生,分数')
  })

  it('表头 + 数据行按行拼接，含逗号单元格转义', () => {
    const content = buildCsvContent(
      ['学生', '分数'],
      [
        ['张三', 95],
        ['李四', '80, 优秀']
      ]
    )
    const body = content.slice(1) // 去掉 BOM
    const lines = body.split('\n')
    expect(lines[0]).toBe('学生,分数')
    expect(lines[1]).toBe('张三,95')
    expect(lines[2]).toBe('李四,"80, 优秀"')
  })
})
