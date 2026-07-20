import assert from 'node:assert/strict'
import test from 'node:test'

import { parseMaintainerrLogs } from '../helper/maintainerrLogsParser.js'

test('promotes the DUMB-wrapped Maintainerr timestamp and Nest context', () => {
  const logs = 'Jul 20, 2026 11:44:10 - INFO - Maintainerr subprocess: ] [RouterExplorer] Mapped {/api/collections, GET} route'
  const [entry] = parseMaintainerrLogs(logs, 'Maintainerr')

  assert.equal(entry.timestamp.getTime(), new Date('Jul 20, 2026 11:44:10').getTime())
  assert.equal(entry.level, 'INFO')
  assert.equal(entry.process, 'RouterExplorer')
  assert.equal(entry.message, 'Mapped {/api/collections, GET} route')
})

test('removes the downloaded-log wrapper and prefers the inner timestamp', () => {
  const logs = '[07/20/2026 11:45:32 AM] [INFO] [Maintainerr] Jul 20, 2026 11:44:10 - WARNING - Maintainerr subprocess: ] [RulesService] Rule evaluation failed'
  const [entry] = parseMaintainerrLogs(logs, 'Maintainerr')

  assert.equal(entry.timestamp.getTime(), new Date('Jul 20, 2026 11:44:10').getTime())
  assert.equal(entry.level, 'WARNING')
  assert.equal(entry.process, 'RulesService')
  assert.equal(entry.message, 'Rule evaluation failed')
})

test('parses Maintainerr rotating-file records', () => {
  const logs = '[maintainerr] | 20/07/2026 11:44:10 [ERROR] [CollectionsService] Failed to remove media'
  const [entry] = parseMaintainerrLogs(logs, 'Maintainerr')

  assert.equal(entry.timestamp.getTime(), new Date('2026-07-20T11:44:10').getTime())
  assert.equal(entry.level, 'ERROR')
  assert.equal(entry.process, 'CollectionsService')
  assert.equal(entry.message, 'Failed to remove media')
})

test('uses Maintainerr for generic main context and preserves unknown lines', () => {
  const logs = [
    'Jul 20, 2026 11:44:10 - INFO - Maintainerr subprocess: ] [main] Server ready',
    'visible orphan context'
  ].join('\n')
  const parsed = parseMaintainerrLogs(logs, 'Maintainerr')

  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].process, 'Maintainerr')
  assert.equal(parsed[0].message, 'Server ready')
  assert.equal(parsed[1].process, 'Maintainerr')
  assert.equal(parsed[1].message, 'visible orphan context')
})
