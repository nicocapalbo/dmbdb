import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mergeProfilarrLogEntries,
  parseNeutArrLogs,
  parseInfiniDyskLogs,
  parseProfilarrLogs,
} from '../helper/attachedServiceLogsParser.js'

test('promotes InfiniDysk inner timestamps and abbreviated severities', () => {
  const logs = [
    'Aug  1, 2026 10:35:32 - INFO - InfiniDysk subprocess: [10:35:32 INF] play-timing files=11 firstSeg=986ms',
    'Aug  1, 2026 10:37:24 - INFO - InfiniDysk subprocess: [10:37:24 ERR] Failed queue item after 6 seconds'
  ].join('\n')

  const parsed = parseInfiniDyskLogs(logs, 'InfiniDysk')

  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].level, 'INFO')
  assert.equal(parsed[0].process, 'InfiniDysk')
  assert.equal(parsed[0].message, 'play-timing files=11 firstSeg=986ms')
  assert.equal(parsed[0].timestamp.getHours(), 10)
  assert.equal(parsed[0].timestamp.getMinutes(), 35)
  assert.equal(parsed[1].level, 'ERROR')
})

test('parses NeutArr records without requiring a timezone token', () => {
  const logs = [
    '2026-08-01 10:19:14 - neutarr - INFO - Successfully incremented and verified radarr upgraded',
    '2026-08-01 10:19:15 - neutarr - WARNING - radarr hourly API cap already reached: 10/10'
  ].join('\n')

  const parsed = parseNeutArrLogs(logs, 'NeutArr InfiniDysk')

  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].process, 'neutarr')
  assert.equal(parsed[0].message, 'Successfully incremented and verified radarr upgraded')
  assert.equal(parsed[1].level, 'WARNING')
  assert.equal(parsed[1].timestamp.getMinutes(), 19)
})

test('unwraps NeutArr records when DUMB subprocess logging is present', () => {
  const logs = 'Aug  1, 2026 10:20:04 - INFO - NeutArr InfiniDysk subprocess: 2026-08-01 10:20:04 - neutarr - WARNING - hourly API cap reached'
  const [entry] = parseNeutArrLogs(logs, 'NeutArr InfiniDysk')

  assert.equal(entry.process, 'neutarr')
  assert.equal(entry.level, 'WARNING')
  assert.equal(entry.message, 'hourly API cap reached')
})

test('deduplicates Profilarr direct and DUMB-wrapped copies', () => {
  const logs = [
    '2026-08-01 10:30:34 - task_system - INFO - Task Repository Sync completed successfully',
    'Aug  1, 2026 10:30:34 - INFO - Profilarr Main subprocess: - Task Repository Sync completed successfully',
    '2026-08-01 10:30:34 - apscheduler.executors.default - INFO - Job executed successfully',
    'Aug  1, 2026 10:30:34 - INFO - Profilarr Main subprocess: - Job executed successfully'
  ].join('\n')

  const parsed = parseProfilarrLogs(logs, 'Profilarr Main')

  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed.map(entry => entry.process), [
    'task_system',
    'apscheduler.executors.default'
  ])
  assert.deepEqual(parsed.map(entry => entry.message), [
    'Task Repository Sync completed successfully',
    'Job executed successfully'
  ])
})

test('promotes Profilarr v2 timestamps, levels, and source contexts', () => {
  const logs = [
    '\u001b[90m2026-08-04T12:34:56.123Z\u001b[0m | \u001b[32mINFO \u001b[0m | Server ready | \u001b[90m[Startup]\u001b[0m | \u001b[90m{"port":6868}\u001b[0m',
    'Aug  4, 2026 12:35:00 - INFO - Profilarr subprocess: 2026-08-04T12:35:00.000Z | WARN  | Arr connection failed | [Arr] | {"status":503}'
  ].join('\n')

  const parsed = parseProfilarrLogs(logs, 'Profilarr')

  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].timestamp.toISOString(), '2026-08-04T12:34:56.123Z')
  assert.equal(parsed[0].level, 'INFO')
  assert.equal(parsed[0].process, 'Startup')
  assert.equal(parsed[0].message, 'Server ready | {"port":6868}')
  assert.equal(parsed[1].level, 'WARNING')
  assert.equal(parsed[1].process, 'Arr')
  assert.equal(parsed[1].message, 'Arr connection failed | {"status":503}')
})

test('deduplicates Profilarr wrapper pairs split across API chunks', () => {
  const timestamp = new Date('2026-08-01T10:30:34')
  const existing = [{
    timestamp,
    level: 'INFO',
    process: 'task_system',
    message: 'Task Repository Sync completed successfully'
  }]
  const incoming = [{
    timestamp,
    level: 'INFO',
    process: 'Profilarr Main',
    message: 'Task Repository Sync completed successfully'
  }]

  const merged = mergeProfilarrLogEntries(existing, incoming, 'Profilarr Main')
  const replaced = mergeProfilarrLogEntries(incoming, existing, 'Profilarr Main')

  assert.deepEqual(merged, existing)
  assert.deepEqual(replaced, existing)
})
