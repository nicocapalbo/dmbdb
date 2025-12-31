import { SERVICE_KEY } from "~/constants/enums.js";
import { logsParser } from "~/helper/logsParser.js";

export function serviceTypeLP({ logsRaw, serviceKey, processName, projectName }) {
  if (serviceKey === SERVICE_KEY.PGADMIN) return parsepgAdmin4(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RCLONE) return parseWebdavLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.ZURG) return parseZurg(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RIVEN_BE) return parseRivenLogs(logsRaw, processName)
  if (['sonarr', 'radarr', 'prowlarr', 'lidarr', 'whisparr'].includes(String(serviceKey).toLowerCase())) {
    return parseArrLogs(logsRaw, processName)
  }
  // if (serviceKey === SERVICE_KEY.DMB_API || serviceKey === SERVICE_KEY.DUMB_API || serviceKey === SERVICE_KEY.DMB_FE || serviceKey === SERVICE_KEY.DUMB_FE) use logsParser(logsRaw) then filter the logs that match the projectName
  if (serviceKey === SERVICE_KEY.DMB_API || serviceKey === SERVICE_KEY.DUMB_API || serviceKey === SERVICE_KEY.DMB_FE || serviceKey === SERVICE_KEY.DUMB_FE) return logsParser(logsRaw).filter(log => log.process === projectName)
  if (serviceKey === SERVICE_KEY.CLI_DEBRID) return parseCliDebridLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.CLI_BATTERY) return parseCliBatteryLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.PLEX) return parsePlexLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.DECYPHARR) return parseDecypharrLogs(logsRaw, processName);
  if (serviceKey === SERVICE_KEY.ZILEAN) return parseZileanLogs(logsRaw, processName);
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
  const lines = logsRaw.split('\n');
  const parsedLogs = [];
  const logLineRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)\|([^|]+)\|([^|]+)\|([\s\S]*)$/;
  const fallbackProcess = processName
    ? processName.trim().replace(' subprocess', '')
    : '';
  let currentEntry = null;

  for (const line of lines) {
    const match = line.match(logLineRegex);
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [, timestampStr, level, component, message] = match;
      currentEntry = {
        timestamp: new Date(timestampStr),
        level: level.trim(),
        process: component.trim() || fallbackProcess,
        message: (message || '').trim(),
      };
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
  const logLines = logText.trim().split('\n');
  const parsedLogs = [];
  const processFallback = processName
    ? processName.trim().replace(' subprocess', '')
    : '';
  const oldFormatRegex = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})\s+(\w+)\s*:\s*(.*)$/;
  const newFormatRegex = /^([A-Za-z]{3} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}) - (\w+) - (.+?) subprocess: (.*)$/;
  let currentEntry = null;

  for (const line of logLines) {
    let match = newFormatRegex.exec(line);
    let format = 'new';
    if (!match) {
      match = oldFormatRegex.exec(line);
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
      currentEntry.message += '\n' + line;
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
