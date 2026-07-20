import assert from 'node:assert/strict'
import test from 'node:test'

import { parseMediaStormLogs } from '../helper/mediastormLogsParser.js'

test('promotes MediaStorm Go timestamp, context, source, and inferred error level', () => {
  const logs = 'Jul 20, 2026 13:54:23 - INFO - MediaStorm subprocess: 2026/07/20 13:54:23 service.go:8565: [metadata] custom list series tvdb search error title="Example" err=tvdb login failed: 401 Unauthorized'
  const [entry] = parseMediaStormLogs(logs, 'MediaStorm')

  assert.equal(entry.timestamp.getFullYear(), 2026)
  assert.equal(entry.timestamp.getMonth(), 6)
  assert.equal(entry.timestamp.getDate(), 20)
  assert.equal(entry.timestamp.getHours(), 13)
  assert.equal(entry.level, 'ERROR')
  assert.equal(entry.process, 'metadata')
  assert.match(entry.message, /^service\.go:8565: custom list series/)
  assert.doesNotMatch(entry.message, /MediaStorm subprocess/)
})

test('classifies missing optional metadata configuration as a warning', () => {
  const logs = 'Jul 20, 2026 13:54:24 - INFO - MediaStorm subprocess: 2026/07/20 13:54:24 service.go:1305: [metadata] failed to fetch TMDB ID for IMDB tt1234567: tmdb api key not configured'
  const [entry] = parseMediaStormLogs(logs, 'MediaStorm')

  assert.equal(entry.level, 'WARNING')
  assert.equal(entry.process, 'metadata')
  assert.equal(entry.message, 'service.go:1305: failed to fetch TMDB ID for IMDB tt1234567: tmdb api key not configured')
})

test('unwraps downloaded MediaStorm records and preserves explicit severity', () => {
  const logs = '[07/20/2026 01:54:25 PM] [WARNING] [MediaStorm] Jul 20, 2026 13:54:25 - WARNING - MediaStorm subprocess: ⚠️ The default password is still configured'
  const [entry] = parseMediaStormLogs(logs, 'MediaStorm')

  assert.equal(entry.level, 'WARNING')
  assert.equal(entry.process, 'MediaStorm')
  assert.equal(entry.message, '⚠️ The default password is still configured')
})

test('uses Go source or structured component when no bracket context exists', () => {
  const logs = [
    'Jul 20, 2026 13:50:54 - INFO - MediaStorm subprocess: 2026/07/20 13:50:54 log.go:24: OK 001_initial_schema.sql',
    'Jul 20, 2026 13:50:55 - INFO - MediaStorm subprocess: Queue worker started component=importer-service worker_id=0'
  ].join('\n')
  const parsed = parseMediaStormLogs(logs, 'MediaStorm')

  assert.equal(parsed[0].process, 'log.go:24')
  assert.equal(parsed[0].message, 'OK 001_initial_schema.sql')
  assert.equal(parsed[1].process, 'importer-service')
  assert.equal(parsed[1].message, 'Queue worker started component=importer-service worker_id=0')
})

test('preserves unstructured startup lines without their subprocess wrapper', () => {
  const logs = 'Jul 20, 2026 13:50:54 - INFO - MediaStorm subprocess: 🚀 mediastorm Backend Starting...'
  const [entry] = parseMediaStormLogs(logs, 'MediaStorm')

  assert.equal(entry.level, 'INFO')
  assert.equal(entry.process, 'MediaStorm')
  assert.equal(entry.message, '🚀 mediastorm Backend Starting...')
})
