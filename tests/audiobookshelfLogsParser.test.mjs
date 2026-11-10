import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { parseAudiobookshelfLogs } from '../helper/audiobookshelfLogsParser.js'

test('promotes native Audiobookshelf timestamp, error level and logger context through DUMB wrappers', () => {
  const logs = 'Oct 14, 2026 11:45:32 - INFO - Audiobookshelf subprocess: \x1b[31m[2026-10-14 11:44:10.123] ERROR: [Scanner] Failed to read media\x1b[0m'
  const [entry] = parseAudiobookshelfLogs(logs)
  assert.equal(entry.timestamp.getTime(), new Date('2026-10-14T11:44:10.123').getTime())
  assert.equal(entry.level, 'ERROR')
  assert.equal(entry.process, 'Scanner')
  assert.equal(entry.message, 'Failed to read media')
  const delimiterMessage = parseAudiobookshelfLogs('[2026-10-14 11:44:10.123] ERROR: [Scanner] command returned - INFO - failed')[0]
  assert.equal(delimiterMessage.level, 'ERROR')
  assert.equal(delimiterMessage.message, 'command returned - INFO - failed')
})

test('unwraps downloaded Audiobookshelf logs and retains inner warning severity', () => {
  const logs = '[10/14/2026 11:45:32 AM] [INFO] [Audiobookshelf] Oct 14, 2026 11:45:30 - INFO - Audiobookshelf subprocess: [2026-10-14 11:44:10.456] WARN: [LibraryScanner] Missing media directory'
  const [entry] = parseAudiobookshelfLogs(logs)
  assert.equal(entry.timestamp.getTime(), new Date('2026-10-14T11:44:10.456').getTime())
  assert.equal(entry.level, 'WARNING')
  assert.equal(entry.process, 'LibraryScanner')
  assert.equal(entry.message, 'Missing media directory')
})

test('maps all upstream Audiobookshelf levels into dashboard filters and keeps untagged messages', () => {
  const levels = { TRACE: 'DEBUG', DEBUG: 'DEBUG', INFO: 'INFO', NOTE: 'INFO', WARN: 'WARNING', ERROR: 'ERROR', FATAL: 'ERROR' }
  const logs = Object.keys(levels).map(level => '[2026-10-14 11:44:10.000] ' + level + ': Visible ' + level)
  const entries = parseAudiobookshelfLogs(logs, 'Audiobookshelf subprocess')
  assert.equal(entries.length, Object.keys(levels).length)
  entries.forEach((entry, index) => {
    const level = Object.keys(levels)[index]
    assert.equal(entry.level, levels[level])
    assert.equal(entry.process, 'Audiobookshelf')
    assert.equal(entry.message, 'Visible ' + level)
  })
})

test('folds DUMB-wrapped stack and object continuations into their Audiobookshelf event', () => {
  const wrapper = 'Oct 14, 2026 11:45:32 - INFO - Audiobookshelf subprocess: '
  const logs = [
    '[2026-10-14 11:44:10.000] ERROR: [Database] Unable to open database',
    'Error: SQLITE_CANTOPEN',
    '    at Database.open (/example/database.js:42:10)',
    '  code: "SQLITE_CANTOPEN"',
    '}',
    '[2026-10-14 11:44:11.000] INFO: [Server] Ready',
  ].map(line => wrapper + line).join('\n')
  const entries = parseAudiobookshelfLogs(logs)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].level, 'ERROR')
  assert.equal(entries[0].process, 'Database')
  assert.match(entries[0].message, /SQLITE_CANTOPEN\n    at Database\.open/)
  assert.match(entries[0].message, /code: "SQLITE_CANTOPEN"\n}/)
  assert.equal(entries[1].message, 'Ready')
  assert.equal(entries[1].level, 'INFO')
})

test('retains orphan continuations, unknown output and outer errors without native headers', () => {
  const logs = [
    '    at Scanner.scan (/example/scanner.js:12:4)',
    'unknown startup output',
    'Oct 14, 2026 11:45:32 - ERROR - Audiobookshelf subprocess: unable to start',
    'TypeError: orphaned native error',
    'plain final output',
  ].join('\n')
  const entries = parseAudiobookshelfLogs(logs)
  assert.equal(entries.length, 4)
  assert.match(entries[0].message, /at Scanner\.scan/)
  assert.equal(entries[1].message, 'unknown startup output')
  assert.equal(entries[2].level, 'ERROR')
  assert.equal(entries[2].timestamp.getTime(), new Date('Oct 14, 2026 11:45:32').getTime())
  assert.equal(entries[2].message, 'unable to start\nTypeError: orphaned native error')
  assert.equal(entries[3].message, 'plain final output')
  assert.equal(parseAudiobookshelfLogs('TypeError: standalone native error')[0].level, 'ERROR')
  const mixed = parseAudiobookshelfLogs('startup output\nTypeError: independent failure\n    at Server.start (/example/server.js:1:1)')
  assert.equal(mixed.length, 2)
  assert.equal(mixed[1].level, 'ERROR')
  const wrappedError = parseAudiobookshelfLogs('Oct 14, 2026 11:45:32 - INFO - Audiobookshelf subprocess: TypeError: native crash')
  assert.equal(wrappedError[0].level, 'ERROR')
  assert.equal(wrappedError[0].message, 'TypeError: native crash')
  assert.match(mixed[1].message, /independent failure\n    at Server\.start/)
})

test('actual service log dispatch selects Audiobookshelf by key or process name', async () => {
  const source = fs.readFileSync(new URL('../helper/ServiceTypeLP.js', import.meta.url), 'utf8')
    .replace("import { SERVICE_KEY } from \"~/constants/enums.js\";", 'const SERVICE_KEY = {}')
    .replace(/import \{ logsParser } from ["']~\/helper\/logsParser\.js["'];/, 'const logsParser = () => []')
    .replace(/from ["']~\/helper\/([^"']+\.js)["']/g, (_match, file) => 'from ' + JSON.stringify(new URL('../helper/' + file, import.meta.url).href))
  const { serviceTypeLP } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  const logsRaw = '[2026-10-14 11:44:10.000] ERROR: [Scanner] Visible failure'
  for (const values of [
    { serviceKey: 'audiobookshelf', processName: 'Custom display name' },
    { serviceKey: 'unrecognized', processName: 'Audiobookshelf' },
  ]) {
    const wrappedLogs = 'Oct 14, 2026 11:45:32 - INFO - ' + values.processName + ' subprocess: ' + logsRaw
    const [entry] = serviceTypeLP({ logsRaw: wrappedLogs, ...values })
    assert.equal(entry.level, 'ERROR')
    assert.equal(entry.process, 'Scanner')
    assert.equal(entry.message, 'Visible failure')
  }
})
