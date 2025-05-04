export function logParserService(logText, processName) {
  // if (processName === 'ZURG') return parseZurg(logText, processName)
  return parseRivenLogs(logText, processName)
}

const parseRivenLogs = (logText, processName) => {
  const lines = logText.split('\n');
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

const parseZurg = (logText, processName) => {
  const lines = logText.trim().split('\n');

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
