import {SERVICE_KEY} from "~/constants/enums.js";

export function serviceTypeLP({logsRaw, serviceKey, processName}) {
  if (serviceKey === SERVICE_KEY.PGADMIN) return parsepgAdmin4(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RCLONE) return parseWebdavLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.ZURG) return parseZurg(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.RIVEN_BE) return parseRivenLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.DMB_API) return parseDMBLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.DMB_FE) return parseDMBLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.CLI_DEBRID) return parseCliDebridLogs(logsRaw, processName)
  if (serviceKey === SERVICE_KEY.CLI_BATTERY) return parseCliBatteryLogs(logsRaw, processName)
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

const parsepgAdmin4 = (logText) => {
  const logLines = logText.trim().split('\n');
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

const parseWebdavLogs = (logText) => {
  const logLines = logText.trim().split('\n');
  const parsedLogs = [];
  const logLineRegex = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) (\w+): (\w+)\s+(.*)$/;
  let currentEntry = null;

  for (const line of logLines) {
    const match = logLineRegex.exec(line);
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [ , timestamp, level, processName, message ] = match;
      currentEntry = {
        timestamp: new Date(timestamp),
        level: level.trim(),
        process: processName,
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

      const [ , timestampStr, file, func, lineNum, level, message ] = match;
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

      const [ , timestampStr, level, message ] = match;
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

const parseDMBLogs = (logsRaw, processName) => {
  const lines = logsRaw.trim().split('\n');
  const parsedLogs = [];
  let currentEntry = null;

  // Regex to match ANSI escape sequences
  const ansiRegex = /\u001b\[[0-9;]*m/g;
  // Regex to match log lines in the format: Month DD, YYYY HH:mm:ss - LEVEL - PROCESS subprocess: message
  const logLineRegex = /^([A-Z][a-z]+ \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}) - (\w+) - (.+?):\s*(.*)$/;

  for (const line of lines) {
    const match = line.match(logLineRegex);
    if (match) {
      if (currentEntry) parsedLogs.push(currentEntry);

      const [ , timestampStr, level, rawProcess, message ] = match;
      // Remove ANSI codes from message
      const cleanMessage = message.replace(ansiRegex, '').trim();
      // Parse timestamp and get HH:mm:ss
      let timePart = '';
      try {
        const dateObj = new Date(timestampStr);
        if (!isNaN(dateObj.getTime())) {
          timePart = dateObj.toTimeString().split(' ')[0];
        }
      } catch (e) {}

      currentEntry = {
        timestamp: timePart,
        level: level.trim(),
        process: rawProcess.trim().replace(' subprocess', ''),
        message: cleanMessage,
      };
    } else if (currentEntry) {
      // Multiline continuation: strip ANSI codes for readability
      currentEntry.message += '\n' + line.replace(ansiRegex, '');
    }
  }
  if (currentEntry) parsedLogs.push(currentEntry);
  return parsedLogs;
}
