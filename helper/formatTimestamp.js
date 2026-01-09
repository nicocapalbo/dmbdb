export const defaultLogTimestampFormat = Object.freeze({
  dateOrder: 'MDY',
  hourFormat: '12',
  zeroPad: false,
})

export const normalizeLogTimestampFormat = (input = {}) => {
  const dateOrder = input?.dateOrder === 'DMY' ? 'DMY' : 'MDY'
  const hourFormat = input?.hourFormat === '24' ? '24' : '12'
  const zeroPad = Boolean(input?.zeroPad)
  return { dateOrder, hourFormat, zeroPad }
}

export const formatTimestamp = (value, options = defaultLogTimestampFormat) => {
  if (value == null) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const normalized = normalizeLogTimestampFormat(options)
  const pad = normalized.zeroPad ? (n) => String(n).padStart(2, '0') : (n) => String(n)
  const day = pad(date.getDate())
  const month = pad(date.getMonth() + 1)
  const year = date.getFullYear()
  const datePart = normalized.dateOrder === 'DMY'
    ? `${day}/${month}/${year}`
    : `${month}/${day}/${year}`

  let hours = date.getHours()
  let suffix = ''
  if (normalized.hourFormat === '12') {
    suffix = hours >= 12 ? ' PM' : ' AM'
    hours = hours % 12
    if (hours === 0) hours = 12
  }

  const timePart = `${pad(hours)}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${datePart} ${timePart}${suffix}`
}
