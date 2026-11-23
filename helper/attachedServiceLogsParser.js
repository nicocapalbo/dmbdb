const ANSI_PATTERN = /\x1B\[[0-9;]*[mK]/g

const LEVEL_MAP = {
  DBG: 'DEBUG',
  DEBUG: 'DEBUG',
  ERR: 'ERROR',
  ERROR: 'ERROR',
  FTL: 'CRITICAL',
  INF: 'INFO',
  INFO: 'INFO',
  TRC: 'TRACE',
  WARN: 'WARNING',
  WARNING: 'WARNING',
  WRN: 'WARNING'
}

const normalizeLevel = (value, fallback = 'INFO') => (
  LEVEL_MAP[String(value || '').toUpperCase()] || String(value || fallback).toUpperCase()
)

const parseTimestamp = (value, fallback = new Date()) => {
  const parsed = new Date(String(value || '').trim())
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

const setTimeOnDate = (date, timePart) => {
  const adjusted = new Date(date)
  const parts = String(timePart || '').split(':').map(Number)
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    adjusted.setHours(parts[0], parts[1], parts[2], 0)
  }
  return adjusted
}

const cleanLines = (logsRaw) => String(logsRaw || '')
  .replace(ANSI_PATTERN, '')
  .split('\n')
  .map(line => line.trimEnd())
  .filter(Boolean)

export const parseInfiniDyskLogs = (logsRaw, processName = 'InfiniDysk') => {
  const fallbackProcess = String(processName || 'InfiniDysk').replace(/\s+subprocess$/i, '').trim() || 'InfiniDysk'
  const downloadPattern = /^\[([^\]]+)]\s+\[([^\]]+)]\s+\[([^\]]+)]\s?(.*)$/
  const wrapperPattern = /^(.+?)\s+-\s+([A-Z0-9]+)\s+-\s+(.*)$/
  const processPattern = /^([^\r\n]+?) subprocess:\s?(.*)$/i
  const innerPattern = /^\[(\d{2}:\d{2}:\d{2})\s+([A-Z]+)\]\s+(.*)$/
  const nativePattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\s+(.*)$/
  const raw = Array.isArray(logsRaw) ? logsRaw.join('\n') : String(logsRaw || '')
  const lines = raw.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/)
  const parsed = []

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue
    let line = rawLine.trimEnd()
    let timestamp = new Date()
    let level = 'INFO'
    let process = fallbackProcess
    let wrapped = false

    // Downloaded rows can contain a DUMB subprocess wrapper. Stop unwrapping
    // at a native header so delimiters inside a quoted message stay intact.
    for (let depth = 0; depth < 4; depth += 1) {
      if (nativePattern.test(line.trimStart()) || innerPattern.test(line.trimStart())) break
      const download = line.match(downloadPattern)
      if (download) {
        timestamp = parseTimestamp(download[1], timestamp)
        level = normalizeLevel(download[2], level)
        process = download[3].trim().replace(/\s+subprocess$/i, '') || process
        line = download[4]
        wrapped = true
        continue
      }
      const wrapper = line.match(wrapperPattern)
      if (wrapper) {
        const candidateTimestamp = new Date(wrapper[1])
        if (!Number.isNaN(candidateTimestamp.getTime())) {
          timestamp = candidateTimestamp
          level = normalizeLevel(wrapper[2], level)
          line = wrapper[3]
          wrapped = true
          continue
        }
      }
      const subprocess = line.match(processPattern)
      if (subprocess) {
        process = subprocess[1].trim() || process
        line = subprocess[2]
        wrapped = true
        continue
      }
      break
    }

    const native = line.trimStart().match(nativePattern)
    if (native) {
      parsed.push({
        timestamp: parseTimestamp(native[1], timestamp),
        level: native[2] === 'TRACE' ? 'DEBUG' : normalizeLevel(native[2]),
        process,
        // Retain Rust targets/spans and quoted fields exactly. In particular,
        // literal backslash-n inside SQL is not a physical log separator.
        message: native[3]
      })
      continue
    }

    const inner = line.trimStart().match(innerPattern)
    if (inner) {
      parsed.push({
        timestamp: setTimeOnDate(timestamp, inner[1]),
        level: normalizeLevel(inner[2]),
        process,
        message: inner[3].trim()
      })
      continue
    }

    if (!wrapped && parsed.length) {
      parsed[parsed.length - 1].message += `\n${line}`
    } else {
      parsed.push({ timestamp, level, process, message: line.trim() })
    }
  }

  return parsed.filter(entry => entry.message)
}

export const parseNeutArrLogs = (logsRaw, processName = 'NeutArr') => {
  const fallbackProcess = String(processName || 'NeutArr').trim()
  const wrapperPattern = /^(.+?)\s+-\s+([A-Z0-9]+)\s+-\s+(.+?) subprocess:\s*(.*)$/
  const directPattern = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\s+([A-Z]{2,6}|[+-]\d{2}:?\d{2}))?\s+-\s+(.+?)\s+-\s+([A-Z]+)\s+-\s+(.*)$/
  const parsed = []

  for (const line of cleanLines(logsRaw)) {
    const wrapper = line.match(wrapperPattern)
    const candidate = wrapper ? wrapper[4].trim() : line.trim()
    const direct = candidate.match(directPattern)

    if (direct) {
      const [, dateTime, timezone, process, level, message] = direct
      const timestampText = timezone ? `${dateTime} ${timezone}` : dateTime.replace(' ', 'T')
      parsed.push({
        timestamp: parseTimestamp(
          timestampText,
          wrapper ? parseTimestamp(wrapper[1]) : new Date()
        ),
        level: normalizeLevel(level, wrapper?.[2]),
        process: String(process || fallbackProcess).trim(),
        message: message.trim()
      })
      continue
    }

    if (wrapper) {
      parsed.push({
        timestamp: parseTimestamp(wrapper[1]),
        level: normalizeLevel(wrapper[2]),
        process: String(wrapper[3] || fallbackProcess).trim(),
        message: candidate
      })
    } else if (parsed.length) {
      parsed[parsed.length - 1].message += `\n${candidate}`
    }
  }

  return parsed
}

export const parseProfilarrLogs = (logsRaw, processName = 'Profilarr') => {
  const fallbackProcess = String(processName || 'Profilarr').trim()
  const directPattern = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+-\s+(.+?)\s+-\s+([A-Z]+)\s+-\s+(.*)$/
  const wrapperPattern = /^(.+?)\s+-\s+([A-Z0-9]+)\s+-\s+(.+?) subprocess:\s*(?:-\s*)?(.*)$/
  const candidates = []

  for (const line of cleanLines(logsRaw)) {
    const wrapper = line.match(wrapperPattern)
    const candidate = wrapper ? wrapper[4].trim() : line.trim()
    const v2Parts = candidate.split(/\s+\|\s+/)
    const v2Timestamp = v2Parts[0]
    const v2Level = v2Parts[1]
    if (
      v2Parts.length >= 3 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v2Timestamp) &&
      /^(?:DEBUG|INFO|WARN|WARNING|ERROR)$/.test(v2Level)
    ) {
      const sourceIndex = v2Parts.findIndex((part, index) => (
        index >= 3 && /^\[[^\]]+\]$/.test(part)
      ))
      const messageEnd = sourceIndex >= 0 ? sourceIndex : v2Parts.length
      const messageParts = v2Parts.slice(2, messageEnd)
      if (sourceIndex >= 0 && v2Parts.length > sourceIndex + 1) {
        messageParts.push(v2Parts.slice(sourceIndex + 1).join(' | '))
      }
      candidates.push({
        timestamp: parseTimestamp(v2Timestamp, wrapper ? parseTimestamp(wrapper[1]) : new Date()),
        level: normalizeLevel(v2Level, wrapper?.[2]),
        process: sourceIndex >= 0
          ? v2Parts[sourceIndex].slice(1, -1).trim()
          : String(wrapper?.[3] || fallbackProcess).trim(),
        message: messageParts.join(' | ').trim(),
        direct: !wrapper
      })
      continue
    }

    const direct = line.match(directPattern)
    if (direct) {
      candidates.push({
        timestamp: parseTimestamp(direct[1].replace(' ', 'T')),
        level: normalizeLevel(direct[3]),
        process: direct[2].trim(),
        message: direct[4].trim(),
        direct: true
      })
      continue
    }

    if (wrapper) {
      candidates.push({
        timestamp: parseTimestamp(wrapper[1]),
        level: normalizeLevel(wrapper[2]),
        process: String(wrapper[3] || fallbackProcess).trim(),
        message: wrapper[4].trim(),
        direct: false
      })
    }
  }

  const deduplicated = new Map()
  for (const entry of candidates) {
    const key = `${entry.timestamp.getTime()}\u0000${entry.level}\u0000${entry.message}`
    const existing = deduplicated.get(key)
    if (!existing || (!existing.direct && entry.direct)) deduplicated.set(key, entry)
  }

  return [...deduplicated.values()].map(({ direct: _direct, ...entry }) => entry)
}

const timestampMillis = value => {
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

export const mergeProfilarrLogEntries = (existing, incoming, processName = 'Profilarr') => {
  const wrapperProcess = String(processName || 'Profilarr').trim().toLowerCase()
  const merged = [...(existing || [])]

  for (const entry of incoming || []) {
    const entryTime = timestampMillis(entry?.timestamp)
    const entryProcess = String(entry?.process || '').trim().toLowerCase()
    const start = Math.max(0, merged.length - 100)
    const duplicateIndex = merged.findIndex((candidate, index) => (
      index >= start &&
      timestampMillis(candidate?.timestamp) === entryTime &&
      candidate?.level === entry?.level &&
      candidate?.message === entry?.message &&
      String(candidate?.process || '').trim().toLowerCase() !== entryProcess &&
      (
        String(candidate?.process || '').trim().toLowerCase() === wrapperProcess ||
        entryProcess === wrapperProcess
      )
    ))

    if (duplicateIndex < 0) {
      merged.push(entry)
      continue
    }

    const existingProcess = String(merged[duplicateIndex]?.process || '').trim().toLowerCase()
    if (existingProcess === wrapperProcess && entryProcess !== wrapperProcess) {
      merged.splice(duplicateIndex, 1, entry)
    }
  }

  return merged
}
