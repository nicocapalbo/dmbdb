const ANSI_PATTERN = /\x1B\[[0-9;]*[mK]/g
const OUTER_WRAPPER_PATTERN = /^\[([^\]]+)]\s+\[([^\]]+)]\s+\[([^\]]+)]\s+(.*)$/
const DUMB_LINE_PATTERN = /^(.+?)\s+-\s+([A-Z]+)\s+-\s+(?:MediaStorm subprocess:\s*)?(.*)$/i
const GO_LINE_PATTERN = /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+([^\s:]+:\d+):\s*(.*)$/
const CONTEXT_PATTERN = /^\[([^\]]+)]\s*(.*)$/
const COMPONENT_PATTERN = /(?:^|\s)component=(?:"([^"]+)"|(\S+))/i

const LEVELS = {
  DEBUG: 'DEBUG',
  TRACE: 'DEBUG',
  INFO: 'INFO',
  NOTICE: 'INFO',
  WARN: 'WARNING',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  FATAL: 'ERROR',
  PANIC: 'ERROR',
  CRITICAL: 'ERROR'
}

const parseTimestamp = (value, fallback = new Date()) => {
  const raw = String(value || '').trim()
  const goTimestamp = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/)
  const normalized = goTimestamp
    ? `${goTimestamp[1]}-${goTimestamp[2]}-${goTimestamp[3]}T${goTimestamp[4]}`
    : raw
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

const normalizeLevel = (value, message = '') => {
  const explicit = LEVELS[String(value || '').trim().toUpperCase()] || 'INFO'
  if (['ERROR', 'WARNING', 'DEBUG'].includes(explicit)) return explicit

  const detail = String(message || '')
  if (/\b(?:not configured|no [^\n]*match|default password|deprecated)\b/i.test(detail)) {
    return 'WARNING'
  }
  if (/\b(?:error|failed|failure|fatal|panic|exception|unauthorized|forbidden)\b|(?:^|\s)err=/i.test(detail)) {
    return 'ERROR'
  }
  if (/\bwarn(?:ing)?\b/i.test(detail)) return 'WARNING'
  return explicit
}

const fallbackProcessName = (processName) => String(processName || 'MediaStorm')
  .trim()
  .replace(/\s+subprocess$/i, '') || 'MediaStorm'

const parseDetail = (detail, fallbackProcess) => {
  const clean = String(detail || '').trim()
  const context = clean.match(CONTEXT_PATTERN)
  if (context) {
    return {
      process: String(context[1] || '').trim() || fallbackProcess,
      message: String(context[2] || '').trim()
    }
  }

  const component = clean.match(COMPONENT_PATTERN)
  if (component) {
    return {
      process: String(component[1] || component[2] || '').trim() || fallbackProcess,
      message: clean
    }
  }

  return { process: fallbackProcess, message: clean }
}

/**
 * Promote MediaStorm's inner Go timestamp, inferred severity, source, and
 * bracket/component context while removing DUMB's subprocess wrappers.
 */
export const parseMediaStormLogs = (logsRaw, processName = 'MediaStorm') => {
  const fallbackProcess = fallbackProcessName(processName)

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

      const dumb = line.match(DUMB_LINE_PATTERN)
      if (dumb) {
        timestamp = parseTimestamp(dumb[1], timestamp)
        level = normalizeLevel(dumb[2], dumb[3])
        line = String(dumb[3] || '').trim()
      } else {
        line = line.replace(/^MediaStorm subprocess:\s*/i, '').trim()
      }

      const goLine = line.match(GO_LINE_PATTERN)
      if (goLine) {
        const [, innerTimestamp, source, detail] = goLine
        const parsedDetail = parseDetail(detail, source)
        return {
          timestamp: parseTimestamp(innerTimestamp, timestamp),
          level: normalizeLevel(level, parsedDetail.message),
          process: parsedDetail.process,
          message: parsedDetail.process === source
            ? parsedDetail.message
            : `${source}: ${parsedDetail.message}`
        }
      }

      const parsedDetail = parseDetail(line, fallbackProcess)
      return {
        timestamp,
        level: normalizeLevel(level, parsedDetail.message),
        process: parsedDetail.process,
        message: parsedDetail.message
      }
    })
    .filter((entry) => entry && String(entry.message || '').trim())
}
