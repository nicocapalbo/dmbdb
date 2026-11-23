import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { parseInfiniDyskLogs } from '../helper/attachedServiceLogsParser.js'

const wrapper = (message, level = 'INFO', process = 'InfiniDysk') => (
  `Nov 23, 2026 12:34:56 - ${level} - ${process} subprocess: ${message}`
)

test('InfiniDysk Rust tracing promotes native UTC timestamp and warning over outer INFO', () => {
  const message = 'sqlx::query: slow statement sql="SELECT 1\\nFROM example_table" rows_affected=0 elapsed=1.25s'
  const line = wrapper(
    '\u001b[2m2026-11-22T23:59:59.123456Z\u001b[0m '
      + '\u001b[33m WARN\u001b[0m '
      + '\u001b[2msqlx::query:\u001b[0m '
      + 'slow statement sql="SELECT 1\\nFROM example_table" rows_affected=0 elapsed=1.25s',
  )
  const entries = parseInfiniDyskLogs(line)

  assert.equal(entries.length, 1)
  assert.equal(entries[0].timestamp.toISOString(), '2026-11-22T23:59:59.123Z')
  assert.equal(entries[0].level, 'WARNING')
  assert.equal(entries[0].process, 'InfiniDysk')
  assert.equal(entries[0].message, message)
  assert.doesNotMatch(entries[0].message, /\u001b|subprocess:|2026-11-22T/)
})

test('InfiniDysk direct Rust records normalize native TRACE into the dashboard DEBUG filter', () => {
  const levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']
  const logs = levels.map((level, index) => (
    `2026-11-23T00:00:0${index}.000001Z ${level.padStart(5)} infinidysk::startup: event=${index}`
  )).join('\n')
  const entries = parseInfiniDyskLogs(logs, 'Example native service subprocess')

  assert.deepEqual(entries.map(entry => entry.level), ['DEBUG', 'DEBUG', 'INFO', 'WARNING', 'ERROR'])
  assert.deepEqual(entries.map(entry => entry.process), Array(5).fill('Example native service'))
  assert.deepEqual(entries.map(entry => entry.message), levels.map((_level, index) => (
    `infinidysk::startup: event=${index}`
  )))
  assert.equal(entries[4].timestamp.toISOString(), '2026-11-23T00:00:04.000Z')
})

test('InfiniDysk native timezone offsets take precedence over wrapper local time', () => {
  const entries = parseInfiniDyskLogs(wrapper(
    '2026-11-23T02:30:00.654321+02:30 DEBUG infinidysk::storage: ready',
    'ERROR',
    'Example service',
  ), 'Example service')

  assert.equal(entries.length, 1)
  assert.equal(entries[0].timestamp.toISOString(), '2026-11-23T00:00:00.654Z')
  assert.equal(entries[0].level, 'DEBUG')
  assert.equal(entries[0].process, 'Example service')
  assert.equal(entries[0].message, 'infinidysk::storage: ready')
})

test('InfiniDysk native target, spans and quoted structured fields remain in the message', () => {
  const message = 'request{operation="health check"}: infinidysk::database: result="ready: yes"  count=3'
  const entries = parseInfiniDyskLogs(`2026-11-23T00:00:00Z INFO ${message}`)

  assert.equal(entries.length, 1)
  assert.equal(entries[0].message, message)
  assert.equal(entries[0].process, 'InfiniDysk')
})

test('InfiniDysk downloaded rows unwrap a nested DUMB record before promoting native metadata', () => {
  const message = 'infinidysk::startup: reserved event request_id="example-request"'
  const native = `2026-11-23T00:00:00.123456Z WARN ${message}`
  const downloaded = `[11/23/2026 12:34:56 PM] [INFO] [Example service] ${wrapper(native, 'INFO', 'Example service')}`
  const entries = parseInfiniDyskLogs(downloaded, 'Example service')

  assert.equal(entries.length, 1)
  assert.equal(entries[0].timestamp.toISOString(), '2026-11-23T00:00:00.123Z')
  assert.equal(entries[0].level, 'WARNING')
  assert.equal(entries[0].process, 'Example service')
  assert.equal(entries[0].message, message)
})

test('InfiniDysk native message delimiter words never become additional DUMB wrappers', () => {
  const message = 'infinidysk::startup: note="reserved - INFO - Example subprocess: stay literal" count=1'
  const native = `2026-11-23T00:00:00.123456Z WARN ${message}`
  for (const line of [native, wrapper(native)]) {
    const entries = parseInfiniDyskLogs(line)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].timestamp.toISOString(), '2026-11-23T00:00:00.123Z')
    assert.equal(entries[0].level, 'WARNING')
    assert.equal(entries[0].message, message)
  }
})

test('InfiniDysk large colored structured records remain one complete entry', () => {
  const field = 'value="reserved example" '
  const message = `sqlx::query: ${field.repeat(16_384)}sql="SELECT 1\\nFROM example_table"`
  const colored = message.replaceAll('value=', '\u001b[2mvalue\u001b[0m=')
  const entries = parseInfiniDyskLogs(wrapper(`2026-11-23T00:00:00.987654Z WARN ${colored}`))

  assert.equal(entries.length, 1)
  assert.equal(entries[0].level, 'WARNING')
  assert.equal(entries[0].message, message)
  assert.equal(entries[0].message.includes('\n'), false, 'Literal backslash-n must not create physical rows')
})

test('InfiniDysk physical continuations attach to their native record without swallowing the next one', () => {
  const entries = parseInfiniDyskLogs([
    wrapper('2026-11-23T00:00:00Z ERROR infinidysk::import: task failed'),
    'detail: reserved example',
    'context: item=1',
    wrapper('2026-11-23T00:00:01Z INFO infinidysk::import: next task'),
  ].join('\n'))

  assert.equal(entries.length, 2)
  assert.equal(entries[0].message, 'infinidysk::import: task failed\ndetail: reserved example\ncontext: item=1')
  assert.equal(entries[0].level, 'ERROR')
  assert.equal(entries[1].message, 'infinidysk::import: next task')
})

test('InfiniDysk wrapper startup, legacy v1 and Rust v2 rows remain distinct and ordered', () => {
  const customProcess = 'Example: downloader'
  const entries = parseInfiniDyskLogs([
    wrapper('Loading configuration'),
    wrapper('[12:34:57 WRN] Legacy delivery warning', 'INFO', customProcess),
    wrapper('2026-11-23T00:00:02Z INFO infinidysk::startup: native ready'),
    wrapper('Runtime process exited', 'ERROR'),
  ].join('\n'))

  assert.equal(entries.length, 4)
  assert.equal(entries[1].process, customProcess)
  assert.deepEqual(entries.map(entry => entry.level), ['INFO', 'WARNING', 'INFO', 'ERROR'])
  assert.deepEqual(entries.map(entry => entry.message), [
    'Loading configuration',
    'Legacy delivery warning',
    'infinidysk::startup: native ready',
    'Runtime process exited',
  ])
  const expectedLegacyTime = new Date('Nov 23, 2026 12:34:56')
  expectedLegacyTime.setHours(12, 34, 57, 0)
  assert.equal(entries[1].timestamp.getTime(), expectedLegacyTime.getTime())
})

test('InfiniDysk legacy TRC records keep their existing TRACE severity', () => {
  const entries = parseInfiniDyskLogs(wrapper('[12:34:57 TRC] Legacy reserved event'))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].level, 'TRACE')
  assert.equal(entries[0].message, 'Legacy reserved event')
})

test('InfiniDysk malformed native timestamp falls back to wrapper time without losing severity or message', () => {
  const entries = parseInfiniDyskLogs(wrapper(
    '2026-99-99T99:99:99.123456Z WARN sqlx::query: reserved event',
  ))

  assert.equal(entries.length, 1)
  assert.equal(entries[0].timestamp.getTime(), new Date('Nov 23, 2026 12:34:56').getTime())
  assert.equal(entries[0].level, 'WARNING')
  assert.equal(entries[0].message, 'sqlx::query: reserved event')
})

test('InfiniDysk empty input remains empty', () => {
  for (const value of ['', null, undefined]) assert.deepEqual(parseInfiniDyskLogs(value), [])
})

test('actual service dispatch selects InfiniDysk and legacy NzbDAV by identity before Rclone text', async () => {
  const source = fs.readFileSync(new URL('../helper/ServiceTypeLP.js', import.meta.url), 'utf8')
    .replace(/from ["']~\/constants\/enums\.js["']/g, 'from ' + JSON.stringify(new URL('../constants/enums.js', import.meta.url).href))
    .replace(/import \{ logsParser } from ["']~\/helper\/logsParser\.js["'];/, 'const logsParser = () => []')
    .replace(/from ["']~\/helper\/([^"']+\.js)["']/g, (_match, file) => 'from ' + JSON.stringify(new URL('../helper/' + file, import.meta.url).href))
  const { serviceTypeLP } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

  for (const identity of [
    { serviceKey: 'infinidysk', processName: 'Example native service' },
    { serviceKey: 'infinidysk', processName: 'Example: native service' },
    { serviceKey: 'nzbdav', processName: 'Example legacy service' },
    { serviceKey: 'unknown', processName: 'InfiniDysk' },
    { serviceKey: 'unknown', processName: 'NzbDAV' },
  ]) {
    const entries = serviceTypeLP({
      ...identity,
      logsRaw: wrapper('2026-11-23T00:00:00Z WARN infinidysk::mount: Rclone bridge unavailable', 'INFO', identity.processName),
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].level, 'WARNING')
    assert.equal(entries[0].process, identity.processName)
    assert.equal(entries[0].message, 'infinidysk::mount: Rclone bridge unavailable')
  }
})
