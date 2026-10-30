export function initialsFromName(name: string | null | undefined) {
  if (!name) return '—'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function timeAgo(timestamp: number | null | undefined) {
  if (!timestamp) return '—'
  const diffMs = Date.now() - timestamp
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  return `${days} d ago`
}

export function isRecent(timestamp: number | null | undefined, minutes = 15) {
  if (!timestamp) return false
  return Date.now() - timestamp <= minutes * 60_000
}

export function formatDateTime(timestamp: number | string | null | undefined) {
  if (timestamp === null || timestamp === undefined) return '—'
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return '—'
  if (hours < 1) return `${Math.round(hours * 60)} min`
  return `${hours.toFixed(hours >= 10 ? 0 : 1)} hr`
}

export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  // Text that starts like a formula is prefixed with ' so spreadsheet apps show it instead of running it.
  const escape = (value: string | number | null | undefined) => {
    const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value ?? '')
    return `"${text.replace(/"/g, '""')}"`
  }
  const content = [header, ...rows].map((row) => row.map(escape).join(',')).join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
