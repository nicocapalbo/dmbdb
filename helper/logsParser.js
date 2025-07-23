export function logsParser(logInput) {
  const ansiRegex = /\x1B\[[0-9;]*[mK]/g;
  const projectName = useProcessesStore().projectName;
  // Normalize input to string
  const rawLogs = Array.isArray(logInput)
    ? logInput.join("\n")
    : logInput;

  // Strip ANSI color codes
  const cleanLog = rawLogs.replace(ansiRegex, "");

  // Split into lines
  const lines = cleanLog.split("\n");

  // This single regex covers both “X subprocess: ...” and “no subprocess” cases.
  // 1) (.+?)     → timestamp up to first " - "
  // 2) (\w+)     → log level
  // 3) (?:(.+?) subprocess: )? → optional “process” when “subprocess:” is present
  // 4) (.*)      → the rest of the message
  const entryRegex = /^(.+?) - (\w+) - (?:(.+?) subprocess: )?(.*)$/;

  const logEntries = lines
    .map((line) => {
      const m = line.match(entryRegex);
      if (!m) return null;

      const [, timestamp, level, proc, msg] = m;
      return {
        timestamp: new Date(timestamp),
        level,
        // if we didn’t capture a proc name, default to projectName
        process: proc ? proc.trim() : projectName,
        message: msg.trim(),
      };
    })
    .filter(Boolean);

  return logEntries;
}
