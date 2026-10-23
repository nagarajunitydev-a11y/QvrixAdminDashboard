export function downloadCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
) {
  const encode = (value: unknown) => {
    const text = String(value ?? '')
    return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`
  }
  const blob = new Blob(
    [
      '\uFEFF' +
        [headers, ...rows].map((row) => row.map(encode).join(',')).join('\r\n'),
    ],
    { type: 'text/csv;charset=utf-8' },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
