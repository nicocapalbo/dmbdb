import { SERVICE_KEY } from "~/constants/enums.js";
import { logsParser } from "~/helper/logsParser.js";
import { parseBazarrLogs } from "~/helper/bazarrLogsParser.js";
import { parseMaintainerrLogs } from "~/helper/maintainerrLogsParser.js";
import { parseMediaStormLogs } from "~/helper/mediastormLogsParser.js";

export function serviceTypeLP({ logsRaw, serviceKey, processName, projectName }) {
  const normalizeProcessName = (value) => String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Handle DMB/DUMB first to avoid being short-circuited by other parsers.
  if (serviceKey === SERVICE_KEY.DMB_API || serviceKey === SERVICE_KEY.DUMB_API) {
    const allowed = new Set(['dmb', 'dumb'])
    return logsParser(logsRaw).filter((log) => {
      const proc = normalizeProcessName(log?.process)
      return proc && allowed.has(proc)
    })
  }
  if (serviceKey === SERVICE_KEY.DMB_FE || serviceKey === SERVICE_KEY.DUMB_FE) {
    const parsed = logsParser(logsRaw)
    const processMatch = normalizeProcessName(processName)
    const projectMatch = normalizeProcessName(projectName)
    const frontendNames = new Set(
      [
        processMatch,
        projectMatch ? `${projectMatch} frontend` : '',
        projectMatch ? `${projectMatch} front end` : '',
      ].filter(Boolean)
    )
    const entries = parsed.filter((log) => {
      const proc = normalizeProcessName(log?.process)
      return proc && frontendNames.has(proc)
    })
    if (!entries.length) {
      const alt = parsed.filter((log) => {
        const proc = normalizeProcessName(log?.process)
        return proc && proc.includes('frontend') && proc.includes(projectMatch)
      })
      if (alt.length) return alt
    }
    return entries
  }
  if (typeof logsRaw === 'string' && logsRaw.includes('Rclone') && logsRaw.includes('subprocess')) {
    return parseWebdavLogs(logsRaw, processName)
  }
  const normalizedProcess = String(processName || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const normalizedServiceKey = String(serviceKey || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (normalizedProcess.includes('neutarr') || normalizedServiceKey.includes('neutarr')) {
    return parseNeutArrLogs(logsRaw, processName)
  }
  if (normalizedProcess === 'plex dbrepair') {
    return parsePlexDbrepairLogs(logsRaw, processName)
  }
  if (normalizedProcess === 'traefik') {
    return parseTraefikLogs(logsRaw, processName)
  }
  if (normalizedProcess === 'traefik access') {
    return parseTraefikAccessLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('traefik proxy admin') || normalizedServiceKey.includes('traefik_proxy_admin')) {
    return parseTraefikProxyAdminLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('cloudflared') || normalizedServiceKey.includes('cloudflared')) {
    return parseCloudflaredLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('bazarr') || normalizedServiceKey.includes('bazarr')) {
    return parseBazarrLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('maintainerr') || normalizedServiceKey.includes('maintainerr')) {
    return parseMaintainerrLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('mediastorm') || normalizedServiceKey.includes('mediastorm')) {
    return parseMediaStormLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('rclone')) {
    return parseWebdavLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('tautulli')) {
    return parseTautulliLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('pulsarr') || normalizedServiceKey.includes('pulsarr')) {
    return parsePulsarrLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('altmount') || normalizedServiceKey.includes('altmount')) {
    return parseAltMountLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('seerr')) {
    return parseSeerrLogs(logsRaw, processName)
  }
  if (serviceKey === SERVICE_KEY.PGADMIN) return parsepgAdmin4(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RCLONE) return parseWebdavLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.ZURG) return parseZurg(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RIVEN_BE) return parseRivenLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.PHALANX_DB) return parsePhalanxDbLogs(logsRaw, processName)
  if (normalizedProcess.includes('postgres') || serviceKey === SERVICE_KEY.POSTGRES || serviceKey === SERVICE_KEY.POSTGRESS) {
    return parsePostgresLogs(logsRaw, processName)
  }
  if (['sonarr', 'radarr', 'prowlarr', 'lidarr', 'whisparr'].includes(String(serviceKey).toLowerCase())) {
    return parseArrLogs(logsRaw, processName)
  }
  if (normalizedProcess === 'nzbdav') {
    return parseNzbdavLogs(logsRaw, processName)
  }
  if (serviceKey === SERVICE_KEY.CLI_DEBRID) return parseCliDebridLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.CLI_BATTERY) return parseCliBatteryLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.PLEX) return parsePlexLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.DECYPHARR) return parseDecypharrLogs(logsRaw, processName);
  if (serviceKey === SERVICE_KEY.ZILEAN) return parseZileanLogs(logsRaw, processName);
}


const parsePostgresLogs = (logsRaw, processName) => {
  const ansiRegex = /\x1B\[[0-9;]*[mK]/g
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'PostgreSQL'
  const levelMap = {
    LOG: 'INFO',
    INFO: 'INFO',
    DEBUG: 'DEBUG',
    DEBUG1: 'DEBUG',
    DEBUG2: 'DEBUG',
    DEBUG3: 'DEBUG',
    DEBUG4: 'DEBUG',
    DEBUG5: 'DEBUG',
    NOTICE: 'INFO',
    WARNING: 'WARNING',
    WARN: 'WARNING',
    ERROR: 'ERROR',
    FATAL: 'ERROR',
    PANIC: 'ERROR',
    CRITICAL: 'ERROR',
  }
  const normalizeLevel = (value, message = '') => {
    const raw = String(value || '').toUpperCase()
    if (levelMap[raw]) return levelMap[raw]
    if (/\b(critical|fatal|panic|error|failed|does not exist|shut down|shutdown immediate)\b/i.test(message)) return 'ERROR'
    return 'INFO'
  }
  const cleanMessage = (value) => String(value || '')
    .replace(ansiRegex, '')
    .replace(/\u001b\[[0-9;]*[mK]/gi, '')
    .replace(/^PostgreSQL subprocess:\s*/i, '')
    .trim()

  return logsParser(logsRaw)
    .map((entry) => {
      const rawMessage = cleanMessage(entry?.message)
      if (!rawMessage) return null
      const outerTimestamp = entry?.timestamp ? new Date(entry.timestamp) : new Date()

      const dumbWrapped = rawMessage.match(/^([A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}) - ([A-Z]+) - (?:PostgreSQL subprocess:\s*)?(.*)$/)
      if (dumbWrapped) {
        const [, timestampStr, levelRaw, detail] = dumbWrapped
        return {
          timestamp: new Date(timestampStr),
          level: normalizeLevel(levelRaw, detail),
          process: fallbackProcess,
          message: String(detail || '').trim(),
        }
      }

      const postgresPrefix = rawMessage.match(/^([A-Z]+):\s*(.*)$/)
      if (postgresPrefix) {
        const [, levelRaw, detail] = postgresPrefix
        return {
          timestamp: outerTimestamp,
          level: normalizeLevel(levelRaw, detail),
          process: fallbackProcess,
          message: String(detail || '').trim(),
        }
      }

      return {
        timestamp: outerTimestamp,
        level: normalizeLevel(entry?.level, rawMessage),
        process: entry?.process || fallbackProcess,
        message: rawMessage,
      }
    })
    .filter((entry) => entry && String(entry?.message || '').trim().length > 0)
}


const parseCloudflaredLogs = (logsRaw, processName) => {
  const ansiRegex = /\x1B\[[0-9;]*[mK]/g
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'Cloudflared'
  const levelMap = {
    DBG: 'DEBUG',
    DEBUG: 'DEBUG',
    INF: 'INFO',
    INFO: 'INFO',
    WRN: 'WARNING',
    WARN: 'WARNING',
    WARNING: 'WARNING',
    ERR: 'ERROR',
    ERROR: 'ERROR',
    FTL: 'ERROR',
    FATAL: 'ERROR',
  }
  const normalizeLevel = (value, message = '') => {
    const raw = String(value || '').toUpperCase()
    if (levelMap[raw]) return levelMap[raw]
    if (/failed to sufficiently increase receive buffer size/i.test(message)) return 'WARNING'
    if (/\b(failed|failure|error|timeout|refused|bad gateway|context canceled)\b/i.test(message)) return 'ERROR'
    return 'INFO'
  }
  const cleanMessage = (value) => String(value || '')
    .replace(ansiRegex, '')
    .replace(/\u001b\[[0-9;]*[mK]/gi, '')
    .replace(/^Cloudflared subprocess:\s*/i, '')
    .trim()

  const parseDate = (value, fallback) => {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
    const slashMatch = String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})$/)
    if (slashMatch) {
      const [, year, month, day, time] = slashMatch
      const slashDate = new Date(`${year}-${month}-${day}T${time}`)
      if (!Number.isNaN(slashDate.getTime())) return slashDate
    }
    return fallback || new Date()
  }

  const parseInner = (entry) => {
    const outerTimestamp = entry?.timestamp ? new Date(entry.timestamp) : new Date()
    const rawMessage = cleanMessage(entry?.message)
    if (!rawMessage) return null

    const cloudflaredLine = rawMessage.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+([A-Z]{3,7})\s*(.*)$/)
    if (cloudflaredLine) {
      const [, timestampStr, levelRaw, detail] = cloudflaredLine
      return {
        timestamp: parseDate(timestampStr, outerTimestamp),
        level: normalizeLevel(levelRaw, detail),
        process: fallbackProcess,
        message: String(detail || '').trim(),
      }
    }

    const goRuntimeLine = rawMessage.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/)
    if (goRuntimeLine) {
      const [, timestampStr, detail] = goRuntimeLine
      return {
        timestamp: parseDate(timestampStr, outerTimestamp),
        level: normalizeLevel('', detail),
        process: fallbackProcess,
        message: String(detail || '').trim(),
      }
    }

    return {
      timestamp: outerTimestamp,
      level: normalizeLevel(entry?.level, rawMessage),
      process: entry?.process || fallbackProcess,
      message: rawMessage,
    }
  }

  return logsParser(logsRaw)
    .map(parseInner)
    .filter((entry) => entry && String(entry?.message || '').trim().length > 0)
}


const parseTraefikProxyAdminLogs = (logsRaw, processName) => {
  const ansiRegex = /\x1B\[[0-9;]*[mK]/g
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'Traefik Proxy Admin'
  const entries = logsParser(logsRaw)
  const parsed = []
  let current = null

  const cleanMessage = (value) => String(value || '')
    .replace(ansiRegex, '')
    .replace(/\u001b\[[0-9;]*[mK]/gi, '')
    .replace(/^Traefik Proxy Admin subprocess:\s*/i, '')
    .trim()

  const isErrorMessage = (message, level) => {
    const normalizedLevel = String(level || '').toUpperCase()
    return normalizedLevel === 'ERROR' ||
      /\b(error|failed|failure|exception|econnrefused|relation .* does not exist|can't find meta\/_journal\.json)\b/i.test(message)
  }

  const isContinuation = (message) => /^(at\s|\{\s*$|\}\s*$|query:|params:|\[cause\]:|length:|code:|detail:|hint:|position:|internalPosition:|internalQuery:|where:|schema:|table:|column:|dataType:|constraint:|file:|line:|routine:)/.test(message)

  const flush = () => {
    if (current && String(current.message || '').trim()) {
      parsed.push(current)
    }
    current = null
  }

  for (const entry of entries) {
    const message = cleanMessage(entry?.message)
    if (!message) continue
    const timestamp = entry?.timestamp || new Date()
    const process = entry?.process || fallbackProcess
    const level = isErrorMessage(message, entry?.level) ? 'ERROR' : (entry?.level || 'INFO')

    if (current && (isContinuation(message) || (current.level === 'ERROR' && !isErrorMessage(message, entry?.level) && /^(params:|at\s|\[cause\]:|\})/.test(message)))) {
      current.message += `\n${message}`
      continue
    }

    if (current) flush()
    current = { timestamp, level, process, message }
  }

  flush()
  return parsed
}

const parseNeutArrLogs = (logsRaw, processName) => {
  const lines = String(logsRaw || '').split('\n').filter(Boolean)
  const parsed = []
  const fallbackProcess = processName?.trim() || 'NeutArr'
  // "YYYY-MM-DD HH:MM:SS TZ - process - LEVEL - message"
  const neutarrRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([^ ]+) - (.+?) - (\w+) - (.*)$/

  for (const line of lines) {
    const match = line.match(neutarrRegex)
    if (!match) {
      parsed.push({
        timestamp: Date.now(),
        level: 'INFO',
        process: fallbackProcess,
        message: line.trim(),
      })
      continue
    }
    const [, dateTime, , proc, level, msg] = match
    parsed.push({
      timestamp: new Date(dateTime.replace(' ', 'T')),
      level,
      process: (proc || fallbackProcess).trim(),
      message: (msg || '').trim(),
    })
  }

  return parsed
}

const parseTraefikLogs = (logsRaw, processName) => {
  if (logsRaw.includes('Traefik subprocess:')) {
    const ansiRegex = /\x1B\[[0-9;]*[mK]/g
    const innerRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(\w+)\s+(.*)$/
    const bareInnerRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(\w+)$/
    const levelMap = { DBG: 'DEBUG', INF: 'INFO', WRN: 'WARNING', ERR: 'ERROR' }
    return logsParser(logsRaw).map((entry) => {
      const cleanMessage = String(entry?.message || '').replace(ansiRegex, '').trim()
      const match = cleanMessage.match(innerRegex)
      if (match) {
        const [, innerTs, levelRaw, message] = match
        return {
          timestamp: new Date(innerTs),
          level: levelMap[levelRaw] || levelRaw,
          process: 'Traefik',
          message: (message || '').trim(),
        }
      }
      if (bareInnerRegex.test(cleanMessage)) {
        return null
      }
      return {
        timestamp: entry?.timestamp || new Date(),
        level: entry?.level || 'INFO',
        process: entry?.process || 'Traefik',
        message: cleanMessage,
      }
    }).filter((entry) => entry && String(entry?.message || '').trim().length > 0)
  }
  const lines = logsRaw.split('\n')
  const parsedLogs = []
  let currentEntry = null
  const logLineRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(\w+)\s+(?:([^>]+)\s+>\s+)?(.*)$/
  const levelMap = { DBG: 'DEBUG', INF: 'INFO', WRN: 'WARNING', ERR: 'ERROR' }
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'Traefik'

  for (const line of lines) {
    const match = line.match(logLineRegex)
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry)
      const [, timestampStr, levelRaw, source, message] = match
      currentEntry = {
        timestamp: new Date(timestampStr),
        level: levelMap[levelRaw] || levelRaw,
        process: (source || fallbackProcess).trim(),
        message: (message || '').trim(),
      }
    } else if (currentEntry && line.trim().length) {
      currentEntry.message += `\n${line}`
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry)
  return parsedLogs
}

const parseTraefikAccessLogs = (logsRaw, processName) => {
  const lines = logsRaw.trim().split('\n').filter(Boolean)
  const parsedLogs = []
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'Traefik Access'

  for (const line of lines) {
    let payload = null
    try {
      payload = JSON.parse(line)
    } catch (e) {
      parsedLogs.push({
        timestamp: new Date(),
        level: 'INFO',
        process: fallbackProcess,
        message: line.trim(),
      })
      continue
    }

    const level = String(payload.level || 'INFO').toUpperCase()
    const timestamp = payload.time || payload.StartLocal || payload.StartUTC || Date.now()
    const router = payload.RouterName || payload.ServiceName || payload.entryPointName || fallbackProcess
    const status = payload.DownstreamStatus || payload.OriginStatus || ''
    const method = payload.RequestMethod || ''
    const path = payload.RequestPath || ''
    const host = payload.RequestHost || payload.RequestAddr || ''
    const durationMs = typeof payload.Duration === 'number'
      ? (payload.Duration / 1e6).toFixed(1)
      : ''
    const size = payload.DownstreamContentSize != null ? `${payload.DownstreamContentSize}B` : ''
    const parts = [
      method && path ? `${method} ${path}` : '',
      status ? `status=${status}` : '',
      host ? `host=${host}` : '',
      size ? `size=${size}` : '',
      durationMs ? `duration=${durationMs}ms` : '',
    ].filter(Boolean)

    parsedLogs.push({
      timestamp: new Date(timestamp),
      level,
      process: router,
      message: parts.join(' | '),
    })
  }

  return parsedLogs
}

const parsePlexDbrepairLogs = (logsRaw, processName) => {
  const lines = logsRaw.split('\n')
  const parsedLogs = []
  let currentEntry = null
  const logLineRegex = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}[:.]\d{2}[:.]\d{2})\]\s*(.*)$/

  for (const line of lines) {
    const match = line.match(logLineRegex)
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry)

      const [, datePart, timePart, message] = match
      const normalizedTime = timePart.replace(/\./g, ':')
      const timestamp = new Date(`${datePart}T${normalizedTime}`)

      currentEntry = {
        timestamp,
        level: 'INFO',
        process: processName?.trim()?.replace(' subprocess', '') || 'Plex DBRepair',
        message: (message || '').trim(),
      }
    } else if (currentEntry) {
      currentEntry.message += `\n${line}`
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry)
  return parsedLogs
}

const parsePulsarrLogs = (logsRaw, processName) => {
  const ansiRegex = /\x1B\[[0-9;]*[mK]/g
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'Pulsarr'
  const levelMap = { DBG: 'DEBUG', INF: 'INFO', WRN: 'WARNING', ERR: 'ERROR', WARN: 'WARNING' }
  const normalizeLevel = (value) => levelMap[String(value || '').toUpperCase()] || String(value || 'INFO').toUpperCase()
  const cleanMessage = (value) => String(value || '')
    .replace(ansiRegex, '')
    .replace(/\u001b\[[0-9;]*[mK]/gi, '')
    .replace(/Pulsarr subprocess:\s*/g, '')
    .trim()

  const parseInner = (entry) => {
    const outerTimestamp = entry?.timestamp ? new Date(entry.timestamp) : new Date()
    let message = cleanMessage(entry?.message)
    if (!message) return null

    const dumbWrapped = message.match(/^([A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}) - (\w+) - (.*)$/)
    if (dumbWrapped) {
      const [, timestampStr, levelRaw, rest] = dumbWrapped
      message = cleanMessage(rest)
      return {
        timestamp: new Date(timestampStr),
        level: normalizeLevel(levelRaw),
        process: fallbackProcess,
        message,
      }
    }

    const appLine = message.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\s+[A-Z]+)?\]\s+(\w+):?\s*(.*)$/)
    if (appLine) {
      const [, timestampStr, levelRaw, rest] = appLine
      const componentMatch = String(rest || '').match(/^\[([^\]]+)\]\s*(.*)$/)
      return {
        timestamp: new Date(timestampStr.replace(' ', 'T')),
        level: normalizeLevel(levelRaw),
        process: componentMatch ? componentMatch[1].trim() : fallbackProcess,
        message: (componentMatch ? componentMatch[2] : rest || '').trim(),
      }
    }

    return {
      timestamp: outerTimestamp,
      level: normalizeLevel(entry?.level),
      process: entry?.process || fallbackProcess,
      message,
    }
  }

  return logsParser(logsRaw)
    .map(parseInner)
    .filter((entry) => entry && String(entry?.message || '').trim().length > 0)
}


const parseAltMountLogs = (logsRaw, processName) => {
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'AltMount'
  const levelMap = { DBG: 'DEBUG', DEBUG: 'DEBUG', INF: 'INFO', INFO: 'INFO', WRN: 'WARNING', WARN: 'WARNING', WARNING: 'WARNING', ERR: 'ERROR', ERROR: 'ERROR' }
  const normalizeLevel = (value) => levelMap[String(value || '').toUpperCase()] || String(value || 'INFO').toUpperCase()
  const cleanMessage = (value) => String(value || '')
    .replace(/\x1B\[[0-9;]*[mK]/g, '')
    .replace(/AltMount subprocess:\s*/gi, '')
    .trim()

  return logsParser(logsRaw)
    .map((entry) => {
      const outerTimestamp = entry?.timestamp ? new Date(entry.timestamp) : new Date()
      let message = cleanMessage(entry?.message)
      if (!message) return null

      const dumbWrapped = message.match(/^([A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}) - ([A-Z]+) - (.*)$/)
      if (dumbWrapped) {
        const [, timestampStr, levelRaw, rest] = dumbWrapped
        return {
          timestamp: new Date(timestampStr),
          level: normalizeLevel(levelRaw),
          process: fallbackProcess,
          message: cleanMessage(rest),
        }
      }

      const isoLine = message.match(/^(\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)\s+(?:\|\s*)?([A-Z]{3,7})\s*(?:\|\s*)?(.*)$/)
      if (isoLine) {
        const [, timestampStr, levelRaw, rest] = isoLine
        return {
          timestamp: new Date(timestampStr.replace(' ', 'T')),
          level: normalizeLevel(levelRaw),
          process: fallbackProcess,
          message: cleanMessage(rest),
        }
      }

      return {
        timestamp: outerTimestamp,
        level: normalizeLevel(entry?.level),
        process: entry?.process || fallbackProcess,
        message,
      }
    })
    .filter((entry) => entry && String(entry?.message || '').trim().length > 0)
}

const parseSeerrLogs = (logsRaw, processName) => {
  const lines = logsRaw.split('\n')
  const parsedLogs = []
  let currentEntry = null
  const logLineRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+\[(\w+)\](?:\[(.+?)\])?:\s+(.*)$/
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'Seerr'

  for (const line of lines) {
    const match = line.match(logLineRegex)
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry)
      const [, timestampStr, levelRaw, moduleName, message] = match
      const level = String(levelRaw || 'INFO').toUpperCase()
      currentEntry = {
        timestamp: new Date(timestampStr),
        level,
        process: moduleName?.trim() || fallbackProcess,
        message: (message || '').trim(),
      }
    } else if (currentEntry) {
      currentEntry.message += `\n${line}`
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry)
  return parsedLogs
}

const parseTautulliLogs = (logsRaw, processName) => {
  const lineRegex = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) - (\w+)\s+::\s+(.+?)\s*:\s*(.*)$/
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'Tautulli'

  const parseInner = (line) => {
    const match = lineRegex.exec(line)
    if (!match) return null
    const [, datePart, timePart, level, thread, messageRaw] = match
    const timestamp = new Date(`${datePart}T${timePart}`)
    let process = thread.trim()
    let message = messageRaw.trim()
    const parts = message.split(' :: ').map(p => p.trim()).filter(Boolean)
    if (parts.length > 1 && (parts[0].includes('Tautulli') || parts[0].includes('PlexTV'))) {
      process = parts[0]
      message = parts.slice(1).join(' :: ')
    }
    return { timestamp, level: level.trim(), process, message }
  }

  if (logsRaw.includes('subprocess:') && logsRaw.includes('Tautulli')) {
    const baseEntries = logsParser(logsRaw)
    return baseEntries.map((entry) => {
      const inner = parseInner(String(entry?.message || '').trim())
      if (inner) return inner
      return {
        timestamp: entry?.timestamp || new Date(),
        level: entry?.level || 'INFO',
        process: entry?.process || fallbackProcess,
        message: String(entry?.message || '').trim(),
      }
    }).filter((entry) => String(entry?.message || '').trim().length > 0)
  }

  const lines = logsRaw.split('\n')
  const parsedLogs = []
  let currentEntry = null
  for (const line of lines) {
    const cleanLine = line.trimEnd()
    if (!cleanLine) continue
    const parsed = parseInner(cleanLine)
    if (parsed) {
      if (currentEntry) parsedLogs.push(currentEntry)
      currentEntry = parsed
    } else if (currentEntry) {
      currentEntry.message += `\n${cleanLine}`
    }
  }
  if (currentEntry) parsedLogs.push(currentEntry)
  return parsedLogs
}

const parseNzbdavLogs = (logsRaw, processName) => {
  const baseEntries = logsParser(logsRaw)
  const innerRegex = /^\[(\d{2}:\d{2}:\d{2})\s+(\w+)\]\s+(.*)$/
  const levelMap = { INF: 'INFO', WRN: 'WARNING', ERR: 'ERROR', DBG: 'DEBUG' }
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'NzbDAV'

  return baseEntries.map((entry) => {
    const msg = String(entry?.message || '').trim()
    const match = msg.match(innerRegex)
    if (match) {
      const [, timePart, levelRaw, detail] = match
      const baseDate = entry?.timestamp ? new Date(entry.timestamp) : new Date()
      const [hh, mm, ss] = timePart.split(':').map(Number)
      const adjusted = new Date(baseDate)
      if (!Number.isNaN(hh) && !Number.isNaN(mm) && !Number.isNaN(ss)) {
        adjusted.setHours(hh, mm, ss, 0)
      }
      return {
        timestamp: adjusted,
        level: levelMap[levelRaw] || levelRaw,
        process: entry?.process || fallbackProcess,
        message: detail.trim(),
      }
    }
    return {
      timestamp: entry?.timestamp || new Date(),
      level: entry?.level || 'INFO',
      process: entry?.process || fallbackProcess,
      message: msg,
    }
  })
}

const parsePhalanxDbLogs = (logsRaw, processName) => {
  const lines = logsRaw.split('\n')
  const parsedLogs = []
  let currentEntry = null
  const logLineRegex = /^(.+?) - (\w+) - (.+?) subprocess: (.*)$/
  const metaLineRegex = /^\[(\d{4}-\d{2}-\d{2}T[^ ]+)\]\s+\[([A-Z_]+)\]\s+(.*)$/
  const tagLineRegex = /^\[([A-Z_]+)\]\s+(.*)$/
  const stackLineRegex = /^(at |code:|discoveryKey:|})/
  const fallbackProcess = processName?.trim()?.replace(' subprocess', '') || 'Phalanx DB'

  for (const line of lines) {
    const match = line.match(logLineRegex)
    if (match) {
      const [, timestampStr, level, rawProcess, messageRaw] = match
      let logProcess = rawProcess
      const timestamp = new Date(timestampStr)
      let message = (messageRaw || '').trim()
      const metaMatch = message.match(metaLineRegex)
      if (metaMatch) {
        const [, , tag, detail] = metaMatch
        message = detail.trim()
        logProcess = tag.trim()
      } else {
        const tagMatch = message.match(tagLineRegex)
        if (tagMatch) {
          const [, tag, detail] = tagMatch
          message = detail.trim()
          logProcess = tag.trim()
        }
      }

      const entry = {
        timestamp,
        level: level.trim(),
        process: logProcess?.trim() || fallbackProcess,
        message,
      }

      if (currentEntry && currentEntry.process === entry.process) {
        const prevMessage = String(currentEntry.message || '')
        if ((prevMessage.includes('Error during view update') || prevMessage.includes('HypercoreError')) && stackLineRegex.test(entry.message)) {
          currentEntry.message += `\n${entry.message}`
          continue
        }
      }

      if (currentEntry) parsedLogs.push(currentEntry)
      currentEntry = entry
    } else if (currentEntry) {
      currentEntry.message += `\n${line}`
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry)
  return parsedLogs
}

const parseDecypharrLogs = (logsRaw, processName) => {
  const lines = logsRaw.trim().split('\n');
  const parsedLogs = [];
  let currentEntry = null;
  const logLineRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \| (\w+)\s*\| \[(.*?)\] (.*)$/;

  for (const line of lines) {
    const match = line.match(logLineRegex);

    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [, timestampStr, level, logProcess, message] = match;

      currentEntry = {
        timestamp: new Date(timestampStr),
        level: level.trim(),
        process: logProcess.trim(),
        message: message.trim(),
      };
    } else if (currentEntry) {
      currentEntry.message += '\n' + line;
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
};

const parsePlexLogs = (logsRaw, processName) => {
  const lines = logsRaw.trim().split('\n');
  const parsedLogs = [];
  let currentEntry = null;
  console.log('Parsing Plex logs for process:', processName);
  const logLineRegex = /^([A-Za-z]{3} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}(?:\.\d{3})?) \[\d+\] (\w+) - (.*)$/;

  for (const line of lines) {
    const match = line.match(logLineRegex);
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [, timestampStr, level, message] = match;

      currentEntry = {
        timestamp: new Date(timestampStr),
        level: level.trim(),
        process: processName.trim().replace(' subprocess', ''),
        message: message.trim(),
      };
    } else if (currentEntry) {
      currentEntry.message += '\n' + line;
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
};

const parseRivenLogs = (logsRaw, processName) => {
  const lines = logsRaw.split('\n');
  const entries = [];
  let currentEntry = null;

  const logLineRegex = /^(\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \| (.+?) \| (.+?) - (.*)$/;

  for (const line of lines) {
    const match = line.match(logLineRegex);

    if (match) {
      // Start of a new log entry
      const [, timestampStr, level, , message] = match;
      currentEntry = {
        timestamp: new Date(`20${timestampStr.replace(' ', 'T')}`),
        level: level.trim(),
        process: processName.trim().replace(' subprocess', ''),
        message: message.trim(),
      };
      entries.push(currentEntry);
    } else if (currentEntry) {
      // Continuation of the previous log entry (e.g., stack trace)
      currentEntry.message += '\n' + line;
    }
  }

  return entries;
}

const parseZurg = (logsRaw, processName) => {
  const lines = logsRaw.trim().split('\n');
  const parsedLogs = [];
  let currentEntry = null;

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 4) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [timestampStr, level, , ...messageParts] = parts;
      const message = messageParts.join('\t');

      currentEntry = {
        timestamp: new Date(timestampStr),
        level: level.trim(),
        process: processName.trim().replace(' subprocess', ''),
        message: message.trim(),
      };
    } else if (currentEntry) {
      currentEntry.message += '\n' + line;
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
}

const parseArrLogs = (logsRaw, processName) => {
  const logLineRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)\|([^|]+)\|([^|]+)\|([\s\S]*)$/;
  const fallbackProcess = processName
    ? processName.trim().replace(' subprocess', '')
    : '';

  const parseLine = (line) => {
    const match = line.match(logLineRegex);
    if (!match) return null;
    const [, timestampStr, level, component, message] = match;
    return {
      timestamp: new Date(timestampStr),
      level: level.trim(),
      process: component.trim() || fallbackProcess,
      message: (message || '').trim(),
    };
  };

  // Backend logger wrapper: parse outer line, then parse inner ARR format.
  if (logsRaw.includes('subprocess:') && logsRaw.includes('|')) {
    const parsed = [];
    const baseEntries = logsParser(logsRaw);
    for (const entry of baseEntries) {
      const inner = parseLine(String(entry?.message || '').trim());
      if (inner) {
        parsed.push(inner);
      } else if (entry?.message) {
        parsed.push({
          timestamp: entry?.timestamp || new Date(),
          level: entry?.level || 'INFO',
          process: entry?.process || fallbackProcess,
          message: String(entry?.message || '').trim(),
        });
      }
    }
    return parsed;
  }

  const lines = logsRaw.split('\n');
  const parsedLogs = [];
  let currentEntry = null;

  for (const line of lines) {
    const entry = parseLine(line);
    if (entry) {
      if (currentEntry) parsedLogs.push(currentEntry);
      currentEntry = entry;
    } else if (currentEntry && line.trim().length) {
      currentEntry.message += '\n' + line;
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
}

const parseZileanLogs = (logsRaw, processName) => {
  const ansiRegex = /\x1B\[[0-9;]*[mK]/g;
  const cleanLog = logsRaw.replace(ansiRegex, '');
  const lines = cleanLog.split('\n');
  const parsedLogs = [];
  const entryRegex = /^(.+?) - (\w+) - (?:(.+?) subprocess: )?(.*)$/;
  const fallbackProcess = processName
    ? processName.trim().replace(' subprocess', '')
    : '';
  let currentEntry = null;

  for (const line of lines) {
    const match = line.match(entryRegex);
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [, timestamp, level, proc, msg] = match;
      let message = (msg || '').trim();
      message = message.replace(/^:\s*\|?\s*/, '').replace(/^\|\s*/, '');

      const componentMatch = message.match(/^"([^"]+)"\s*\|\s*(.*)$/);
      if (componentMatch) {
        const [, component, rest] = componentMatch;
        message = `${component}: ${rest}`;
      }

      currentEntry = {
        timestamp: new Date(timestamp),
        level: level.trim(),
        process: (proc ? proc.trim() : fallbackProcess),
        message: message.trim(),
      };
    } else if (currentEntry) {
      currentEntry.message += '\n' + line;
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
}

const parsepgAdmin4 = (logText) => {
  const normalizedText = logText.replace(
    /(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}|[A-Za-z]{3} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2})/g,
    '\n$1'
  );
  const logLines = normalizedText.trim().split('\n').filter(Boolean);
  const parsedLogs = [];
  const logLineRegex = /^(.+?):\s+(\w+)\s+(\w+):\s+(.*)$/;
  let currentEntry = null;

  for (const line of logLines) {
    const match = logLineRegex.exec(line);
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [, timestamp, level, processName, message] = match;
      currentEntry = {
        timestamp: new Date(timestamp.split(',')[0]),
        level: level.trim(),
        process: processName.trim().replace(' subprocess', ''),
        message: message.trim(),
      };
    } else if (currentEntry) {
      currentEntry.message += '\n' + line;
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
}

const parseWebdavLogs = (logText, processName) => {
  const ansiRegex = /\x1B\[[0-9;]*[mK]/g;
  const logLines = logText.trim().split('\n');
  const parsedLogs = [];
  const processFallback = processName
    ? processName.trim().replace(' subprocess', '')
    : '';
  const oldFormatRegex = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})\s+(\w+)\s*:\s*(.*)$/;
  const newFormatRegex = /^([A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+\d{2}:\d{2}:\d{2}) - (\w+) - (.+?) subprocess: (.*)$/;
  let currentEntry = null;
  let carryLine = '';

  for (const line of logLines) {
    const cleanLine = line.replace(ansiRegex, '').trimEnd();
    if (!cleanLine) continue;
    const stitchedLine = carryLine ? `${carryLine} ${cleanLine}` : cleanLine;
    carryLine = '';
    let match = newFormatRegex.exec(stitchedLine);
    let format = 'new';
    if (!match) {
      match = oldFormatRegex.exec(stitchedLine);
      format = 'old';
    }
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      let timestamp;
      let level;
      let processFromLine = processFallback;
      let message;
      if (format === 'new') {
        [, timestamp, level, processFromLine, message] = match;
        message = message.replace(/^:\s*/, '');
      } else {
        [, timestamp, level, message] = match;
      }
      currentEntry = {
        timestamp: new Date(timestamp),
        level: level.trim(),
        process: (processFromLine || processFallback).trim(),
        message: message.trim(),
      };
    } else if (currentEntry) {
      currentEntry.message += '\n' + cleanLine;
    } else {
      carryLine = cleanLine;
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
}

const parseCliDebridLogs = (logsRaw, processName) => {
  const lines = logsRaw.trim().split('\n');
  const parsedLogs = [];

  const logLineRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ - ([^:]+):([^:]+):(\d+) - (\w+) - (.*)$/;
  let currentEntry = null;

  for (const line of lines) {
    const match = line.match(logLineRegex);
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [, timestampStr, file, func, lineNum, level, message] = match;
      const timePart = timestampStr.split(' ')[1]; // extract HH:MM:SS

      currentEntry = {
        timestamp: timePart,
        level: level.trim(),
        process: processName.trim().replace(' subprocess', ''),
        message: message.trim(),
      };
    } else if (currentEntry) {
      currentEntry.message += '\n' + line;
    }
  }

  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
};

const parseCliBatteryLogs = (logsRaw, processName) => {
  const lines = logsRaw.trim().split('\n');
  const parsedLogs = [];

  const logLineRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ - (\w+) - (.*)$/;
  let currentEntry = null;

  for (const line of lines) {
    const match = line.match(logLineRegex);

    if (match) {
      // Push the previous entry if it exists
      if (currentEntry) parsedLogs.push(currentEntry);

      const [, timestampStr, level, message] = match;
      const timePart = timestampStr.split(' ')[1]; // extract HH:MM:SS

      currentEntry = {
        timestamp: timePart,
        level: level.trim(),
        process: processName.trim().replace(' subprocess', ''),
        message: message.trim(),
      };
    } else if (currentEntry) {
      // Append continuation line (e.g., part of a JSON payload)
      currentEntry.message += '\n' + line;
    }
  }

  // Push the last entry if any
  if (currentEntry) parsedLogs.push(currentEntry);

  return parsedLogs;
};
