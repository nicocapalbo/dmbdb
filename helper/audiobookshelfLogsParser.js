const ANSI_PATTERN = /\x1B\[[0-9;]*[mK]/g
const OUTER_WRAPPER_PATTERN = /^\[([^\]]+)]\s+\[([^\]]+)]\s+\[([^\]]+)]\s?(.*)$/
const DUMB_LINE_PATTERN = /^([^\[\r\n]+?)\s+-\s+([A-Z]+)\s+-\s+(.*)$/i
// Upstream server/Logger.js (v2.37.1 and master) writes this local-time format.
const AUDIOBOOKSHELF_LINE_PATTERN = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s+([A-Z]+):\s*(.*)$/
const CONTEXT_PATTERN = /^\[([^\]]+)]\s*(.*)$/
const CONTINUATION_PATTERN = /^(?:\s+|(?:[A-Za-z]*Error|Caused by):|[}\]])/

const LEVELS = {
  TRACE: 'DEBUG',
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  NOTE: 'INFO',
  WARN: 'WARNING',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  FATAL: 'ERROR',
  CRITICAL: 'ERROR',
}

const normalizeLevel = value => LEVELS[String(value || '').trim().toUpperCase()] || 'INFO'

const parseTimestamp = (value, fallback = new Date()) => {
  const raw = String(value || '').trim()
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)
    ? raw.replace(' ', 'T')
    : raw
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

/**
 * Promote native Audiobookshelf timestamps, severity and logger tags while
 * retaining unrecognized output and stack traces from either log endpoint.
 */
export const parseAudiobookshelfLogs = (logsRaw, processName = 'Audiobookshelf') => {
  const fallbackProcess = String(processName || 'Audiobookshelf')
    .trim()
    .replace(/\s+subprocess$/i, '') || 'Audiobookshelf'
  const raw = Array.isArray(logsRaw) ? logsRaw.join('\n') : String(logsRaw || '')
  const parsed = []

  for (const rawLine of raw.replace(ANSI_PATTERN, '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    let line = rawLine
    let timestamp = new Date()
    let level = 'INFO'

    const outer = line.match(OUTER_WRAPPER_PATTERN)
    if (outer) {
      timestamp = parseTimestamp(outer[1], timestamp)
      level = normalizeLevel(outer[2])
      line = outer[4]
    }

    const dumb = line.match(DUMB_LINE_PATTERN)
    if (dumb) {
      timestamp = parseTimestamp(dumb[1], timestamp)
      level = normalizeLevel(dumb[2])
      line = dumb[3]
    }
    line = line.replace(/^[^:\r\n]+ subprocess:\s?/i, '')

    const native = line.match(AUDIOBOOKSHELF_LINE_PATTERN)
    if (native) {
      const context = native[3].match(CONTEXT_PATTERN)
      parsed.push({
        timestamp: parseTimestamp(native[1], timestamp),
        level: normalizeLevel(native[2]),
        process: context ? context[1].trim() || fallbackProcess : fallbackProcess,
        message: context ? context[2].trim() : native[3].trim(),
      })
      continue
    }

    const previous = parsed.at(-1)
    const errorLine = /^(?:[A-Za-z]*Error|Caused by):/.test(line.trim())
    if (previous && CONTINUATION_PATTERN.test(line) && (!errorLine || previous.level === 'ERROR')) {
      previous.message += '\n' + line.trimEnd()
      continue
    }

    parsed.push({
      timestamp,
      level: errorLine ? 'ERROR' : level,
      process: fallbackProcess,
      message: line.trim(),
    })
  }

  return parsed.filter(entry => entry.message)
}
