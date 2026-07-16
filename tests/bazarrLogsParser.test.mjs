import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBazarrLogs } from '../helper/bazarrLogsParser.js'

test('promotes Bazarr timestamp and severity and keeps useful logger names', () => {
  const logs = [
    '2026-07-16 11:19:09|INFO    |root                            |Scheduler will use this timezone: America/New_York|',
    '2026-07-16 11:19:11|INFO    |waitress                        |BAZARR is started and waiting for requests on: http://[::]:6767|',
    '2026-07-16 11:25:32|ERROR   |root                            |BAZARR cannot insert episode because of FOREIGN KEY constraint failed|'
  ].join('\n')

  const parsed = parseBazarrLogs(logs, 'Bazarr')

  assert.equal(parsed.length, 3)
  assert.equal(parsed[0].timestamp.getTime(), new Date('2026-07-16 11:19:09').getTime())
  assert.equal(parsed[0].level, 'INFO')
  assert.equal(parsed[0].process, 'Bazarr')
  assert.equal(parsed[1].process, 'waitress')
  assert.equal(parsed[2].level, 'ERROR')
  assert.match(parsed[2].message, /FOREIGN KEY constraint failed$/)
})

test('folds SQLAlchemy continuation lines into one Bazarr error event', () => {
  const logs = [
    '2026-07-16 11:25:32|ERROR   |root                            |BAZARR cannot insert episode because of (sqlite3.IntegrityError) FOREIGN KEY constraint failed',
    '[SQL: INSERT INTO table_episodes (title) VALUES (?)]',
    "[parameters: ('Two Hearts',)]",
    '(Background on this error at: https://sqlalche.me/e/20/gkpj)|',
    '2026-07-16 11:26:04|INFO    |root                            |BAZARR SignalR client for Radarr is connected and waiting for events.|'
  ].join('\n')

  const parsed = parseBazarrLogs(logs, 'Bazarr')

  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].level, 'ERROR')
  assert.equal(parsed[0].message.split('\n').length, 4)
  assert.match(parsed[0].message, /\[SQL: INSERT INTO table_episodes/)
  assert.match(parsed[0].message, /\[parameters:/)
  assert.match(parsed[0].message, /sqlalche\.me\/e\/20\/gkpj\)$/)
  assert.equal(parsed[1].level, 'INFO')
})

test('parses downloaded bracket-wrapped Bazarr logs', () => {
  const logs = '[07/16/2026 11:33:58 AM] [INFO] [Bazarr] 2026-07-16 11:19:09|WARNING |root |Example warning|'
  const [entry] = parseBazarrLogs(logs, 'Bazarr')

  assert.equal(entry.timestamp.getTime(), new Date('2026-07-16 11:19:09').getTime())
  assert.equal(entry.level, 'WARNING')
  assert.equal(entry.process, 'Bazarr')
  assert.equal(entry.message, 'Example warning')
})

test('preserves an orphaned continuation when a byte-range chunk starts mid-event', () => {
  const logs = [
    '[parameters: (95,)]',
    '(Background on this error at: https://sqlalche.me/e/20/gkpj)|',
    '2026-07-16 11:26:04|INFO|root|Connected|'
  ].join('\n')

  const parsed = parseBazarrLogs(logs, 'Bazarr')

  assert.equal(parsed.length, 2)
  assert.match(parsed[0].message, /^\[parameters:/)
  assert.equal(parsed[1].message, 'Connected')
})
