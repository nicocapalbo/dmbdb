const ANSI_PATTERN = /\x1B\[[0-9;]*[mK]/g
const OUTER_WRAPPER_PATTERN = /^\[([^\]]+)]\s+\[([^\]]+)]\s+\[([^\]]+)]\s+(.*)$/
const BAZARR_LINE_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)\|([^|]+)\|([^|]+)\|([\s\S]*)$/

const LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARNING: 'WARNING',
  WARN: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'ERROR',
  FATAL: 'ERROR'
}

const parseTimestamp = (value, fallback = new Date()) => {
  const raw = String(value || '').trim()
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)
    ? raw.replace(' ', 'T')
    : raw
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

const normalizeLevel = (value) => LEVELS[String(value || '').trim().toUpperCase()] || 'INFO'

const removeRecordTerminator = (value) => String(value || '').replace(/\|\s*$/, '').trim()

const unwrapOuterLine = (line) => {
  const match = String(line || '').match(OUTER_WRAPPER_PATTERN)
  if (!match) return { line: String(line || ''), timestamp: null, level: null, process: null }
  const [, timestamp, level, process, message] = match
  return {
    line: message,
    timestamp: parseTimestamp(timestamp),
    level: normalizeLevel(level),
    process: String(process || '').trim()
  }
}

/**
 * Parse Bazarr's pipe-delimited records and fold physical continuation lines
 * (SQL, parameters, tracebacks) into the preceding logical event.
 */
export const parseBazarrLogs = (logsRaw, processName = 'Bazarr') => {
  const fallbackProcess = String(processName || 'Bazarr').trim().replace(/\s+subprocess$/i, '') || 'Bazarr'
  const lines = String(logsRaw || '').replace(ANSI_PATTERN, '').split(/\r?\n/)
  const parsed = []
  let current = null
  let orphan = null

  const flushCurrent = () => {
    if (!current) return
    current.message = String(current.message || '').trim()
    if (current.message) parsed.push(current)
    current = null
  }

  const flushOrphan = () => {
    if (!orphan) return
    orphan.message = String(orphan.message || '').trim()
    if (orphan.message) parsed.push(orphan)
    orphan = null
  }

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue
    const outer = unwrapOuterLine(rawLine)
    const match = outer.line.match(BAZARR_LINE_PATTERN)
    if (match) {
      flushOrphan()
      flushCurrent()
      const [, timestamp, level, loggerName, message] = match
      const logger = String(loggerName || '').trim()
      current = {
        timestamp: parseTimestamp(timestamp, outer.timestamp || new Date()),
        level: normalizeLevel(level),
        process: !logger || logger.toLowerCase() === 'root' ? fallbackProcess : logger,
        message: removeRecordTerminator(message)
      }
      continue
    }

    const continuation = removeRecordTerminator(outer.line)
    if (!continuation) continue
    if (current) {
      current.message += `\n${continuation}`
      continue
    }

    // A byte-range log response can begin in the middle of a multiline event.
    // Preserve that visible context even though its originating header is in a
    // previous chunk.
    if (!orphan) {
      orphan = {
        timestamp: outer.timestamp || new Date(),
        level: outer.level || 'INFO',
        process: outer.process || fallbackProcess,
        message: continuation
      }
    } else {
      orphan.message += `\n${continuation}`
    }
  }

  flushOrphan()
  flushCurrent()
  return parsed
}
