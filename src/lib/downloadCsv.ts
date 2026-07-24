/**
 * Browser-side CSV download helper (T13/P6).
 * Escapes cells and triggers a temporary anchor download click.
 */

export function escapeCsvCell(value: string | number | undefined | null): string {
  const raw = value === undefined || value === null ? '' : String(value)
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | undefined | null>>
): void {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(','))
  ]
  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
