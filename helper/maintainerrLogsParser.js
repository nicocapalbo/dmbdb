const ANSI_PATTERN = /\x1B\[[0-9;]*[mK]/g
const OUTER_WRAPPER_PATTERN = /^\[([^\]]+)]\s+\[([^\]]+)]\s+\[([^\]]+)]\s+(.*)$/
const DUMB_LINE_PATTERN = /^(.+?)\s+-\s+([A-Z]+)\s+-\s+(?:Maintainerr subprocess:\s*)?(.*)$/i
const MAINTAINERR_LINE_PATTERN = /^\[maintainerr]\s*\|\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s+\[([^\]]+)]\s+\[([^\]]+)]\s*(.*)$/i
const CONTEXT_PATTERN = /^]?\s*\[([^\]]+)]\s*(.*)$/

const LEVELS = {
  DEBUG: 'DEBUG',
  VERBOSE: 'DEBUG',
  LOG: 'INFO',
  INFO: 'INFO',
  WARN: 'WARNING',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  FATAL: 'ERROR',
  CRITICAL: 'ERROR'
}

const normalizeLevel = (value, message = '') => {
  const normalized = LEVELS[String(value || '').trim().toUpperCase()]
  if (normalized) return normalized
  if (/\b(error|failed|failure|fatal|exception|refused)\b/i.test(message)) return 'ERROR'
  return 'INFO'
}

const parseTimestamp = (value, fallback = new Date()) => {
  const raw = String(value || '').trim()
  const dayFirst = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})$/)
  const normalized = dayFirst
    ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}T${dayFirst[4]}`
    : raw
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

const normalizeProcess = (context, fallbackProcess) => {
  const value = String(context || '').trim()
  if (!value || ['main', 'maintainerr'].includes(value.toLowerCase())) return fallbackProcess
  return value
}

const splitContext = (value, fallbackProcess) => {
  const clean = String(value || '').trim()
  const match = clean.match(CONTEXT_PATTERN)
  if (!match) {
    return {
      process: fallbackProcess,
      message: clean.replace(/^]\s*/, '').trim()
    }
  }
  return {
    process: normalizeProcess(match[1], fallbackProcess),
    message: String(match[2] || '').trim()
  }
}

/**
 * Promote Maintainerr's inner timestamp, severity, and Nest context while
 * removing DUMB's subprocess/file-download wrappers.
 */
export const parseMaintainerrLogs = (logsRaw, processName = 'Maintainerr') => {
  const fallbackProcess = String(processName || 'Maintainerr')
    .trim()
    .replace(/\s+subprocess$/i, '') || 'Maintainerr'

  return String(logsRaw || '')
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    .map((rawLine) => {
      if (!rawLine.trim()) return null

      let line = rawLine.trim()
      let timestamp = new Date()
      let level = 'INFO'

      const outer = line.match(OUTER_WRAPPER_PATTERN)
      if (outer) {
        timestamp = parseTimestamp(outer[1], timestamp)
        level = normalizeLevel(outer[2], outer[4])
        line = String(outer[4] || '').trim()
      }

      const maintainerr = line.match(MAINTAINERR_LINE_PATTERN)
      if (maintainerr) {
        const [, timestampRaw, levelRaw, context, message] = maintainerr
        return {
          timestamp: parseTimestamp(timestampRaw, timestamp),
          level: normalizeLevel(levelRaw, message),
          process: normalizeProcess(context, fallbackProcess),
          message: String(message || '').trim()
        }
      }

      const dumb = line.match(DUMB_LINE_PATTERN)
      if (dumb) {
        const [, timestampRaw, levelRaw, detail] = dumb
        const context = splitContext(detail, fallbackProcess)
        return {
          timestamp: parseTimestamp(timestampRaw, timestamp),
          level: normalizeLevel(levelRaw, context.message),
          process: context.process,
          message: context.message
        }
      }

      const context = splitContext(
        line.replace(/^Maintainerr subprocess:\s*/i, ''),
        fallbackProcess
      )
      return {
        timestamp,
        level: normalizeLevel(level, context.message),
        process: context.process,
        message: context.message
      }
    })
    .filter((entry) => entry && String(entry.message || '').trim())
}
