export function logsParser(logInput) {
  const ansiRegex = /\x1B\[[0-9;]*[mK]/g;

  // Normalize input to string
  const rawLogs = Array.isArray(logInput)
    ? logInput.join("\n") // combine lines if passed as array
    : logInput;

  // Strip ANSI color codes
  const cleanLog = rawLogs.replace(ansiRegex, "");

  // Split into lines
  const lines = cleanLog.split("\n");

  const logEntries = lines.map((line) => {
    // Example line:
    // Apr  9, 2025 01:55:00 - INFO - Zilean subprocess: ... | Message
    const match = line.match(/^(.+?) - (\w+) - (.+?):(?: \| )?(.*)$/);

    if (!match) return null;

    const [, timestamp, level, process, message] = match;

    return {
      timestamp: new Date(timestamp),
      level,
      process: process.trim().replace(' subprocess', ''),
      message: message.trim(),
    };
  });

  return logEntries.filter(Boolean);
}
