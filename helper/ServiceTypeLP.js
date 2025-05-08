import {SERVICE_KEY} from "~/constants/enums.js";

export function serviceTypeLP({logsRaw, serviceKey, processName}) {
  if (serviceKey === SERVICE_KEY.PGADMIN) return parsepgAdmin4(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RCLONE) return parseWebdavLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.ZURG) return parseZurg(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RIVEN_BE) return parseRivenLogs(logsRaw, processName)
}

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

  return lines.map(line => {
    const [timestampStr, level, process_name, ...messageParts] = line.split('\t');
    const message = messageParts.join('\t');

    return {
      timestamp: new Date(timestampStr),
      level: level.trim(),
      process: processName.trim().replace(' subprocess', ''),
      message: message.trim(),
    };
  });
}

const parsepgAdmin4 = (logText) => {
  const logLines = logText.trim().split('\n');
  const parsedLogs = [];

  const logLineRegex = /^(.+?):\s+(\w+)\s+(\w+):\s+(.*)$/;

  for (const line of logLines) {
    const match = logLineRegex.exec(line);
    if (match) {
      const [, timestamp, level, processName, message] = match;
      parsedLogs.push({
        timestamp: new Date(timestamp.split(',')[0]),
        level: level.trim(),
        process: processName.trim().replace(' subprocess', ''),
        message,
      });
    }
  }

  return parsedLogs;
}

const parseWebdavLogs = (logText) => {
  const logLines = logText.trim().split('\n');
  const parsedLogs = [];

  const logLineRegex = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) (\w+): (\w+)\s+(.*)$/;

  for (const line of logLines) {
    const match = logLineRegex.exec(line);
    if (match) {
      const [ , timestamp, level, processName, message ] = match;
      parsedLogs.push({
        timestamp: new Date(timestamp),
        level: level.trim(),
        process: processName,
        message,
      });
    }
  }

  return parsedLogs;
}

