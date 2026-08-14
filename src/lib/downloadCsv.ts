/**
 * Browser-side CSV download helper (T13/P6).
 * Escapes cells and triggers a temporary anchor download click.
 *
 * Excel 兼容：文件以 UTF-8 BOM（\uFEFF）开头，中文表头/单元格在 Excel
 * 直接打开不乱码（无 BOM 时 Excel 按本地 ANSI 猜编码）。
 */

export function escapeCsvCell(value: string | number | undefined | null): string {
  const raw = value === undefined || value === null ? '' : String(value)
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

/** 纯函数：生成带 UTF-8 BOM 的 CSV 文本（Excel 兼容，中文不乱码）。 */
export function buildCsvContent(
  headers: string[],
  rows: Array<Array<string | number | undefined | null>>
): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(','))
  ]
  return '\uFEFF' + lines.join('\n')
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | undefined | null>>
): void {
  const blob = new Blob([buildCsvContent(headers, rows)], {
    type: 'text/csv;charset=utf-8'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
