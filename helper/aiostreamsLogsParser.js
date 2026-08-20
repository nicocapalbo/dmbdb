const ANSI_PATTERN = /\x1B\[[0-9;]*[mK]/g
const DOWNLOADED_WRAPPER_PATTERN = /^\[([^\]]+)]\s+\[([^\]]+)]\s+\[([^\]]+)]\s+(.*)$/
const DUMB_LINE_PATTERN = /^(.+?)\s+-\s+([A-Z]+)\s+-\s+(?:AIOStreams subprocess:\s*)?(.*)$/i

const LEVELS = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARNING',
  50: 'ERROR',
  60: 'ERROR',
  TRACE: 'TRACE',
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARNING',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  FATAL: 'ERROR',
}

const normalizeLevel = (value, fallback = 'INFO') => (
  LEVELS[String(value || '').trim().toUpperCase()] || fallback
)

const parseTimestamp = (value, fallback = new Date()) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

const stringifyField = (value) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const parsePinoRecord = (line, fallback) => {
  let record
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null

  const reserved = new Set(['time', 'level', 'module', 'component', 'scope', 'context', 'name', 'msg', 'message', 'pid', 'hostname'])
  const details = Object.entries(record)
    .filter(([key, value]) => !reserved.has(key) && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${stringifyField(value)}`)
  const message = String(record.msg ?? record.message ?? '').trim()

  return {
    timestamp: parseTimestamp(record.time, fallback.timestamp),
    level: normalizeLevel(record.level, fallback.level),
    process: String(record.module || record.component || record.scope || record.context || record.name || fallback.process).trim() || fallback.process,
    message: [message, ...details].filter(Boolean).join(' '),
  }
}

/**
 * Promote AIOStreams' default Pino NDJSON fields while retaining readable
 * fallback rows when an operator switches the upstream logger to text mode.
 */
export const parseAioStreamsLogs = (logsRaw, processName = 'AIOStreams') => {
  const fallbackProcess = String(processName || 'AIOStreams')
    .trim()
    .replace(/\s+subprocess$/i, '') || 'AIOStreams'

  return String(logsRaw || '')
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    .map((rawLine) => {
      if (!rawLine.trim()) return null

      let line = rawLine.trim()
      let fallback = {
        timestamp: new Date(),
        level: 'INFO',
        process: fallbackProcess,
      }

      const downloaded = line.match(DOWNLOADED_WRAPPER_PATTERN)
      if (downloaded) {
        fallback = {
          timestamp: parseTimestamp(downloaded[1], fallback.timestamp),
          level: normalizeLevel(downloaded[2], fallback.level),
          process: fallbackProcess,
        }
        line = String(downloaded[4] || '').trim()
      }

      const dumb = line.match(DUMB_LINE_PATTERN)
      if (dumb) {
        fallback = {
          timestamp: parseTimestamp(dumb[1], fallback.timestamp),
          level: normalizeLevel(dumb[2], fallback.level),
          process: fallbackProcess,
        }
        line = String(dumb[3] || '').trim()
      } else {
        line = line.replace(/^AIOStreams subprocess:\s*/i, '').trim()
      }

      const parsed = parsePinoRecord(line, fallback)
      if (parsed) return parsed

      return {
        ...fallback,
        message: line,
      }
    })
    .filter((entry) => entry && String(entry.message || '').trim())
}
