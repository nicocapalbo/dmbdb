import { SERVICE_KEY } from "~/constants/enums.js";
import { logsParser } from "~/helper/logsParser.js";

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
  if (normalizedProcess === 'plex dbrepair') {
    return parsePlexDbrepairLogs(logsRaw, processName)
  }
  if (normalizedProcess === 'traefik') {
    return parseTraefikLogs(logsRaw, processName)
  }
  if (normalizedProcess === 'traefik access') {
    return parseTraefikAccessLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('rclone')) {
    return parseWebdavLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('tautulli')) {
    return parseTautulliLogs(logsRaw, processName)
  }
  if (normalizedProcess.includes('seerr')) {
    return parseSeerrLogs(logsRaw, processName)
  }
  if (serviceKey === SERVICE_KEY.PGADMIN) return parsepgAdmin4(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RCLONE) return parseWebdavLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.ZURG) return parseZurg(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RIVEN_BE) return parseRivenLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.PHALANX_DB) return parsePhalanxDbLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.POSTGRESS) return logsParser(logsRaw)
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
